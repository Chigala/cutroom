/**
 * The Codex harness: OpenAI's Codex, signed in with the user's ChatGPT plan, driving the same editing
 * tools as Claude. Codex's app server runs a thread with no environment (no shell, no file edits, no
 * reading the disk) and Cutroom's tools as its own ("dynamic tools", answered here in-process, frames and
 * all), Cutroom's system prompt in place of Codex's coding one, and nothing from the user's own Codex
 * setup (Cutroom has its own Codex folder). Live web search stays, as Claude has it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentUsage } from "@vedit/bridge";
import { z } from "zod";
import { CodexError, type CodexLaunch, CodexServer } from "./codex-rpc.ts";
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

const NOT_INSTALLED = "Codex isn't installed. Open Settings → Agent to set it up.";
const SIGNED_OUT = "Codex isn't signed in. Open Settings → Agent and sign in with ChatGPT.";

/**
 * Everything Codex would add beyond our tools, switched off for the whole server: shell, image viewing,
 * sub-agents, apps and plugins, image generation, memories, hooks, its own planning and question tools,
 * the instructions it adds about sandboxes and environments, AGENTS.md files, history and analytics.
 * The thread's empty environment already removes shell, file edits and image viewing; this is the second
 * lock.
 */
export const CODEX_LOCKDOWN: Readonly<Record<string, string | number | boolean>> = {
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.view_image": false,
  "features.multi_agent": false,
  "agents.enabled": false,
  "features.apps": false,
  "features.plugins": false,
  "features.tool_suggest": false,
  "features.image_generation": false,
  "features.memories": false,
  "features.hooks": false,
  "features.browser_use": false,
  "features.computer_use": false,
  "features.shell_snapshot": false,
  "tools.update_plan.enabled": false,
  "tools.experimental_request_user_input.enabled": false,
  web_search: "live",
  include_permissions_instructions: false,
  include_environment_context: false,
  include_apps_instructions: false,
  include_collaboration_mode_instructions: false,
  "skills.include_instructions": false,
  project_doc_max_bytes: 0,
  "history.persistence": "none",
  "analytics.enabled": false,
  "feedback.enabled": false,
  check_for_update_on_startup: false,
  cli_auth_credentials_store: "file",
};

/** Where the app put Codex and Cutroom's own Codex folder (VEDIT_CODEX_BIN, VEDIT_CODEX_HOME). */
export function codexInstall(): { bin: string; home: string; prefix?: string[] } | null {
  const bin = process.env.VEDIT_CODEX_BIN;
  const home = process.env.VEDIT_CODEX_HOME;
  // A script to run with `bin` first (tests run a stand-in Codex this way).
  const prefix = process.env.VEDIT_CODEX_PREFIX;
  return bin && home ? { bin, home, ...(prefix && { prefix: [prefix] }) } : null;
}

export const codexVersion = () => process.env.VEDIT_VERSION ?? "0.1.0";

/** A Codex app server for Cutroom: its own folder, the lock-down on, in a working folder of its own. */
export async function startCodex(cwd: string, launch?: Partial<CodexLaunch>): Promise<CodexServer> {
  const install = codexInstall();
  if (!install) throw new AgentError(NOT_INSTALLED);
  const server = new CodexServer({ ...install, cwd, config: CODEX_LOCKDOWN, ...launch });
  try {
    await server.start(codexVersion());
  } catch (err) {
    server.close();
    throw missing((err as Error).message) ? new AgentError(NOT_INSTALLED) : err;
  }
  return server;
}

/** The tools, as Codex's dynamic tools: one namespace, each with its JSON Schema. */
function codexTools() {
  return [
    {
      type: "namespace" as const,
      name: "cutroom",
      description: "Cutroom's editing tools: the only way to read and change the video project.",
      tools: TOOLS.map((t) => {
        const { $schema: _, ...inputSchema } = z.toJSONSchema(t.input, {
          io: "input",
          unrepresentable: "any",
        });
        return { type: "function" as const, name: t.name, description: t.description, inputSchema };
      }),
    },
  ];
}

