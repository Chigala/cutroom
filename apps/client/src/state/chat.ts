/**
 * The conversation: what the user asked, and the agent's visible work for each request. It is saved in
 * the project folder, and the last few exchanges go to the agent with each request so follow-ups like
 * "shorter" or "bring the zooms back" make sense.
 */
import type { AgentContext, AgentEvent, AgentUsage, Backend, ChatRecord, WorkEntry } from "@vedit/bridge";
import type { Commit } from "@vedit/project";
import { create } from "zustand";
import { host } from "../lib/host.ts";
import { useProject } from "./project.ts";

export interface UserMessage {
  readonly kind: "user";
  readonly id: string;
  readonly at: number;
  readonly text: string;
  readonly context: AgentContext;
  /** Clips, images or screenshots sent with the message (source ids, in the project's library). */
  readonly attachments?: readonly string[];
  /** How it was sent, so a retry asks the same way. */
  readonly depth?: "quick" | "thorough";
}

export interface AgentRun {
  readonly kind: "agent";
  readonly id: string;
  readonly at: number;
  readonly runId: string | null;
  readonly backend: Backend | null;
  readonly steps: readonly { text: string; status: "done" | "warn" }[];
  /** The reply (once done; older records may carry the last narration). */
  readonly text: string;
  /** The work behind the reply, in order: narration between tools, tool calls, change steps. */
  readonly work: readonly WorkEntry[];
  /** A next request to offer in the composer. */
  readonly next?: string;
  /** While running: what it's doing right now. */
  readonly activity?: string;
  readonly status: "running" | "done" | "error" | "stopped";
  readonly commitId: string | null;
  readonly elapsedMs: number | null;
  readonly error: string | null;
}

/** Changes that didn't come from chat (imports, file edits), shown inline so the story is complete. */
export interface ChangeNote {
  readonly kind: "note";
  readonly id: string;
  readonly at: number;
  readonly commitId: string;
  /** An import: its clips index in the background, then (first import) the first cut or a choice. */
  readonly import?: {
    readonly sources: readonly string[];
    /** Into an empty project: the first cut is due (automatically, or offered). */
    readonly first: boolean;
    readonly ready: boolean;
  };
}

export type ChatItem = UserMessage | AgentRun | ChangeNote;

/** A message written while the agent was busy: it's sent when the current request finishes. */
export interface QueuedMessage {
  readonly id: string;
  readonly text: string;
  readonly context: AgentContext;
  readonly depth: "quick" | "thorough";
  readonly attachments: readonly string[];
}

interface ChatState {
  items: ChatItem[];
  activeRun: string | null;
  /** Messages waiting their turn, oldest first. */
  queue: QueuedMessage[];
  backend: Backend | null;
  /** Settings' autoFirstCut, mirrored for the switch on import cards. */
  autoFirstCut: boolean;
  /** Claude's latest figures: the last request's context, and the plan's limits (kept between launches). */
  usage: Usage;
}

export interface Usage {
  readonly context?: NonNullable<AgentUsage["context"]>;
  readonly limits?: NonNullable<AgentUsage["limits"]>;
}

const USAGE_KEY = "cutroom.usage";
function savedUsage(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}") as Usage;
    // Windows that have reset since are stale: drop them.
    const fresh = (w?: { resetsAt?: number }) => w && (!w.resetsAt || w.resetsAt > Date.now());
    const { fiveHour, weekly, plan } = u.limits ?? {};
    return {
      ...(u.context && { context: u.context }),
      limits: {
        ...(fresh(fiveHour) && { fiveHour }),
        ...(fresh(weekly) && { weekly }),
        ...(plan && { plan }),
      },
    };
  } catch {
    return {};
  }
}

/** New figures from Claude, merged over the last ones. */
function noteUsage(e: AgentUsage): void {
  set((s) => ({
    usage: {
      ...s.usage,
      ...(e.context && { context: e.context }),
      ...(e.limits && { limits: { ...s.usage.limits, ...e.limits } }),
    },
  }));
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(useChat.getState().usage));
  } catch {}
}

export const useChat = create<ChatState>()(() => ({
  items: [],
  activeRun: null,
  queue: [],
  backend: null,
  autoFirstCut: true,
  usage: savedUsage(),
}));

