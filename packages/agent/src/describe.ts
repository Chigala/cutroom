/**
 * The visual transcript: contact sheets of a clip's segments, described by a fast vision model into
 * the same kind of text the agent reads for speech. Haiku on the API when there is a key, otherwise
 * on the Claude subscription through the Agent SDK. Calls run in parallel; a call that fails twice
 * leaves its segments undescribed rather than failing the index.
 */

import { tmpdir } from "node:os";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { ShotSegment } from "@vedit/project";
import { z } from "zod";
import { inputSchema } from "./api.ts";
import { claudeEnv, claudeExecutable } from "./sdk.ts";
import type { Backend } from "./types.ts";

/**
 * The model that describes footage, per backend. With an API key, Haiku: cheap and quick. On the
 * subscription, Haiku can sit in a queue for minutes while Sonnet answers in seconds (measured: 233 s
 * against 3 s for the same sheet), so Sonnet.
 */
export const VISION_MODEL = { api: "claude-haiku-4-5", subscription: "claude-sonnet-5-5" } as const;

export interface SheetBatch {
  /** JPEG contact sheets, in order. */
  readonly sheets: readonly Buffer[];
  /** One line per segment, in order across the sheets: its time range and anything said in it. */
  readonly segments: readonly { readonly label: string }[];
  readonly perSheet: number;
}

const Described = ShotSegment.omit({ start: true, end: true }).extend({
  n: z.number().int().min(1).describe("The segment's number"),
});
type Described = z.infer<typeof Described>;
const Answer = z.object({ segments: z.array(Described) });

const INSTRUCTIONS = (
  batch: SheetBatch,
) => `These ${batch.sheets.length === 1 ? "image is a contact sheet" : `${batch.sheets.length} images are contact sheets`} from one video clip, for a video editor.
Tiles read left to right, top to bottom. Every three consecutive tiles are one segment: its start, middle and end. Each sheet holds up to ${batch.perSheet} segments; numbering continues across sheets.

Segments:
${batch.segments.map((s, i) => `${i + 1}. ${s.label}`).join("\n")}

Return exactly ${batch.segments.length} entries, n = 1 to ${batch.segments.length}, one per segment, even when several look alike (repeat the description then).

For every segment, record:
- what: what is on screen and what happens, in under 18 words. Concrete: who or what, the action, the setting. Use names only if they are visible or said.
- shot: wide, medium, close, detail, aerial, screen (a screen recording or slide) or graphic.
- camera: static, pan, tilt, zoom, handheld or tracking.
- energy: 1 calm to 5 explosive (crowds erupting, launches, fast action).
- quality: any of blurry, shaky, dark, overexposed, obstructed. Empty if fine.
- highlight: true only for standout shots an editor would build a moment around.
- tags: up to 5 short lowercase tags for search (subjects, setting, mood).`;

const TOOL = {
  name: "record_segments",
  description: "Record the description of every segment.",
  input_schema: inputSchema(Answer) as Anthropic.Tool.InputSchema,
};

/** Describes every segment of a batch: one entry per segment, null where the model gave nothing. */
export async function describeBatch(
  batch: SheetBatch,
  backend: Backend,
  signal?: AbortSignal,
): Promise<(Described | null)[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = backend === "api" ? await viaApi(batch, signal) : await viaSubscription(batch, signal);
      const byN = new Map(answer.segments.map((s) => [s.n, s]));
      const out = batch.segments.map((_, i) => byN.get(i + 1) ?? null);
      // A few skipped (look-alikes merged): take the description of the segment before.
      for (let i = 1; i < out.length; i++) out[i] ??= out[i - 1] ?? null;
      const missing = out.filter((x) => !x).length;
      if (missing > out.length / 4 && attempt === 0) throw new Error(`${missing} segments came back empty`);
      return out;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt === 1) {
        console.error("[describe] a batch failed:", (err as Error).message);
        return batch.segments.map(() => null);
      }
    }
  }
  return batch.segments.map(() => null);
}

const images = (batch: SheetBatch) =>
  batch.sheets.map((s) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: "image/jpeg" as const, data: s.toString("base64") },
  }));

async function viaApi(batch: SheetBatch, signal?: AbortSignal): Promise<z.infer<typeof Answer>> {
  const client = new Anthropic();
  const response = await client.messages.create(
    {
      model: VISION_MODEL.api,
      max_tokens: 8000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: [...images(batch), { type: "text", text: INSTRUCTIONS(batch) }] }],
    },
    { ...(signal && { signal }) },
  );
  if (response.stop_reason === "max_tokens") throw new Error("the description was cut off");
  const call = response.content.find((b) => b.type === "tool_use");
  if (call?.type !== "tool_use") throw new Error("no descriptions came back");
  return Answer.parse(call.input);
}

async function viaSubscription(batch: SheetBatch, signal?: AbortSignal): Promise<z.infer<typeof Answer>> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  async function* prompt(): AsyncIterable<SDKUserMessage> {
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          ...images(batch),
          {
            type: "text",
            text: `${INSTRUCTIONS(batch)}\n\nReply with only a JSON object: {"segments": [{"n": 1, "what": "...", "shot": "...", "camera": "...", "energy": 3, "quality": [], "highlight": false, "tags": []}, ...]}`,
          },
        ],
      },
    };
  }
  let text = "";
  try {
    for await (const m of query({
      prompt: prompt(),
      options: {
        ...claudeExecutable(),
        env: claudeEnv(),
        model: VISION_MODEL.subscription,
        tools: [],
        maxTurns: 1,
        permissionMode: "dontAsk",
        settingSources: [],
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true },
        persistSession: false,
        cwd: tmpdir(),
        abortController: abort,
        systemPrompt:
          "You describe video footage for an editor, precisely and briefly. You reply with JSON only.",
      },
    })) {
      if (m.type === "result" && m.subtype === "success") text = m.result;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) throw new Error("no JSON in the reply");
  return Answer.parse(JSON.parse(json));
}
