/** Backend 1: the Claude API with your API key. A streaming tool-use loop we own end to end. */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { runTool, TOOLS, type ToolContext } from "./tools.ts";
import {
  AgentError,
  type BackendRun,
  STALL_MS,
  Stalled,
  StepLimit,
  toolActivity,
  Watchdog,
} from "./types.ts";

export function inputSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  return rest as Anthropic.Beta.BetaTool.InputSchema;
}

export const API_TOOLS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: inputSchema(t.input),
  // Big inputs (a 200-op rough cut) stream as they are generated; runTool validates them with zod.
  eager_input_streaming: true,
}));

export async function runWithApi(run: BackendRun, outer: ToolContext): Promise<string> {
  const client = new Anthropic();
  // A stream that goes quiet for good: stop, and keep what was done (runAgent).
  let current: { abort(): void } | null = null;
  const watchdog = new Watchdog(STALL_MS, () => current?.abort());
  const ctx: ToolContext = { ...outer, running: (busy) => watchdog.tool(busy) };
  try {
    return await loop(client, run, ctx, watchdog, (s) => {
      current = s;
    });
  } finally {
    watchdog.stop();
  }
}

async function loop(
  client: Anthropic,
  run: BackendRun,
  ctx: ToolContext,
  watchdog: Watchdog,
  track: (stream: { abort(): void }) => void,
): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: run.images?.length
        ? [
            ...run.images.map((i) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: i.mediaType, data: i.data },
            })),
            { type: "text" as const, text: run.prompt },
          ]
        : run.prompt,
    },
  ];
  let summary = "";

  for (let turn = 0; turn < run.maxTurns; turn++) {
    if (run.signal?.aborted) throw new AgentError("Stopped");
    const stream = client.beta.messages.stream(
      {
        model: run.model,
        max_tokens: 64_000,
        system: SYSTEM_PROMPT,
        // Web search and fetch run on Anthropic's side: checking facts, finding pages to capture.
        tools: [
          ...API_TOOLS,
          { type: "web_search_20260209", name: "web_search", max_uses: 8 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
        ] as Anthropic.Beta.BetaToolUnion[],
        messages,
        cache_control: { type: "ephemeral" },
        output_config: { effort: run.effort },
        // Its thinking, summarized, so the chat can show how it got to an edit.
        thinking: { type: "adaptive", display: run.thinking },
        // Route around a policy decline instead of failing the user's edit.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal: run.signal },
    );
    track(stream);
    let text = "";
    run.onActivity(turn === 0 ? "Reading the project…" : "Thinking it through…");
    let thinkingStarts = false;
    stream.on("streamEvent", (e) => {
      watchdog.beat();
      if (e.type === "content_block_delta" && e.delta.type === "thinking_delta" && e.delta.thinking) {
        run.onThinking(e.delta.thinking, thinkingStarts);
        thinkingStarts = false;
      }
      if (e.type !== "content_block_start") return;
      if (e.content_block.type === "tool_use" || e.content_block.type === "server_tool_use")
        run.onActivity(toolActivity(e.content_block.name));
      else if (e.content_block.type === "text") run.onActivity("Writing…");
      else if (e.content_block.type === "thinking") {
        run.onActivity("Thinking it through…");
        thinkingStarts = true;
      }
    });
    stream.on("text", (delta) => {
      // A turn's first words start its narration afresh (the last turn's is done).
      run.onText(delta, text === "");
      text += delta;
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (run.signal?.aborted) throw new AgentError("Stopped");
      if (watchdog.stalled) throw new Stalled(summary);
      if (err instanceof Anthropic.AuthenticationError)
        throw new AgentError(
          "Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY, or remove it to use your Claude subscription.",
        );
      if (err instanceof Anthropic.RateLimitError)
        throw new AgentError("Rate limited by the Claude API. Try again in a moment.");
      if (err instanceof Anthropic.APIError)
        throw new AgentError(`Claude API error ${err.status}: ${err.message}`);
      throw err;
    }
    if (text) summary = text;
    if (message.stop_reason === "refusal") throw new AgentError("The model declined this request.");
    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "pause_turn") continue;

    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) return summary.trim();
    if (message.stop_reason === "max_tokens")
      throw new AgentError("The edit was too large to finish in one pass. Try a smaller request.");

    // Edits depend on order, so tools run one at a time; results go back together in one message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const out = await runTool(call.name, call.input, ctx);
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: [
          ...(out.images ?? []).map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
          })),
          { type: "text" as const, text: out.text },
        ],
        ...(out.isError && { is_error: true }),
      });
    }
    messages.push({ role: "user", content: results });
  }
  throw new StepLimit(summary);
}
