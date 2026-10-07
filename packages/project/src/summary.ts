/** Turns raw ops into the human change summary: "+3 zooms", "2 shots cut", "Music changed". */
import type { ChangeGroup } from "./history.ts";
import type { Op } from "./ops.ts";
import type { Collection, Singleton } from "./schema.ts";

const NOUN: Record<Collection, [one: string, many: string]> = {
  sources: ["clip", "clips"],
  transcripts: ["transcript", "transcripts"],
  analyses: ["analysis", "analyses"],
  wordEdits: ["word", "words"],
  scenes: ["shot", "shots"],
  zooms: ["zoom", "zooms"],
  captions: ["caption", "captions"],
  titles: ["title", "titles"],
  graphics: ["graphic", "graphics"],
  captionLooks: ["caption look", "caption looks"],
  inspirations: ["inspiration", "inspirations"],
  fonts: ["font", "fonts"],
  luts: ["LUT", "LUTs"],
  shotLogs: ["shot log", "shot logs"],
  musicCues: ["music cue", "music cues"],
  musicClips: ["music clip", "music clips"],
  effectKinds: ["effect style", "effect styles"],
  transitionKinds: ["transition", "transitions"],
  grades: ["grade", "grades"],
  visuals: ["visual", "visuals"],
  effects: ["effect", "effects"],
  sfx: ["SFX", "SFX"],
  comments: ["comment", "comments"],
};

const SINGLETON_LABEL: Record<Singleton, string> = {
  meta: "Project settings",
  captionStyle: "Caption style",
  music: "Music",
  mix: "Sound mix",
  exportSettings: "Export settings",
  checkRules: "Check rules",
  look: "Color grade changed",
  cover: "Cover",
  style: "STYLE.md updated",
};

const noun = (coll: Collection, n: number) => NOUN[coll][n === 1 ? 0 : 1];

function label(kind: string, coll: Collection | Singleton, ops: Op[]): string {
  const n = ops.length;
  if (kind === "set" || kind === "merge") {
    if (coll === "music") {
      const op = ops.at(-1)!;
      const value =
        op.op === "set" ? (op.value as { source?: unknown }) : (op.op === "merge" && op.patch) || {};
      return "source" in value ? (value.source ? "Music added" : "Music removed") : "Music adjusted";
    }
    return SINGLETON_LABEL[coll as Singleton];
  }
  const c = coll as Collection;
  if (c === "wordEdits" && kind !== "remove") return `${n} caption ${n === 1 ? "word" : "words"} edited`;
  if (c === "transcripts" || c === "analyses") return n === 1 ? "Indexed a clip" : `Indexed ${n} clips`;
  switch (kind) {
    case "insert": {
      if (
        c === "titles" &&
        ops.every((o) => o.op === "insert" && (o.item as { role?: string }).role === "hook")
      )
        return n === 1 ? "Hook title" : `${n} hook titles`;
      if (c === "sources") return `+${n} ${noun(c, n)} imported`;
      return `+${n} ${noun(c, n)}`;
    }
    case "remove":
      return c === "scenes" ? `${n} ${noun(c, n)} cut` : `${n} ${noun(c, n)} removed`;
    case "move":
      return c === "scenes" ? `Reordered ${n} ${noun(c, n)}` : `Moved ${n} ${noun(c, n)}`;
    default: {
      const patches = ops.map((o) => (o.op === "update" ? o.patch : {}));
      if (c === "comments" && patches.every((p) => p.status === "resolved"))
        return `Resolved ${n} ${noun(c, n)}`;
      if (c === "scenes" && patches.every((p) => "in" in p || "out" in p))
        return n <= 2
          ? `Retimed ${ops.map((o) => (o.op === "update" ? o.id : "")).join(", ")}`
          : `Retimed ${n} shots`;
      return `Edited ${n} ${noun(c, n)}`;
    }
  }
}

/**
 * Groups ops by what they did to which collection, in first-seen order. Used whenever a commit arrives
 * without hand-written groups (user edits, file edits). The agent labels its own groups.
 */
export function summarize(ops: readonly Op[]): ChangeGroup[] {
  const buckets = new Map<string, { kind: string; coll: Collection | Singleton; idx: number[] }>();
  ops.forEach((op, i) => {
    const coll = "coll" in op ? op.coll : op.key;
    const kind = op.op === "merge" ? "set" : op.op;
    const key = `${kind}:${coll}`;
    const b = buckets.get(key) ?? { kind, coll, idx: [] };
    b.idx.push(i);
    buckets.set(key, b);
  });
  return [...buckets.values()].map((b) => ({
    label: label(
      b.kind,
      b.coll,
      b.idx.map((i) => ops[i]!),
    ),
    ops: b.idx,
  }));
}
