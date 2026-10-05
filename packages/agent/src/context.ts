import type { AgentContext } from "@vedit/bridge";
import {
  type Commit,
  DERIVED,
  formatTime,
  type Op,
  type ProjectDoc,
  type Source,
  spokenWords,
  timelineOf,
} from "@vedit/project";
import { projectView, shotsView, transcriptView } from "./view.ts";

/** One earlier exchange, so follow-ups like "shorter" or "undo the zooms" have something to refer to. */
export interface Turn {
  readonly user: string;
  readonly agent: string;
}

/** Transcripts this small go straight into the first message, saving the model a round trip. */
const INLINE_WORDS = 3000;
/** Shot logs this small go in too. */
const INLINE_SHOTS = 250;

function focusLines(ctx: AgentContext | undefined, doc: ProjectDoc): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (ctx.time !== undefined)
    lines.push(`The playhead is at ${formatTime(ctx.time, true)} (${ctx.time.toFixed(2)}s).`);
  if (ctx.point)
    lines.push(`They pointed at x=${ctx.point.x.toFixed(2)}, y=${ctx.point.y.toFixed(2)} on the frame.`);
  if (ctx.scenes?.length) lines.push(`Selected scenes: ${ctx.scenes.join(", ")}.`);
  if (ctx.comments?.length) {
    const comments = doc.comments.filter((c) => ctx.comments!.includes(c.id));
    lines.push(
      `Resolve these comments: ${JSON.stringify(comments.map((c) => ({ id: c.id, text: c.text, anchor: c.anchor, point: c.point })))}`,
    );
  }
  if (ctx.words?.length) lines.push(`Selected words: ${ctx.words.join(", ")}.`);
  if (ctx.range) {
    const { start, end } = ctx.range;
    const said = spokenWords(doc).filter((w) => w.end > start + 0.02 && w.start < end - 0.02);
    const tl = timelineOf(doc);
    const shots = tl.scenes
      .filter((p) => p.start < end && p.start + p.duration > start)
      .map((p) => p.scene.id);
    lines.push(
      `They selected ${formatTime(start, true)}-${formatTime(end, true)} (${start.toFixed(2)}-${end.toFixed(2)}s) on the timeline: the request is about that stretch, so change it and leave the rest alone unless asked. Shots in it: ${shots.join(", ") || "none"}.${said.length ? ` It says: "${said.map((w) => w.text).join(" ")}" (words ${said[0]!.ref} to ${said.at(-1)!.ref}).` : ""}`,
    );
  }
  return lines.length ? `\n\n<focus>\n${lines.join("\n")}\n</focus>` : "";
}

/** Hand edits listed with a request, newest kept: enough to respect them without drowning the request. */
const MAX_HAND_EDITS = 20;

/** What an edit touched, in the project's ids: "sc5: in, out; added v3". */
function touchedLine(ops: readonly Op[]): string {
  const parts = [
    ...new Set(
      ops.flatMap((o) => {
        if ("coll" in o) {
          if (o.coll === "sources" || DERIVED.includes(o.coll)) return [];
          if (o.op === "update") return [`${o.id}: ${Object.keys(o.patch).join(", ")}`];
          if (o.op === "insert") return [`added ${(o.item as { id: string }).id}`];
          return [`${o.op === "remove" ? "removed" : "moved"} ${o.id}`];
        }
        return [o.op === "merge" ? `${o.key}: ${Object.keys(o.patch).join(", ")}` : o.key];
      }),
    ),
  ];
  return parts.length > 3 ? `${parts.slice(0, 3).join("; ")} and ${parts.length - 3} more` : parts.join("; ");
}

/**
 * What the user changed by hand since the agent's last change, oldest first: their edits still in
 * effect (an edit they undid, and didn't redo, is left out) and the agent's changes they undid. The
 * project shows where things are; this says which of them were the user's deliberate choice.
 */
export function handEdits(log: readonly Commit[]): string[] {
  const since = log.slice(log.findLastIndex((c) => c.author === "agent") + 1);
  const recent = new Map(
    since.filter((c) => c.author === "user" || c.author === "file").map((c) => [c.id, c] as const),
  );
  const byId = new Map(log.map((c) => [c.id, c]));
  // Newest first: an undo cancels the edit it undid (and a redo cancels that undo, which brings the
  // edit back).
  const cancelled = new Set<string>();
  const kept: string[] = [];
  for (const c of [...recent.values()].reverse()) {
    if (cancelled.has(c.id)) continue;
    const target = c.reverts && byId.get(c.reverts.commit);
    if (c.reverts && target && recent.has(target.id) && c.reverts.group === undefined) {
      cancelled.add(target.id);
      continue;
    }
    if (c.reverts) {
      const labels =
        target && c.reverts.group !== undefined
          ? [target.groups[c.reverts.group]?.label]
          : (target ?? c).groups.map((g) => g.label);
      const what = labels.filter(Boolean).join("; ") || c.message.replace(/^Undo: /, "").slice(0, 120);
      kept.push(target?.author === "agent" ? `Undid your change: ${what}` : `Undid an earlier edit: ${what}`);
      continue;
    }
    const touched = touchedLine(c.ops);
    // Imports and indexing aren't editing decisions.
    if (!touched) continue;
    const line = `${c.message.split("\n")[0]!.slice(0, 120)} (${touched})${c.author === "file" ? ", in the project files" : ""}`;
    // A drag commits as it goes: one line for the same edit made again and again.
    if (kept.at(-1) !== line) kept.push(line);
  }
  const lines = kept.reverse();
  return lines.length > MAX_HAND_EDITS
    ? [`(${lines.length - MAX_HAND_EDITS} earlier ones not listed)`, ...lines.slice(-MAX_HAND_EDITS)]
    : lines;
}