/** Auto: the first cut makes itself once clips are indexed. Manual: it waits to be asked. Sticks. */
export async function setAutoFirstCut(on: boolean): Promise<void> {
  set({ autoFirstCut: on });
  await host.settings.set({ autoFirstCut: on });
}

/** Starting points offered once clips are ready, in manual mode. */
export const STARTERS = [
  { label: "Make a first cut", prompt: "", thorough: true },
  {
    label: "Just tighten it",
    prompt: "Tighten this: cut the stumbles, repeats and dead air. Nothing else.",
    thorough: false,
  },
  {
    label: "Captions and a hook",
    prompt: "Add captions and a hook title. Keep the cut as it is.",
    thorough: false,
  },
  {
    label: "Make it a TikTok",
    prompt:
      "Make this a TikTok: a strong hook in the first second, tight pacing, captions, punch-ins and music.",
    thorough: true,
  },
] as const;

const set = useChat.setState;
let seq = 0;
const id = () => `m${Date.now().toString(36)}${++seq}`;

function updateRun(runId: string, patch: (run: AgentRun) => Partial<AgentRun>): void {
  set((s) => ({
    items: s.items.map((m) => (m.kind === "agent" && m.runId === runId ? { ...m, ...patch(m) } : m)),
  }));
}

/** The last few exchanges, as memory for the next request. */
function history(): { user: string; agent: string }[] {
  const turns: { user: string; agent: string }[] = [];
  const items = useChat.getState().items;
  items.forEach((m, i) => {
    if (m.kind !== "user") return;
    const reply = items.slice(i + 1).find((x): x is AgentRun => x.kind === "agent");
    const attached = m.attachments?.length ? `\n(attached: ${m.attachments.join(", ")})` : "";
    turns.push({ user: m.text + attached, agent: reply?.text || reply?.error || "" });
  });
  return turns.slice(-6);
}

export async function send(
  text: string,
  context: AgentContext = {},
  depth: "quick" | "thorough" = "quick",
  /** Source ids of clips, images or screenshots the message is about. */
  attachments: readonly string[] = [],
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Busy: it waits its turn, and goes when this request is done.
  if (useChat.getState().activeRun) {
    set((s) => ({ queue: [...s.queue, { id: id(), text: trimmed, context, depth, attachments }] }));
    return;
  }
  const memory = history();
  const runItem: AgentRun = {
    kind: "agent",
    id: id(),
    at: Date.now(),
    runId: null,
    backend: useChat.getState().backend,
    steps: [],
    work: [],
    text: "",
    status: "running",
    commitId: null,
    elapsedMs: null,
    error: null,
  };
  set((s) => ({
    items: [
      ...s.items,
      {
        kind: "user",
        id: id(),
        at: Date.now(),
        text: trimmed,
        context,
        depth,
        ...(attachments.length && { attachments }),
      },
      runItem,
    ],
    activeRun: "pending",
  }));
  try {
    const { runId } = await host.agent.run({
      prompt: trimmed,
      context,
      history: memory,
      depth,
      ...(attachments.length && { attachments: attachments.map((source) => ({ source })) }),
    });
    const merged = pendingEvents(runId, { ...runItem, runId });
    set((s) => ({
      activeRun: merged.status === "running" ? runId : null,
      items: s.items.map((m) => (m.id === runItem.id ? merged : m)),
    }));
    // It finished before run() even answered: the queue moves on all the same.
    if (merged.status === "done") setTimeout(sendNextQueued, 0);
  } catch (err) {
    set((s) => ({
      activeRun: null,
      items: s.items.map((m) =>
        m.id === runItem.id ? { ...runItem, status: "error", error: (err as Error).message } : m,
      ),
    }));
  }
  persist();
}

/**
 * Sends a failed or stopped request again: the attempt and its message make way for a fresh one (the
 * same words, context, attachments and depth), like retrying in Claude's apps.
 */
export function retry(runItemId: string): void {
  const { items, activeRun } = useChat.getState();
  if (activeRun) return;
  const at = items.findIndex((m) => m.id === runItemId);
  const asked = items.slice(0, at).findLast((m): m is UserMessage => m.kind === "user");
  if (at < 0 || !asked) return;
  set({ items: items.filter((m) => m.id !== runItemId && m.id !== asked.id) });
  void send(asked.text, asked.context, asked.depth ?? "quick", asked.attachments ?? []);
}