/** Codex's reasoning efforts, least to most, to find the nearest one a model offers. */
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

interface CodexModel {
  readonly model: string;
  readonly isDefault?: boolean;
  readonly supportedReasoningEfforts: readonly { reasoningEffort: string }[];
  readonly defaultReasoningEffort: string;
  readonly inputModalities?: readonly string[];
}

/** The effort to ask for: ours, or the nearest below it the model supports (its default otherwise). */
export function nearestEffort(wanted: string, model: CodexModel | undefined): string | undefined {
  if (!model) return undefined;
  const offered = new Set(model.supportedReasoningEfforts.map((e) => e.reasoningEffort));
  for (let i = EFFORTS.indexOf(wanted); i >= 0; i--) if (offered.has(EFFORTS[i]!)) return EFFORTS[i];
  return model.defaultReasoningEffort;
}

/** A rate-limit snapshot as the plan's 5-hour and weekly windows (by how long each window is). */
export function codexLimits(snapshot: {
  primary: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null;
  secondary: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null;
  planType?: string | null;
}): AgentUsage["limits"] | undefined {
  const limits: {
    fiveHour?: { pct: number; resetsAt?: number };
    weekly?: { pct: number; resetsAt?: number };
    plan?: string;
  } = {};
  for (const w of [snapshot.primary, snapshot.secondary]) {
    if (!w) continue;
    const window = { pct: w.usedPercent, ...(w.resetsAt && { resetsAt: w.resetsAt * 1000 }) };
    if ((w.windowDurationMins ?? 0) >= 24 * 60) limits.weekly = window;
    else limits.fiveHour = window;
  }
  if (snapshot.planType) limits.plan = snapshot.planType;
  return limits.fiveHour || limits.weekly ? limits : undefined;
}