/** The first user message: taste, the project, transcripts when small, history, then the request. */
export function buildPrompt(
  doc: ProjectDoc,
  prompt: string,
  ctx: AgentContext | undefined,
  history: readonly Turn[],
  attachments: readonly Source[] = [],
  hand: readonly string[] = [],
): string {
  const words = doc.transcripts.reduce((n, t) => n + t.words.length, 0);
  const parts = [
    `<style_md>\n${doc.style.trim() || "(empty)"}\n</style_md>`,
    `<project>\n${projectView(doc)}\n</project>`,
  ];
  if (words > 0 && words <= INLINE_WORDS)
    parts.push(
      `<transcripts>\n${doc.transcripts
        .filter((t) => t.words.length)
        .map((t) => transcriptView(doc, t.id))
        .join("\n\n")}\n</transcripts>`,
    );
  else if (words > INLINE_WORDS)
    parts.push(`(${words} transcribed words in total: read them with get_transcript.)`);
  // What was heard (laughter, applause, a gasp...), with times, when it's short: the edit can respect it
  // without a tool call (listen hears more).
  const heard = doc.analyses.flatMap((a) =>
    (a.sounds ?? [])
      .filter((s) => s.label !== "music" && s.label !== "silence")
      .map((s) => `${a.id} ${s.label} ${s.start.toFixed(1)}-${s.end.toFixed(1)}s`),
  );
  if (heard.length && heard.length <= 80) parts.push(`<sounds_heard>\n${heard.join("\n")}\n</sounds_heard>`);
  else if (heard.length)
    parts.push(`(${heard.length} sounds heard across the clips: listen or search_footage finds them.)`);
  // What the picture shows, inline when it's short; otherwise the agent reads it with get_shots.
  const shots = doc.shotLogs.reduce((n, l) => n + l.segments.length, 0);
  if (shots > 0 && shots <= INLINE_SHOTS)
    parts.push(`<shots>\n${doc.shotLogs.map((l) => shotsView(doc, l.id)).join("\n\n")}\n</shots>`);
  else if (shots > INLINE_SHOTS)
    parts.push(
      `(${shots} described shots in total: read a clip's with get_shots, or find shots with search_footage.)`,
    );
  const indexing = doc.sources.filter((s) => s.status === "pending" || s.status === "indexing");
  if (indexing.length)
    parts.push(
      `(Still indexing: ${indexing.map((s) => s.id).join(", ")}. Their transcripts are not ready yet.)`,
    );
  if (history.length)
    parts.push(
      `<earlier_requests>\n${history
        .slice(-6)
        .map((t) => `User: ${t.user}\nYou: ${t.agent || "(no reply)"}`)
        .join("\n\n")}\n</earlier_requests>`,
    );
  if (hand.length)
    parts.push(
      `<hand_edits>\nThe user changed these by hand since your last change, oldest first. They're deliberate: keep them unless this request asks you to change them, and don't put back what they undid.\n${hand.map((l) => `- ${l}`).join("\n")}\n</hand_edits>`,
    );
  if (attachments.length) parts.push(attachmentLines(doc, attachments));
  parts.push(`${prompt}${focusLines(ctx, doc)}`);
  return parts.join("\n\n");
}

/**
 * What the user attached to this request. They're in the library, not on the timeline: "this" in the
 * request means them, and placing them is the job.
 */
function attachmentLines(doc: ProjectDoc, attachments: readonly Source[]): string {
  const lines = attachments.map((s) => {
    const what =
      s.kind === "image"
        ? "a still image (its picture is attached above)"
        : s.kind === "video"
          ? `a ${s.duration.toFixed(1)}s clip (a frame from its middle is attached above; look at more with look and its id)`
          : `${s.duration.toFixed(1)}s of audio`;
    const words = doc.transcripts.find((t) => t.id === s.id)?.words.length ?? 0;
    const said = words
      ? `\n${transcriptView(doc, s.id)}`
      : s.status === "pending" || s.status === "indexing"
        ? " (still being transcribed)"
        : "";
    return `- ${s.id} "${s.label}": ${what}${said}`;
  });
  return `<attachments>\nThe user attached these to this request. They are in the library, not on the timeline yet.\n${lines.join("\n")}\n</attachments>`;
}
