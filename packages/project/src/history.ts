/**
 * Commits are batches of ops with an author. The log is append-only: undo is a new commit that applies
 * an inverse, so every state the project has ever been in is reachable by replaying the log. That is the
 * basis for time travel, and for showing exactly what the agent changed.
 */
import { applyOps, type Op, OpError } from "./ops.ts";
import type { ProjectDoc } from "./schema.ts";
import { summarize } from "./summary.ts";

/** Who made a change. "index" is the indexer writing transcripts and analysis: not undoable. */
export type Author = "user" | "agent" | "file" | "index";

/** A labelled slice of a commit: one "+3 zooms · Undo" chip. */
export interface ChangeGroup {
  readonly label: string;
  /** Indices into the commit's ops. */
  readonly ops: readonly number[];
}

export interface Commit {
  readonly id: string;
  readonly parent: string | null;
  readonly author: Author;
  readonly message: string;
  readonly at: number;
  readonly ops: readonly Op[];
  /** `undo[i]` reverts `ops[i]`. */
  readonly undo: readonly (readonly Op[])[];
  readonly groups: readonly ChangeGroup[];
  /** Set when this commit undoes (part of) another one. */
  readonly reverts?: { readonly commit: string; readonly group?: number };
}

export interface CommitInput {
  readonly author: Author;
  readonly message?: string;
  readonly ops: readonly Op[];
  readonly groups?: readonly ChangeGroup[];
  readonly reverts?: Commit["reverts"];
}

let counter = 0;
/** Time-sortable and collision-safe within a process and across restarts. */
export function newId(prefix = ""): string {
  counter = (counter + 1) % 1296;
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${rand}`;
}

/** The next readable id with this prefix ("sc15", "clip_15"), skipping ones already taken. */
export function nextId(prefix: string, taken: Iterable<{ id: string }>, start = 1): string {
  const ids = new Set(Array.from(taken, (x) => x.id));
  let n = Math.max(start, ids.size + 1);
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Applies a commit input to a doc. Throws OpError if any op does not apply. */
export function makeCommit(
  doc: ProjectDoc,
  parent: string | null,
  input: CommitInput,
): { doc: ProjectDoc; commit: Commit } {
  const { doc: next, perOp } = applyOps(doc, input.ops);
  const groups = input.groups?.length ? input.groups : summarize(input.ops);
  const commit: Commit = {
    id: newId("c"),
    parent,
    author: input.author,
    message: input.message ?? (groups.map((g) => g.label).join(", ") || "No changes"),
    at: Date.now(),
    ops: input.ops,
    undo: perOp,
    groups,
    ...(input.reverts ? { reverts: input.reverts } : {}),
  };
  return { doc: next, commit };
}

/** Re-applies a commit made elsewhere (main process, another window) on top of a local doc. */
export function replay(doc: ProjectDoc, commit: Commit): ProjectDoc {
  return applyOps(doc, commit.ops).doc;
}

/**
 * Ops that undo one group of a commit, or the whole commit. Works on a doc that has moved on since,
 * because ops are id-addressed; applying them throws OpError when a later edit made the undo impossible.
 */
export function revertOps(commit: Commit, group?: number): Op[] {
  let indices: readonly number[];
  if (group === undefined) indices = commit.ops.map((_, i) => i);
  else {
    const g = commit.groups[group];
    if (!g) throw new OpError(`commit has no change group ${group}`, commit.ops[0]!);
    indices = g.ops;
  }
  return indices.toSorted((a, b) => b - a).flatMap((i) => commit.undo[i] ?? []);
}

/**
 * The doc as it was before `commits` happened, given the doc after them. Walks the log backwards
 * applying each commit's undo, newest first: the basis for "restore to this point".
 */
export function rewind(doc: ProjectDoc, commits: readonly Commit[]): ProjectDoc {
  let current = doc;
  for (const c of commits.toReversed()) current = applyOps(current, revertOps(c)).doc;
  return current;
}