/** Takes a waiting message out of the queue. */
export function removeQueued(queuedId: string): void {
  set((s) => ({ queue: s.queue.filter((q) => q.id !== queuedId) }));
}

/** Sends the next waiting message, if nothing's running (after a stop or an error paused the queue). */
export function sendNextQueued(): void {
  const { queue, activeRun } = useChat.getState();
  const next = queue[0];
  if (!next || activeRun) return;
  set({ queue: queue.slice(1) });
  void send(next.text, next.context, next.depth, next.attachments);
}

export function stop(): void {
  const { activeRun } = useChat.getState();
  if (activeRun && activeRun !== "pending") void host.agent.cancel(activeRun);
}

/** Events can beat the run() reply; hold them until we know which message they belong to. */
const early = new Map<string, AgentEvent[]>();
function pendingEvents(runId: string, run: AgentRun): AgentRun {
  const events = early.get(runId) ?? [];
  early.delete(runId);
  let merged = run;
  for (const e of events) merged = { ...merged, ...reduce(merged, e) };
  return merged;
}

function reduce(run: AgentRun, e: AgentEvent): Partial<AgentRun> {
  switch (e.type) {
    case "start":
      return { backend: e.backend };
    case "step":
      return {
        steps: [...run.steps, { text: e.text, status: e.status }],
        work: [...run.work, { kind: "step", text: e.text, status: e.status }],
      };
    case "text": {
      // Each turn's narration is its own entry in the work, between the tools it explains.
      const last = run.work.at(-1);
      if (!e.turn && last?.kind === "text")
        return { work: [...run.work.slice(0, -1), { kind: "text", text: last.text + e.delta }] };
      return { work: [...run.work, { kind: "text", text: e.delta }] };
    }
    case "thinking": {
      // One entry per stretch of thinking, between the tools and narration around it.
      const last = run.work.at(-1);
      if (!e.block && last?.kind === "thinking")
        return { work: [...run.work.slice(0, -1), { kind: "thinking", text: last.text + e.delta }] };
      return { work: [...run.work, { kind: "thinking", text: e.delta }] };
    }
    case "tool": {
      const { runId: _, type: __, ...call } = e;
      const at = run.work.findIndex((w) => w.kind === "tool" && w.id === call.id);
      const entry: WorkEntry = { kind: "tool", ...call };
      return { work: at < 0 ? [...run.work, entry] : run.work.map((w, i) => (i === at ? entry : w)) };
    }
    case "activity":
      return { activity: e.text };
    case "usage":
      return {};
    case "done": {
      // The last turn's narration is the reply itself: it moves out of the work to stand on its own.
      const last = run.work.at(-1);
      const work = e.summary && last?.kind === "text" ? run.work.slice(0, -1) : run.work;
      return {
        status: "done",
        commitId: e.commit?.id ?? null,
        elapsedMs: e.elapsedMs,
        text: e.summary || (last?.kind === "text" ? last.text : run.text),
        work,
        ...(e.next && { next: e.next }),
      };
    }
    case "error":
      return {
        status: e.message === "Stopped" ? "stopped" : "error",
        error: e.message === "Stopped" ? null : e.message,
        elapsedMs: Date.now() - run.at,
      };
  }
}

/** The next request the last reply suggests, while nothing has been asked since. */
export function useSuggestion(): string | null {
  return useChat((s) => {
    const last = s.items.findLast((m) => m.kind !== "note");
    return last?.kind === "agent" && last.status === "done" && last.next ? last.next : null;
  });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Saves finished messages to the project folder (debounced; running ones are saved when they end). */
function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const records: ChatRecord[] = useChat.getState().items.flatMap((m): ChatRecord[] => {
      if (m.kind === "user")
        return [
          { kind: "user", text: m.text, at: m.at, ...(m.attachments && { attachments: m.attachments }) },
        ];
      if (m.kind === "note") return [{ kind: "note", commitId: m.commitId, at: m.at }];
      if (m.status === "running") return [];
      return [
        {
          kind: "agent",
          at: m.at,
          steps: m.steps,
          text: m.text,
          ...(m.work.length && { work: m.work }),
          ...(m.next && { next: m.next }),
          status: m.status,
          commitId: m.commitId,
          elapsedMs: m.elapsedMs,
          error: m.error,
        },
      ];
    });
    void host.project.saveChat(records).catch(() => {});
  }, 400);
}

