/**
 * The window's replica of the project. Edits apply locally first (optimistic, so the UI responds in the
 * same frame), then go to the host, which is the single writer and the source of truth. Commits the
 * host makes on its own (agent, file edits, imports) arrive as events and replay here.
 */
import type { CommitRequest, ProjectSnapshot } from "@vedit/bridge";
import {
  applyOps,
  type ChangeGroup,
  type Commit,
  type Op,
  OpError,
  type ProjectDoc,
  replay,
  revertOps,
  summarize,
} from "@vedit/project";
import { create } from "zustand";
import { host, setMediaProject } from "../lib/host.ts";
import { toast } from "./toast.ts";

export interface ProjectState {
  status: "loading" | "ready" | "error";
  error: string | null;
  dir: string;
  doc: ProjectDoc | null;
  head: string | null;
  /** Commits this window knows about, oldest first. */
  commits: Commit[];
  /** "<commit>" or "<commit>:<group>" for everything that has been undone. */
  reverted: ReadonlySet<string>;
  /** Item ids the agent's latest edit touched, outlined on the timeline until you make your own edit. */
  agentTouched: ReadonlySet<string>;
  undoStack: string[];
  redoStack: string[];
}

const initial: ProjectState = {
  status: "loading",
  error: null,
  dir: "",
  doc: null,
  head: null,
  commits: [],
  reverted: new Set(),
  agentTouched: new Set(),
  undoStack: [],
  redoStack: [],
};

export const useProject = create<ProjectState>()(() => initial);

/** The doc, for components rendered only once a project is loaded. */
export const useDoc = <T>(select: (doc: ProjectDoc) => T): T => useProject((s) => select(s.doc!));

const set = useProject.setState;
const get = useProject.getState;

const TIMELINE_COLLS = ["scenes", "zooms", "titles", "visuals", "effects", "sfx", "captions"] as const;

/**
 * What to outline after an agent edit. A targeted change ("punch in on the reveal") outlines its items;
 * a pass that rebuilt most of the timeline outlines nothing, since lighting up every block points at
 * nothing (the chat's change chips cover that case).
 */
function touchedIds(commit: Commit, doc: ProjectDoc | null): Set<string> {
  const ids = new Set<string>();
  for (const op of commit.ops) {
    if (op.op === "insert") ids.add(op.item.id);
    else if ("id" in op) ids.add(op.id);
  }
  const total = doc ? TIMELINE_COLLS.reduce((n, c) => n + doc[c].length, 0) : 0;
  return total && ids.size > Math.max(6, total * 0.4) ? new Set() : ids;
}

const keyOf = (r: NonNullable<Commit["reverts"]>) =>
  r.group === undefined ? r.commit : `${r.commit}:${r.group}`;

/** Folds one commit into the set of undone keys. Undoing an undo (redo) brings the original back. */
function applyRevert(keys: Set<string>, commit: Commit, all: readonly Commit[]): void {
  if (!commit.reverts) return;
  keys.add(keyOf(commit.reverts));
  const target = all.find((c) => c.id === commit.reverts!.commit);
  if (target?.reverts && commit.reverts.group === undefined) keys.delete(keyOf(target.reverts));
}

function revertedKeys(commits: readonly Commit[]): Set<string> {
  const keys = new Set<string>();
  for (const c of commits) applyRevert(keys, c, commits);
  return keys;
}

export function load(snapshot: ProjectSnapshot): void {
  const reverted = revertedKeys(snapshot.commits);
  // Undo survives restarts: every edit still in effect, oldest first, from the saved history.
  const undoStack = snapshot.commits
    .filter((c) => (c.author === "user" || c.author === "agent") && !c.reverts && !reverted.has(c.id))
    .map((c) => c.id)
    .slice(-200);
  // Before the new doc renders: its footage loads from this project's own address.
  setMediaProject(snapshot.dir);
  set({
    ...initial,
    status: "ready",
    dir: snapshot.dir,
    doc: snapshot.doc,
    head: snapshot.head,
    commits: [...snapshot.commits],
    reverted,
    undoStack,
  });
}

