/**
 * Backend 2: the Claude Agent SDK, signed in with the user's Claude subscription (no API key needed).
 * The same tools are served from an in-process MCP server; Claude Code's built-in tools are switched
 * off and nothing else is allowed, so the agent can only edit through our validated tools.
 */
import { tmpdir } from "node:os";
import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  type ModelInfo,
  type Query,
  query,
  type SDKRateLimitInfo,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentModel, AgentUsage } from "@vedit/bridge";
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

const MISSING = "Claude Code isn't installed. Open Settings → Claude to install it.";

const ERRORS: Record<string, string> = {
  authentication_failed: "Not signed in to Claude. Open Settings → Claude to sign in.",
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
  let askedLimits = false;
  let used = 0;
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
        env: claudeEnv(),
        // The editor's review when it wants to stop: what falls short goes back to it, and it carries on.
        ...(run.review && {
          hooks: {
            Stop: [
              {
                hooks: [
                  async () => {
                    const fix = await run.review?.();
                    return fix ? { decision: "block" as const, reason: fix } : {};
                  },
                ],
              },
            ],
          },
        }),
      },
    });
    for await (const message of stream) {
      watchdog.beat();
      // The plan's limits, once per request, alongside the work (it never holds the request up).
      if (!askedLimits && run.onUsage) {
        askedLimits = true;
        void planLimits(stream).then((limits) => limits && run.onUsage?.({ limits }));
      }
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
        case "rate_limit_event": {
          const window = limitWindow(message.rate_limit_info);
          if (window) run.onUsage?.({ limits: window });
          if (message.rate_limit_info.status === "rejected") {
            const at = message.rate_limit_info.resetsAt;
            throw new AgentError(
              `You've hit your Claude usage limit${at ? `; it resets at ${new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.`,
            );
          }
          break;
        }
        case "assistant": {
          if (message.error) throw new AgentError(ERRORS[message.error] ?? `Claude error: ${message.error}`);
          if (turnText) summary = turnText;
          // What this turn sent Claude: how full its context is. The last turn's is the request's peak.
          const u = message.message.usage;
          if (u && !message.parent_tool_use_id)
            used = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          break;
        }
        case "result": {
          const window =
            message.modelUsage[run.model]?.contextWindow ??
            Object.values(message.modelUsage)[0]?.contextWindow;
          if (used && window) run.onUsage?.({ context: { used, window } });
          if (message.subtype === "success") return (message.result || summary).trim();
          if (message.subtype === "error_max_turns") throw new StepLimit(summary);
          throw new AgentError("The agent stopped with an error. Try again.");
        }
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

/** Who Claude Code runs as, from what it reports when it starts (its account), and the plan's limits. */
export interface ClaudeAccount {
  readonly email?: string;
  readonly organization?: string;
  /** "Claude Max", "Claude Pro"...: signed in with a Claude plan. */
  readonly subscriptionType?: string;
  /** Where an API key comes from when Claude Code would use one (ahead of the plan): an env var, a helper, a Console login. */
  readonly apiKeySource?: string;
  readonly apiProvider?: string;
  readonly limits?: AgentUsage["limits"];
  /** The models Claude Code offers the account. */
  readonly models: readonly AgentModel[];
}

/**
 * What the agent will run as, found the way the agent runs: the same Claude Code, settings and
 * environment, started with a prompt that never comes, so it reports its account at start-up and is
 * stopped before anything reaches Anthropic (t3code's approach). Truer than `claude auth status`, which
 * reads the user's own settings: an API key there, say, is used ahead of a signed-in Claude plan.
 * Null when Claude Code couldn't be started.
 */
export async function probeClaude(timeoutMs = 25_000): Promise<ClaudeAccount | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const never = (async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise((resolve) => abort.signal.addEventListener("abort", resolve, { once: true }));
  })();
  try {
    const stream = query({
      prompt: never,
      options: {
        ...claudeExecutable(),
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true },
        persistSession: false,
        cwd: tmpdir(),
        abortController: abort,
        env: claudeEnv(),
      },
    });
    const { account, models } = await stream.initializationResult();
    const limits = account?.subscriptionType ? await planLimits(stream) : undefined;
    return {
      ...(account?.email && { email: account.email }),
      ...(account?.organization && { organization: account.organization }),
      ...(account?.subscriptionType && { subscriptionType: account.subscriptionType }),
      ...(account?.apiKeySource && account.apiKeySource !== "none" && { apiKeySource: account.apiKeySource }),
      ...(account?.apiProvider && { apiProvider: account.apiProvider }),
      ...(limits && { limits }),
      models: claudeModels(models ?? []),
    };
  } catch (err) {
    console.warn(`[claude] couldn't start Claude Code to see its account: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

/**
 * Claude Code's models for the account, one each, by the model it runs: an alias ("opus") as the model it
 * stands for, so a setting saved as either finds it; "default" is the one it stands for, marked.
 */
export function claudeModels(rows: readonly ModelInfo[]): AgentModel[] {
  const id = (m: ModelInfo) => m.resolvedModel ?? m.value;
  const pick = rows.find((m) => m.value === "default");
  const out = new Map<string, AgentModel>();
  for (const m of [...rows.filter((m) => m !== pick), ...(pick ? [pick] : [])]) {
    if (out.has(id(m))) continue;
    // The default row is named "Default (recommended)", the model's own name leading its description.
    const [name, about] =
      m === pick && m.description.includes(" · ")
        ? m.description.split(" · ", 2)
        : [m.displayName, m.description];
    out.set(id(m), {
      id: id(m),
      name: name || m.displayName,
      ...(about && { description: about }),
      efforts: m.supportedEffortLevels ?? [],
      ...(pick && id(pick) === id(m) && { isDefault: true }),
    });
  }
  return [...out.values()];
}

/** The Claude plan's 5-hour and weekly windows, from Claude Code's /usage; nothing if it can't say. */
async function planLimits(stream: Query): Promise<AgentUsage["limits"] | undefined> {
  try {
    const usage = await Promise.race([
      stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), 15_000)),
    ]);
    const r = usage.rate_limits;
    if (!usage.rate_limits_available || !r) return undefined;
    const window = (w: { utilization: number | null; resets_at: string | null } | null | undefined) =>
      w && w.utilization !== null
        ? { pct: w.utilization, ...(w.resets_at && { resetsAt: Date.parse(w.resets_at) }) }
        : undefined;
    const fiveHour = window(r.five_hour);
    const weekly = window(r.seven_day);
    return {
      ...(fiveHour && { fiveHour }),
      ...(weekly && { weekly }),
      ...(usage.subscription_type && { plan: usage.subscription_type }),
    };
  } catch (err) {
    console.warn(`[agent] plan usage unavailable: ${(err as Error).message}`);
    return undefined;
  }
}

/** A rate-limit notice from Claude, as the window it's about (5-hour or weekly), when it says how much is used. */
function limitWindow(info: SDKRateLimitInfo): AgentUsage["limits"] | undefined {
  if (info.utilization === undefined) return undefined;
  // A fraction in some versions, a percent in others.
  const w = {
    pct: info.utilization <= 1 ? info.utilization * 100 : info.utilization,
    ...(info.resetsAt && { resetsAt: info.resetsAt * 1000 }),
  };
  if (info.rateLimitType === "five_hour") return { fiveHour: w };
  if (info.rateLimitType === "seven_day") return { weekly: w };
  return undefined;
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

/**
 * The environment Claude Code runs with: the user's own Claude plan, so any Anthropic API credentials in
 * the environment are left out (Claude Code would bill those instead), and Cutroom says who it is.
 */
export function claudeEnv(): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _token, ...rest } = process.env;
  return { ...rest, CLAUDE_AGENT_SDK_CLIENT_APP: "cutroom/0.1" };
}