async function loadChat(): Promise<void> {
  const records = await host.project.loadChat().catch(() => [] as ChatRecord[]);
  set({
    activeRun: null,
    // Waiting messages belong to the project they were written in.
    queue: [],
    items: records.map((r): ChatItem => {
      if (r.kind === "user")
        return {
          kind: "user",
          id: id(),
          at: r.at,
          text: r.text,
          context: {},
          ...(r.attachments && { attachments: r.attachments }),
        };
      if (r.kind === "note") return { kind: "note", id: id(), at: r.at, commitId: r.commitId };
      // Older records have only steps: they become the work.
      const work = r.work ?? r.steps.map((s): WorkEntry => ({ kind: "step", ...s }));
      return { ...r, work, kind: "agent", id: id(), runId: null, backend: null };
    }),
  });
}

export const FIRST_CUT_PROMPT =
  "Make a first cut from these clips. Cut retakes, stumbles and dead air, keep the best takes in a strong order, add a hook title, caption emphasis and a few punch-in zooms. Use music if there is a track.";

export function connectChat(): () => void {
  const offAgent = host.on("agent", (e) => {
    if (e.type === "start") set({ backend: e.backend });
    if (e.type === "usage") noteUsage(e);
    const known = useChat.getState().items.some((m) => m.kind === "agent" && m.runId === e.runId);
    if (!known) early.set(e.runId, [...(early.get(e.runId) ?? []), e]);
    else updateRun(e.runId, (run) => reduce(run, e));
    if (known && (e.type === "done" || e.type === "error")) {
      set((s) => (s.activeRun === e.runId ? { activeRun: null } : s));
      persist();
      // The queue moves on after a request that finished; a stop or an error pauses it.
      const run = useChat.getState().items.find((m) => m.kind === "agent" && m.runId === e.runId);
      if (run?.kind === "agent" && run.status === "done") setTimeout(sendNextQueued, 0);
    }
  });
  // Imports and outside file edits show up in the conversation as notes with undoable chips.
  const offCommits = host.on("commit", ({ commit }) => {
    if (commit.author === "agent" || commit.author === "index") return;
    noteCommit(commit);
  });
  // Clips finished indexing: the import card turns ready, and into an empty project the first cut makes
  // itself (auto) or is offered (manual).
  const offImport = host.on("importDone", async (e) => {
    const done = new Set(e.sources);
    set((s) => ({
      items: s.items.map((m) =>
        m.kind === "note" && m.import && !m.import.ready && m.import.sources.every((x) => done.has(x))
          ? { ...m, import: { ...m.import, ready: true } }
          : m,
      ),
    }));
    if (!e.firstImport || useChat.getState().activeRun) return;
    const settings = await host.settings.get();
    if (settings.autoFirstCut) void send(FIRST_CUT_PROMPT, {}, "thorough");
  });
  void host.agent.status().then((s) => set({ backend: s.backend }));
  void host.settings.get().then((s) => set({ autoFirstCut: s.autoFirstCut }));
  return () => {
    offAgent();
    offCommits();
    offImport();
  };
}

function noteCommit(commit: Commit): void {
  // An import adds clips that still need indexing; it's the first if nothing else was on the timeline.
  const added = commit.ops.flatMap((op) =>
    op.op === "insert" && op.coll === "sources" && (op.item as { status?: string }).status === "pending"
      ? [(op.item as { id: string }).id]
      : [],
  );
  const scenes = new Set(
    commit.ops.flatMap((op) =>
      op.op === "insert" && op.coll === "scenes" ? [(op.item as { id: string }).id] : [],
    ),
  );
  const first =
    scenes.size > 0 && !(useProject.getState().doc?.scenes ?? []).some((sc) => !scenes.has(sc.id));
  const note: ChangeNote = {
    kind: "note",
    id: id(),
    at: Date.now(),
    commitId: commit.id,
    ...(added.length && { import: { sources: added, first, ready: false } }),
  };
  set((s) => ({ items: [...s.items, note] }));
  persist();
}

/** Each project has its own conversation. */
useProject.subscribe((s, prev) => {
  if (s.dir && s.dir !== prev.dir) void loadChat();
});
