/**
 * One agent request: plan, edit, run checks, fix, report. The agent works on a scratch copy of the
 * project (a private branch, in effect) and returns its edits as labelled op groups. The host commits
 * them on top of whatever the user did meanwhile; ops are id-addressed, so that rebase almost always
 * just works.
 *
 * Several agents, same tools: each harness (harness.ts) runs the conversation on the user's own sign-in:
 * Claude Code on their Claude plan, Codex on their ChatGPT plan. The Claude API loop (api.ts) is kept
 * for a later cloud tier but switched off.
 */
import type { AgentContext, AgentUsage, HarnessId, ToolCall } from "@vedit/bridge";
import { applyOps, type ChangeGroup, type Op, type ProjectDoc, type Source } from "@vedit/project";
import { runWithApi } from "./api.ts";
import { buildPrompt, type Turn } from "./context.ts";
import { HARNESSES } from "./harness.ts";
import { finishReview } from "./review.ts";
import { type AgentHost, refitMusic, type Scratch, snapCutsToBeat, type ToolContext } from "./tools.ts";
import { type Backend, type Effort, Stalled, StepLimit } from "./types.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface AgentOptions {
  readonly doc: ProjectDoc;
  readonly prompt: string;
  readonly context?: AgentContext;
  readonly history?: readonly Turn[];
  /** Source ids the user attached to this request. */
  readonly attachments?: readonly string[];
  /** The user's hand edits since the agent's last change (handEdits of the project's log). */
  readonly handEdits?: readonly string[];
  readonly host: AgentHost;
  readonly backend?: Backend;
  /** Which agent runs it (Claude by default). */
  readonly harness?: HarnessId;
  readonly model?: string;
  /** Editing is interactive, so latency matters: medium by default, high for first cuts. */
  readonly effort?: Effort;
  /** Model turns before it has to stop (40 by default; a first cut needs more). */
  readonly maxTurns?: number;
  /**
   * The editor's review before the agent may finish (review.ts): "full" measures the motion whenever
   * something that moves changed (first cuts, big requests); "light" only when it wrote a graphic.
   */
  readonly review?: "full" | "light";
  /** Stream its thinking to onThinking (default), or leave it out. */
  readonly showThinking?: boolean;
  readonly signal?: AbortSignal;
  onStep?(text: string, status: "done" | "warn"): void;
  onText?(delta: string, turn?: boolean): void;
  onThinking?(delta: string, block?: boolean): void;
  onActivity?(text: string): void;
  onUsage?(usage: AgentUsage): void;
  onTool?(call: ToolCall): void;
  /** Each change group as it's applied, for the editor's live draft. */
  onDraft?(label: string, ops: readonly Op[]): void;
  /**
   * What indexing writes to the project while the request runs (an attached clip finishing, its words
   * and shots), so the request's copy takes it in. Returns the unsubscribe.
   */
  indexed?(listener: (ops: readonly Op[]) => void): () => void;
}

export interface AgentResult {
  readonly ops: Op[];
  readonly groups: ChangeGroup[];
  readonly summary: string;
  /** A next request the editor might make, offered in the composer. */
  readonly next?: string;
  readonly doc: ProjectDoc;
}

/**
 * The Claude subscription the user signed in to Claude Code with. The API backend (api.ts) is kept,
 * but switched off for now: Cutroom runs on each person's own Claude plan.
 */
