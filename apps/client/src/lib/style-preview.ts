/**
 * Previews for effects, transitions and grades: a few seconds of your own footage with only that file
 * at work, and the moments worth looking at for the frame strip.
 *
 *   effect      one shot, the effect a beat in
 *   transition  two shots, the transition on the cut between them
 *   grade       your cut, graded, from the start
 */
import type { ProjectDoc, StyleFile, StyleKind } from "@vedit/project";
import { styleMeta, timelineOf } from "@vedit/project";

export const STYLE_COLL = {
  effect: "effectKinds",
  transition: "transitionKinds",
  grade: "grades",
} as const satisfies Record<StyleKind, keyof ProjectDoc>;

export const STYLE_FOLDER: Record<StyleKind, string> = {
  effect: "effects",
  transition: "transitions",
  grade: "grades",
};

export const styleName = (f: StyleFile) => styleMeta(f.css)?.name ?? f.id;

export interface StylePreview {
  readonly doc: ProjectDoc;
  /** The stretch the player loops, seconds. */
  readonly start: number;
  readonly end: number;
  /** Strip frames, seconds. */
  readonly strip: readonly number[];
}

const spread = (from: number, to: number, n = 6) =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

/** Everything that isn't the file under test, taken away. */
const quiet = (doc: ProjectDoc): ProjectDoc => ({
  ...doc,
  titles: [],
  visuals: [],
  effects: [],
  sfx: [],
  comments: [],
  music: { ...doc.music, source: null },
});

/** The shots to preview on: video first, and ones with a face (the usual subject) before others. */
function shots(doc: ProjectDoc) {
  const faces = new Set(doc.analyses.filter((a) => a.face).map((a) => a.id));
  const kind = (id: string) => doc.sources.find((s) => s.id === id)?.kind;
  const rank = (s: ProjectDoc["scenes"][number]) =>
    (kind(s.source) === "video" ? 0 : 2) + (faces.has(s.source) ? 0 : 1);
  return [...doc.scenes].sort((a, b) => rank(a) - rank(b));
}

export function stylePreview(doc: ProjectDoc, kind: StyleKind, file: StyleFile): StylePreview {
  const coll = STYLE_COLL[kind];
  const withFile = {
    ...doc,
    [coll]: [...(doc[coll] as readonly StyleFile[]).filter((f) => f.id !== file.id), file],
  } as ProjectDoc;
  const suggested = styleMeta(file.css)?.duration;

  if (kind === "grade") {
    const graded = { ...withFile, look: { ...withFile.look, grade: file.id } };
    const end = Math.min(timelineOf(graded).duration, 6);
    return {
      doc: { ...graded, music: { ...graded.music, source: null } },
      start: 0,
      end,
      strip: spread(0.2, end - 0.2),
    };
  }

  const [a, b] = shots(doc);
  if (!a) return { doc: quiet(withFile), start: 0, end: 1, strip: spread(0, 1) };

  if (kind === "effect") {
    const duration = Math.min(4, Math.max(0.2, suggested ?? 0.5));
    const at = 0.4;
    const length = Math.max(a.out - a.in, 0);
    const scene = { ...a, out: a.in + Math.min(length, at + duration + 0.8) };
    return {
      doc: {
        ...quiet(withFile),
        scenes: [scene],
        effects: [{ id: "preview", anchor: { scene: a.id, at }, kind: file.id, duration }],
      },
      start: 0,
      end: scene.out - scene.in,
      strip: spread(at + 0.02, at + duration - 0.02),
    };
  }

  // A transition needs a cut: the two best shots, or the same one twice when there's only one.
  const duration = Math.min(2, Math.max(0.1, suggested ?? 0.4));
  const { transition: _, ...plain } = a;
  const first = { ...plain, id: "preview-a", out: Math.min(a.out, a.in + 1.6) };
  const second = { ...(b ?? a), id: "preview-b", transition: { kind: file.id, duration } };
  second.out = Math.min(second.out, second.in + 1.6);
  const cut = first.out - first.in;
  return {
    doc: { ...quiet(withFile), scenes: [first, second], captions: [], zooms: [] },
    start: 0,
    end: cut + (second.out - second.in),
    strip: spread(cut - duration / 2, cut + duration / 2),
  };
}
