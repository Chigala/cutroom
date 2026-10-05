/**
 * Backend 2: the Claude Agent SDK, signed in with the user's Claude subscription (no API key needed).
 * The same tools are served from an in-process MCP server; Claude Code's built-in tools are switched
 * off and nothing else is allowed, so the agent can only edit through our validated tools.
 */
import { tmpdir } from "node:os";
import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  query,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
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

const SERVER = "editor";

function server(ctx: ToolContext): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: TOOLS.map((t) =>
      tool(t.name, t.description, t.input.shape, async (args) => {
        const out = await runTool(t.name, args, ctx);
        return {
          content: [
            ...(out.images ?? []).map((img) => ({
              type: "image" as const,
              data: img.data,
              mimeType: img.mediaType,
            })),
            { type: "text" as const, text: out.text },
          ],
          ...(out.isError && { isError: true }),
        };
      }),
    ),
  });
}

/**
 * The Claude Code to run: the one the app chose (VEDIT_CLAUDE_BIN: the user's install, a path from
 * Settings, or the app's own copy), else the SDK's built-in one.
 */
export function claudeExecutable(): { pathToClaudeCodeExecutable?: string } {
  const bin = process.env.VEDIT_CLAUDE_BIN;
  return bin ? { pathToClaudeCodeExecutable: bin } : {};
}

const MISSING =
  "Claude Code isn't installed. Open Settings → Claude to install it, or set ANTHROPIC_API_KEY.";

const ERRORS: Record<string, string> = {
  authentication_failed:
    "Not signed in to Claude. Open Settings → Claude to sign in, or set ANTHROPIC_API_KEY.",
  oauth_org_not_allowed: "Your Claude organization doesn't allow this sign-in.",
  billing_error: "Claude reported a billing problem with your account.",
  rate_limit: "You've hit your Claude usage limit. Try again later.",
  overloaded: "Claude is overloaded right now. Try again in a moment.",
};

export async function runWithSubscription(run: BackendRun, outer: ToolContext): Promise<string> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  run.signal?.addEventListener("abort", onAbort, { once: true });
  // A connection that goes quiet for good: stop, and keep what was done (runAgent).
  const watchdog = new Watchdog(STALL_MS, () => abort.abort());
  const ctx: ToolContext = { ...outer, running: (busy) => watchdog.tool(busy) };
  let summary = "";
  let turnText = "";
  let thinkingStarts = false;
  try {
    const stream = query({
      prompt: run.images?.length ? withImages(run.prompt, run.images) : run.prompt,
      options: {
        ...claudeExecutable(),
        systemPrompt: SYSTEM_PROMPT,
        model: run.model,
        effort: run.effort,
        // Its thinking, summarized, so the chat can show how it got to an edit.
        thinking: { type: "adaptive", display: run.thinking },
        mcpServers: { [SERVER]: server(ctx) },
        // Of Claude Code's own tools, only web search and fetch: checking facts, finding pages to capture.
        tools: ["WebSearch", "WebFetch"],
        allowedTools: [...TOOLS.map((t) => `mcp__${SERVER}__${t.name}`), "WebSearch", "WebFetch"],
        permissionMode: "dontAsk",
        // Isolation: only our editing tools. No user or project settings, no MCP servers from config
        // files, and none of the claude.ai account's connectors (mail, calendar...).
        settingSources: [],
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true },
        persistSession: false,
        includePartialMessages: true,
        maxTurns: run.maxTurns,
        // A neutral working directory: no project CLAUDE.md or settings leak into the editor's agent.
        cwd: tmpdir(),
        abortController: abort,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "ai-native-videoeditor/0.1" },
      },
    });
    for await (const message of stream) {
      watchdog.beat();
      switch (message.type) {
        case "stream_event": {
          const e = message.event;
          if (e.type === "message_start") turnText = "";
          if (e.type === "content_block_start") {
            if (e.content_block.type === "thinking") {
              run.onActivity("Thinking it through…");
              thinkingStarts = true;
            } else if (e.content_block.type === "tool_use")
              run.onActivity(toolActivity(e.content_block.name));
            else if (e.content_block.type === "text") run.onActivity("Writing…");
          }
          if (e.type === "content_block_delta" && e.delta.type === "thinking_delta" && e.delta.thinking) {
            run.onThinking(e.delta.thinking, thinkingStarts);
            thinkingStarts = false;
          }
          if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
            // A turn's first words start its narration afresh (the last turn's is done).
            run.onText(e.delta.text, turnText === "");
            turnText += e.delta.text;
          }
          break;
        }
        case "system":
          // Claude's servers pushing back: say so, rather than look stuck.
          if (message.subtype === "api_retry") {
            const why =
              message.error === "rate_limit"
                ? "rate limited"
                : message.error === "overloaded"
                  ? "overloaded"
                  : "not answering";
            console.warn(
              `[agent] api retry ${message.attempt}/${message.max_retries}: ${message.error} ${message.error_status ?? ""}`,
            );
            run.onActivity(
              `Claude is ${why}. Retrying in ${Math.round(message.retry_delay_ms / 1000)}s (attempt ${message.attempt} of ${message.max_retries})…`,
            );
          }
          break;
        case "rate_limit_event":
          if (message.rate_limit_info.status === "rejected") {
            const at = message.rate_limit_info.resetsAt;
            throw new AgentError(
              `You've hit your Claude usage limit${at ? `; it resets at ${new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.`,
            );
          }
          break;
        case "assistant":
          if (message.error) throw new AgentError(ERRORS[message.error] ?? `Claude error: ${message.error}`);
          if (turnText) summary = turnText;
          break;
        case "result":
          if (message.subtype === "success") return (message.result || summary).trim();
          if (message.subtype === "error_max_turns") throw new StepLimit(summary);
          throw new AgentError("The agent stopped with an error. Try again.");
      }
    }
    if (watchdog.stalled) throw new Stalled(summary);
    return summary.trim();
  } catch (err) {
    if (run.signal?.aborted) throw new AgentError("Stopped");
    if (watchdog.stalled) throw new Stalled(summary);
    if (err instanceof AgentError) throw err;
    const msg = (err as Error).message ?? String(err);
    if ((err as NodeJS.ErrnoException).code === "ENOENT" || /ENOENT|executable not found/i.test(msg))
      throw new AgentError(MISSING);
    if (/login|auth|credential/i.test(msg)) throw new AgentError(ERRORS.authentication_failed!);
    throw new AgentError(`Claude (subscription) failed: ${msg}`);
  } finally {
    watchdog.stop();
    run.signal?.removeEventListener("abort", onAbort);
  }
}

/** A first message with images (attachments), as the SDK's streaming input. */
async function* withImages(
  prompt: string,
  images: NonNullable<BackendRun["images"]>,
): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...images.map((i) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: i.mediaType, data: i.data },
        })),
        { type: "text" as const, text: prompt },
      ],
    },
  };
}
