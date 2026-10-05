/**
 * Library memes, described once by a vision model so the agent can find them by what they show ("Kai
 * Cenat shocked, mouth open"): a numbered sheet of thumbnails in, a name, a line and tags for each out.
 * Haiku with an API key, Sonnet on the subscription (as for footage, see describe.ts).
 */
import { tmpdir } from "node:os";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { inputSchema } from "./api.ts";
import { VISION_MODEL } from "./describe.ts";
import { claudeExecutable } from "./sdk.ts";
import type { Backend } from "./types.ts";

const Item = z.object({
  n: z.number().int().min(1),
  name: z.string().max(60).describe("A short name to find it by, 2-5 words"),
  what: z.string().max(200).describe("What it shows and the reaction or feeling it conveys, under 20 words"),
  tags: z.array(z.string().max(30)).max(8).describe("Lowercase search tags: who, emotion, use"),
});
const Answer = z.object({ items: z.array(Item) });
export type AssetDescription = Omit<z.infer<typeof Item>, "n">;

const INSTRUCTIONS = (count: number, hints: readonly string[]) =>
  `This sheet shows ${count} memes, stickers or reaction images from a video editor's asset library, numbered 1 to ${count} (left to right, top to bottom). Their file names: ${hints.map((h, i) => `${i + 1}. ${h}`).join("; ")}.

For each, record a short name, what it shows and the reaction or feeling it conveys (shocked, laughing, cringe, disbelief...), and tags. Use a person's name only if it's in the file name, written in the image, or the person is unmistakably famous. Return exactly ${count} items, n = 1 to ${count}.`;

/** Descriptions for up to 12 thumbnails on one sheet, in order; null where nothing came back. */
export async function describeAssets(
  sheet: Buffer,
  fileNames: readonly string[],
  backend: Backend,
  signal?: AbortSignal,
): Promise<(AssetDescription | null)[]> {
  const image = {
    type: "image" as const,
    source: { type: "base64" as const, media_type: "image/jpeg" as const, data: sheet.toString("base64") },
  };
  const text = INSTRUCTIONS(fileNames.length, fileNames);
  let answer: z.infer<typeof Answer>;
  if (backend === "api") {
    const tool = {
      name: "record_items",
      description: "Record every item.",
      input_schema: inputSchema(Answer) as Anthropic.Tool.InputSchema,
    };
    const response = await new Anthropic().messages.create(
      {
        model: VISION_MODEL.api,
        max_tokens: 4000,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: [image, { type: "text", text }] }],
      },
      { ...(signal && { signal }) },
    );
    const call = response.content.find((b) => b.type === "tool_use");
    if (call?.type !== "tool_use") throw new Error("no descriptions came back");
    answer = Answer.parse(call.input);
  } else {
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
            image,
            {
              type: "text",
              text: `${text}\n\nReply with only a JSON object: {"items": [{"n": 1, "name": "...", "what": "...", "tags": []}, ...]}`,
            },
          ],
        },
      };
    }
    let reply = "";
    try {
      for await (const m of query({
        prompt: prompt(),
        options: {
          ...claudeExecutable(),
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
            "You catalogue memes and stickers for a video editor, briefly. You reply with JSON only.",
        },
      })) {
        if (m.type === "result" && m.subtype === "success") reply = m.result;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    const json = /\{[\s\S]*\}/.exec(reply)?.[0];
    if (!json) throw new Error("no JSON in the reply");
    answer = Answer.parse(JSON.parse(json));
  }
  const byN = new Map(answer.items.map((i) => [i.n, i]));
  return fileNames.map((_, i) => {
    const hit = byN.get(i + 1);
    return hit ? { name: hit.name, what: hit.what, tags: hit.tags } : null;
  });
}