export async function runWithCodex(run: BackendRun, outer: ToolContext): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "cutroom-codex-"));
  const watchdog = new Watchdog(STALL_MS, () => stop("stalled"));
  const ctx: ToolContext = { ...outer, running: (busy) => watchdog.tool(busy) };
  let server: CodexServer | null = null;
  let threadId = "";
  let turnId = "";
  let reply = "";
  let tools = 0;
  let stopped: "user" | "stalled" | "limit" | null = null;
  const texts = new Map<string, string>();
  let lastText = "";
  let thinking = "";
  // How the turn ended: Codex saying so, Codex gone, or a stop it didn't answer in time.
  let finish!: (end: { status: string; error?: string }) => void;
  const done = new Promise<{ status: string; error?: string }>((resolve) => {
    finish = resolve;
  });
  let forced: ReturnType<typeof setTimeout> | undefined;
  const stop = (why: "user" | "stalled" | "limit") => {
    stopped ??= why;
    if (!server || !threadId || !turnId) {
      // Not running a turn yet: stop starting one (what's waiting on Codex fails, and the catch says why).
      finish({ status: "interrupted" });
      server?.close();
      return;
    }
    void server.request("turn/interrupt", { threadId, turnId }).catch(() => {});
    // Codex should end the turn at once; if it doesn't (hung, gone), end it here.
    forced ??= setTimeout(() => {
      finish({ status: "interrupted" });
      server?.close();
    }, 10_000);
  };
  const onAbort = () => stop("user");
  run.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    server = await startCodex(cwd);
    // Stopped while Codex was starting: nothing to run.
    if (stopped) throw new AgentError("Stopped");
    const live = server;
    // Codex gone (crashed, killed): the turn is over, whatever it was doing.
    void live.exited.then((err) => finish({ status: "failed", error: err.message }));
    const [{ account, requiresOpenaiAuth }, { data: models }] = await Promise.all([
      live.request<{ account: unknown; requiresOpenaiAuth: boolean }>("account/read", {
        refreshToken: false,
      }),
      live.request<{ data: CodexModel[] }>("model/list", {}),
    ]);
    if (!account && requiresOpenaiAuth) throw new AgentError(SIGNED_OUT);
    const model = models.find((m) => m.model === run.model) ?? models.find((m) => m.isDefault) ?? models[0];
    if (run.model && model?.model !== run.model)
      console.warn(
        `[codex] ${run.model} isn't offered on this plan; using ${model?.model ?? "Codex's default"}`,
      );
    // The agent edits by looking at frames: a model that can't see them would edit blind.
    if (model?.inputModalities && !model.inputModalities.includes("image"))
      throw new AgentError(
        `${model.model} can't look at images, and the editor shows the agent frames of your video. Pick another model in Settings → Agent.`,
      );
    live.on((method, params) => {
      watchdog.beat();
      const p = params as Record<string, unknown>;
      switch (method) {
        case "item/started": {
          const item = p.item as { type: string; tool?: string };
          if (item.type === "dynamicToolCall") run.onActivity(toolActivity(item.tool ?? ""));
          else if (item.type === "reasoning") run.onActivity("Thinking it through…");
          else if (item.type === "agentMessage") run.onActivity("Writing…");
          else if (item.type === "webSearch") run.onActivity("Searching the web");
          break;
        }
        case "item/agentMessage/delta": {
          const { itemId, delta } = p as unknown as { itemId: string; delta: string };
          const was = texts.get(itemId);
          // A new message starts its narration afresh (the last one is done).
          run.onText(delta, was === undefined);
          texts.set(itemId, (was ?? "") + delta);
          lastText = texts.get(itemId)!;
          break;
        }
        case "item/reasoning/summaryTextDelta": {
          const { itemId, summaryIndex, delta } = p as unknown as {
            itemId: string;
            summaryIndex: number;
            delta: string;
          };
          const key = `${itemId}:${summaryIndex}`;
          run.onThinking(delta, thinking !== key);
          thinking = key;
          break;
        }
        case "thread/tokenUsage/updated": {
          const u = (
            p as unknown as {
              tokenUsage: { last: { totalTokens: number }; modelContextWindow: number | null };
            }
          ).tokenUsage;
          if (u.modelContextWindow)
            run.onUsage?.({ context: { used: u.last.totalTokens, window: u.modelContextWindow } });
          break;
        }
        case "account/rateLimits/updated": {
          const limits = codexLimits(
            (p as unknown as { rateLimits: Parameters<typeof codexLimits>[0] }).rateLimits,
          );
          if (limits) run.onUsage?.({ limits });
          break;
        }
        case "error": {
          const { error, willRetry } = p as unknown as { error: { message: string }; willRetry: boolean };
          if (willRetry) run.onActivity(`Codex hit a problem (${error.message.slice(0, 80)}). Retrying…`);
          break;
        }
        case "item/completed": {
          // A message that came whole, not streamed: shown and kept the same.
          const item = p.item as { type: string; id: string; text?: string };
          if (item.type !== "agentMessage" || typeof item.text !== "string") break;
          if (!texts.has(item.id) && item.text) run.onText(item.text, true);
          texts.set(item.id, item.text);
          lastText = item.text;
          break;
        }
        case "turn/completed": {
          const turn = (p as unknown as { turn: { status: string; error: { message: string } | null } }).turn;
          finish({ status: turn.status, ...(turn.error && { error: turn.error.message }) });
          break;
        }
      }
    });

    // Codex's own requests: our tools, run here; anything that would touch the computer, declined.
    live.onRequest = async (method, params) => {
      watchdog.beat();
      switch (method) {
        case "item/tool/call": {
          const { tool, arguments: args } = params as { tool: string; arguments: unknown };
          // Codex has no turn limit of its own: a request gets as many tool calls as Claude's turns allow.
          if (++tools > run.maxTurns * 2) {
            stop("limit");
            return {
              success: false,
              contentItems: [{ type: "inputText", text: "Out of steps: stop here and say what's left." }],
            };
          }
          const out = await runTool(tool, args, ctx);
          return {
            success: !out.isError,
            contentItems: [
              { type: "inputText", text: out.text },
              ...(out.images ?? []).map((img) => ({
                type: "inputImage",
                imageUrl: `data:${img.mediaType};base64,${img.data}`,
              })),
            ],
          };
        }
        case "currentTime/read":
          return { currentTimeAt: Math.floor(Date.now() / 1000) };
        case "item/commandExecution/requestApproval":
        case "item/fileChange/requestApproval":
          return { decision: "decline" };
        case "execCommandApproval":
        case "applyPatchApproval":
          return { decision: { denied: { rejection: "Cutroom edits through its own tools only." } } };
        case "item/tool/requestUserInput":
          return { answers: {} };
        case "mcpServer/elicitation/request":
          return { action: "decline", content: null, _meta: null };
        default:
          throw new CodexError(`Cutroom doesn't handle ${method}`);
      }
    };

    const thread = await live.request<{ thread: { id: string }; instructionSources: string[] }>(
      "thread/start",
      {
        cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: SYSTEM_PROMPT,
        ephemeral: true,
        // No environment: no shell, no file edits, no reading files. Only the tools below.
        environments: [],
        dynamicTools: codexTools(),
        ...(model && { model: model.model }),
      },
    );
    threadId = thread.thread.id;
    if (thread.instructionSources.length)
      console.warn(`[codex] instructions loaded besides Cutroom's: ${thread.instructionSources.join(", ")}`);

    const effort = nearestEffort(run.effort, model);
    const turn = await live.request<{ turn: { id: string } }>("turn/start", {
      threadId,
      input: [
        { type: "text", text: run.prompt, text_elements: [] },
        ...(run.images ?? []).map((i) => ({ type: "image", url: `data:${i.mediaType};base64,${i.data}` })),
      ],
      ...(model && { model: model.model }),
      ...(effort && { effort }),
      summary: run.thinking === "omitted" ? "none" : "detailed",
    });
    turnId = turn.turn.id;
    if (stopped) stop(stopped);
    void live
      .request<{ rateLimits: Parameters<typeof codexLimits>[0] }>("account/rateLimits/read")
      .then((r) => {
        const limits = codexLimits(r.rateLimits);
        if (limits) run.onUsage?.({ limits });
      })
      .catch(() => {});

    const end = await done;
    reply = lastText;
    if (stopped === "user") throw new AgentError("Stopped");
    if (stopped === "stalled") throw new Stalled(reply);
    if (stopped === "limit") throw new StepLimit(reply);
    if (end.status === "failed") throw new AgentError(friendly(end.error ?? "Codex stopped with an error."));
    return reply.trim();
  } catch (err) {
    if (run.signal?.aborted || stopped === "user") throw new AgentError("Stopped");
    if (stopped === "stalled") throw new Stalled(reply);
    if (stopped === "limit") throw new StepLimit(reply);
    if (err instanceof AgentError) throw err;
    throw new AgentError(friendly((err as Error).message));
  } finally {
    clearTimeout(forced);
    watchdog.stop();
    run.signal?.removeEventListener("abort", onAbort);
    server?.close();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

/** Codex itself couldn't be started: not there, or not runnable. */
const missing = (message: string) => /ENOENT|EACCES|spawn .* (ENOENT|EACCES)/i.test(message);

/** Codex's failures, in words for the chat. */
function friendly(message: string): string {
  if (missing(message)) return NOT_INSTALLED;
  if (/\bmodel\b.*\b(not found|does not exist|not supported|unsupported|unknown)\b/i.test(message))
    return "The Codex model chosen in Settings isn't available on your plan. Pick another in Settings → Agent.";
  if (
    /\b401\b|unauthori[sz]ed|not (signed|logged) in|log ?in (required|again)|auth(entication)? (required|failed|expired)|(token|session) (expired|revoked|invalid)|refresh_token/i.test(
      message,
    )
  )
    return SIGNED_OUT;
  if (/usage limit|rate limit|\b429\b/i.test(message))
    return "You've hit your ChatGPT plan's Codex limit. Try again later.";
  return `Codex failed: ${message.slice(0, 300)}`;
}