function record(commit: Commit, opts: { undoable: boolean; keepRedo?: boolean }): void {
  set((s) => {
    const reverted = new Set(s.reverted);
    applyRevert(reverted, commit, s.commits);
    return {
      head: commit.id,
      commits: [...s.commits.slice(-499), commit],
      reverted,
      // The outline is "what just happened": it stays until your next edit, and never survives a reload.
      agentTouched:
        commit.author === "agent"
          ? touchedIds(commit, s.doc)
          : s.agentTouched.size
            ? new Set<string>()
            : s.agentTouched,
      undoStack: opts.undoable ? [...s.undoStack.slice(-199), commit.id] : s.undoStack,
      redoStack: opts.keepRedo ? s.redoStack : [],
    };
  });
}

interface EditOptions {
  message?: string;
  groups?: ChangeGroup[];
  reverts?: Commit["reverts"];
  /** Internal: undo/redo bookkeeping. */
  history?: "undo" | "redo";
}

/**
 * The one way the UI changes the project. Returns false (and toasts) if the ops don't apply, which
 * leaves the doc untouched.
 */
export function edit(ops: Op[], opts: EditOptions = {}): boolean {
  const { doc, head } = get();
  if (!doc || !ops.length) return false;
  let next: ProjectDoc;
  try {
    next = applyOps(doc, ops).doc;
  } catch (err) {
    if (err instanceof OpError) {
      toast(opts.reverts ? "Can't undo that: it was changed since." : err.message, "warn");
      return false;
    }
    throw err;
  }
  set({ doc: next });
  const req: CommitRequest = {
    ops,
    parent: head,
    ...(opts.message && { message: opts.message }),
    groups: opts.groups ?? summarize(ops),
    ...(opts.reverts && { reverts: opts.reverts }),
  };
  void host.project.commit(req).then((result) => {
    if (!result.ok) {
      toast(result.error, "warn");
      return;
    }
    const undoable = opts.history !== "undo";
    record(result.commit, { undoable, keepRedo: opts.history !== undefined });
    if (opts.history === "undo") set((s) => ({ redoStack: [...s.redoStack, result.commit.id] }));
  });
  return true;
}

/** A commit from the host. Replays it unless it is one of ours echoing back. */
export function receive(commit: Commit): void {
  const s = get();
  if (!s.doc || s.commits.some((c) => c.id === commit.id)) return;
  try {
    set({ doc: replay(s.doc, commit) });
  } catch {
    // Out of sync: ask the host for the truth.
    void host.project.restore().then(load);
    return;
  }
  record(commit, { undoable: commit.author === "user" || commit.author === "agent", keepRedo: false });
}

export function revert(commitId: string, group?: number): void {
  const commit = get().commits.find((c) => c.id === commitId);
  if (!commit) return;
  const label = group === undefined ? commit.message : commit.groups[group]?.label;
  edit(revertOps(commit, group), {
    message: `Undo: ${label}`,
    reverts: group === undefined ? { commit: commitId } : { commit: commitId, group },
  });
}

export function isReverted(commitId: string, group?: number): boolean {
  const { reverted } = get();
  return reverted.has(commitId) || (group !== undefined && reverted.has(`${commitId}:${group}`));
}

export function undo(): void {
  const { undoStack, commits } = get();
  const id = undoStack.at(-1);
  if (!id) return;
  set({ undoStack: undoStack.slice(0, -1) });
  const commit = commits.find((c) => c.id === id);
  if (commit)
    edit(revertOps(commit), { message: `Undo: ${commit.message}`, reverts: { commit: id }, history: "undo" });
}

export function redo(): void {
  const { redoStack, commits } = get();
  const id = redoStack.at(-1);
  if (!id) return;
  set({ redoStack: redoStack.slice(0, -1) });
  const commit = commits.find((c) => c.id === id);
  if (commit)
    edit(revertOps(commit), {
      message: commit.message.replace(/^Undo: /, ""),
      reverts: { commit: id },
      history: "redo",
    });
}

/** Wires host events into the store. Returns a disposer. */
export function connectHost(): () => void {
  const offs = [
    host.on("commit", ({ commit }) => receive(commit)),
    host.on("reload", (snapshot) => load(snapshot)),
    host.on("error", ({ message }) => toast(message, "warn")),
  ];
  host.project
    .restore()
    .then(load)
    .catch((err: Error) => set({ status: "error", error: err.message }));
  return () => {
    for (const off of offs) off();
  };
}