export function defaultBackend(): Backend {
  return "subscription";
}

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const scratch: Scratch = { doc: opts.doc, ops: [], groups: [] };
  // Indexing that lands meanwhile goes into the copy too (the host's commit of the agent's ops sits on
  // top of it all the same). One about a clip the agent has since removed isn't needed.
  const unsubscribe = opts.indexed?.((ops) => {
    try {
      scratch.doc = applyOps(scratch.doc, ops).doc;
    } catch {}
  });
  const ctx: ToolContext = {
    scratch,
    followsIndexing: Boolean(unsubscribe),
    host: opts.host,
    step: (text, status = "done") => opts.onStep?.(text, status),
    activity: (text) => opts.onActivity?.(text),
    tool: (call) => opts.onTool?.(call),
    draft: (label, ops) => opts.onDraft?.(label, ops),
  };
  try {
    const attached = (opts.attachments ?? [])
      .map((id) => opts.doc.sources.find((s) => s.id === id))
      .filter((s) => s !== undefined);
    const recent = opts.doc.design.idea ? [] : ((await opts.host.recentDesigns?.().catch(() => [])) ?? []);
    let run = {
      prompt: buildPrompt(
        opts.doc,
        opts.prompt,
        opts.context,
        opts.history ?? [],
        attached,
        opts.handEdits,
        recent,
      ),
      images: await attachmentImages(attached, opts.host),
      model: opts.model ?? DEFAULT_MODEL,
      effort: opts.effort ?? "medium",
      maxTurns: opts.maxTurns ?? 40,
      thinking: opts.showThinking === false ? ("omitted" as const) : ("summarized" as const),
      ...(opts.signal && { signal: opts.signal }),
      onText: (delta: string, turn?: boolean) => opts.onText?.(delta, turn),
      onThinking: (delta: string, block?: boolean) => opts.onThinking?.(delta, block),
      onActivity: (text: string) => opts.onActivity?.(text),
      onUsage: (usage: AgentUsage) => opts.onUsage?.(usage),
      review: finishReview(opts.doc, ctx, opts.review ?? "full"),
    };
    const backend = opts.backend ?? defaultBackend();
    const harness = HARNESSES[opts.harness ?? "claude"];
    for (let resumed = 0; ; resumed++) {
      try {
        const reply = backend === "api" ? await runWithApi(run, ctx) : await harness.run(run, ctx);
        await refitMusic(ctx);
        snapCutsToBeat(ctx);
        const { summary, next } = splitNext(reply);
        return { ops: scratch.ops, groups: scratch.groups, summary, ...(next && { next }), doc: scratch.doc };
      } catch (err) {
        // The agent went silent mid-request (a stalled connection): pick up where it stopped, on the work
        // so far, rather than end the request half done. Twice at most.
        if (err instanceof Stalled && resumed < MAX_RESUMES && !opts.signal?.aborted) {
          ctx.step(`${harness.name} stalled; picking up where it stopped`, "warn");
          run = {
            ...run,
            prompt: buildPrompt(
              scratch.doc,
              resumePrompt(
                opts.prompt,
                scratch.groups.map((g) => g.label),
              ),
              opts.context,
              opts.history ?? [],
              attached,
              opts.handEdits,
            ),
          };
          continue;
        }
        // Out of turns, or stalled again: keep what it did (often most of a first cut) rather than throw
        // it all away.
        if (!(err instanceof StepLimit) || !scratch.ops.length) throw err;
        const stalled = err instanceof Stalled;
        ctx.step(
          stalled ? `${harness.name} stopped responding` : "Ran out of steps before finishing",
          "warn",
        );
        const summary = [
          err.partial,
          `${stalled ? `${harness.name} stopped responding partway through` : "I ran out of steps before I could finish"}, so I kept everything I'd done. Say "carry on" and I'll pick up where I stopped (checks, motion and the cover may still need a pass).`,
        ]
          .filter(Boolean)
          .join("\n\n");
        await refitMusic(ctx);
        snapCutsToBeat(ctx);
        return { ops: scratch.ops, groups: scratch.groups, summary, doc: scratch.doc };
      }
    }
  } finally {
    unsubscribe?.();
  }
}

/**
 * The reply's closing "Next: ..." line (a request the editor might make next, which the prompt asks
 * for) taken off the reply: the composer offers it instead.
 */
export function splitNext(reply: string): { summary: string; next?: string } {
  const m = /\n*^[*_]*next[*_]*:[*_]*\s*(.+?)\s*$(?![\s\S])/im.exec(reply.trimEnd());
  if (!m) return { summary: reply };
  const next = m[1]!.replace(/^["“'*_]+|["”'*_]+$/g, "").trim();
  return { summary: reply.trimEnd().slice(0, m.index).trimEnd(), ...(next && { next: next.slice(0, 200) }) };
}

/** How many times a stalled request picks up again by itself. */
const MAX_RESUMES = 2;

/** The request again, for picking up after a stall: what's already done is in the project. */
export function resumePrompt(request: string, done: readonly string[]): string {
  return [
    request,
    "",
    `(You were partway through this request when the connection to you stalled. What you had already done is in the project now${done.length ? `: ${done.join("; ")}` : ""}. Don't redo or undo it: check the project as it is and carry on with what's left of the request.)`,
  ].join("\n");
}

/**
 * What the model sees of the attachments up front: a photo or screenshot whole (wide enough to read
 * text in it), and one frame from the middle of a clip. It can look at more of a clip with look.
 */
async function attachmentImages(
  sources: readonly Source[],
  host: AgentHost,
): Promise<{ data: string; mediaType: "image/jpeg" }[]> {
  const shots = await Promise.all(
    sources.map(async (s) => {
      if (s.kind !== "image" && s.kind !== "video") return null;
      try {
        const jpeg =
          s.kind === "image" ? await host.frame(s.id, 0, 1280) : await host.frame(s.id, s.duration / 2, 768);
        return { data: jpeg.toString("base64"), mediaType: "image/jpeg" as const };
      } catch {
        return null;
      }
    }),
  );
  return shots.filter((x) => x !== null);
}
