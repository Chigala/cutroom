import { describe, expect, it } from "vitest";
import {
  applyOps,
  cutWordsOps,
  DUCK_RAMP,
  duckAt,
  emptyProject,
  type ProjectDoc,
  replaceTimelineOps,
  splitSceneOps,
  spokenWords,
  timelineOf,
  trimSceneOps,
  voicePlan,
} from "./index.ts";

const words = (texts: string[], from: number, step = 0.5) =>
  texts.map((text, i) => ({ text, start: from + i * step, end: from + i * step + 0.4 }));

/** A vlog shot (0-4s, the speaker saying four words) and a recording made after (four words). */
function vlog(voiceovers: ProjectDoc["voiceovers"] = []): ProjectDoc {
  const base = emptyProject("vo");
  return {
    ...base,
    sources: [
      { id: "cam", kind: "video", label: "cam", path: "/cam.mp4", duration: 10, hasAudio: true },
      { id: "vo", kind: "audio", label: "vo", path: "/vo.wav", duration: 10, hasAudio: true },
    ],
    transcripts: [
      { id: "cam", language: "en", words: words(["here", "we", "go", "now"], 0) },
      { id: "vo", language: "en", words: words(["so", "this", "is", "the", "spot"], 5) },
    ],
    scenes: [{ id: "s1", source: "cam", in: 0, out: 4, note: "", volume: 1 }],
    voiceovers,
  } as never;
}

const over = (o: Partial<ProjectDoc["voiceovers"][number]> = {}) => ({
  id: "v1",
  anchor: { scene: "s1", at: 1 },
  duration: 1.4,
  source: "vo",
  offset: 5.5,
  volume: 1,
  duck: 0.2,
  ...o,
});

describe("voiceovers", () => {
  it("are heard and captioned at their moment, the shot's own words stepping back under them", () => {
    const said = spokenWords(vlog([over()]));
    // "this is the" (5.5-6.9 in the recording) over 1-2.4s: the shot's "go" and "now" are under it.
    expect(said.map((w) => w.text)).toEqual(["here", "we", "this", "is", "the"]);
    const this_ = said.find((w) => w.text === "this")!;
    expect(this_).toMatchObject({ start: 1, voice: "v1", scene: "s1", ref: "vo:1" });
    expect(this_.end).toBeCloseTo(1.4);
  });

  it("leave the shot's words captioned when its sound stays up under them", () => {
    const said = spokenWords(vlog([over({ duck: 0.8 })]));
    expect(said.map((w) => w.text)).toEqual(["here", "we", "go", "this", "now", "is", "the"]);
  });

  it("take corrections like any words, and aren't cut out of the shots", () => {
    const doc = { ...vlog([over()]), wordEdits: [{ id: "vo:2", text: "IS", emphasis: true }] } as ProjectDoc;
    expect(spokenWords(doc).find((w) => w.ref === "vo:2")).toMatchObject({ text: "IS", emphasis: true });
    // Deleting a voiceover's word in the transcript doesn't touch the shot it plays over.
    expect(cutWordsOps(doc, new Set(["vo:1"]))).toEqual([]);
  });

  it("go when their shot does", () => {
    const doc = vlog([over({ anchor: { scene: "gone", at: 0 } })]);
    expect(voicePlan(doc, timelineOf(doc))).toEqual([]);
    expect(spokenWords(doc).map((w) => w.text)).toEqual(["here", "we", "go", "now"]);
  });

  it("lower the shots' sound smoothly around them", () => {
    const doc = vlog([over()]);
    const plan = voicePlan(doc, timelineOf(doc));
    expect(duckAt(plan, 0.5)).toBe(1);
    expect(duckAt(plan, 1 - DUCK_RAMP / 2)).toBeCloseTo(0.6);
    expect(duckAt(plan, 1.5)).toBeCloseTo(0.2);
    expect(duckAt(plan, 2.4 + DUCK_RAMP / 2)).toBeCloseTo(0.6);
    expect(duckAt(plan, 3)).toBe(1);
  });

  it("move with their shot when it's split or trimmed, and go with a rebuilt cut", () => {
    const doc = vlog([over({ anchor: { scene: "s1", at: 3 } })]);
    // Split at 2s: the voiceover (at 3s) moves to the second half, still at 3s in the video.
    const split = applyOps(doc, splitSceneOps(doc, "s1", 2)).doc;
    expect(split.voiceovers[0]!.anchor).toMatchObject({ at: 1 });
    expect(split.voiceovers[0]!.anchor.scene).not.toBe("s1");
    expect(voicePlan(split, timelineOf(split))[0]!.start).toBeCloseTo(3);
    // Trimmed a second off the front: it stays on the same moment of the footage.
    const trimmed = applyOps(doc, trimSceneOps(doc, "s1", 1, 4)).doc;
    expect(trimmed.voiceovers[0]!.anchor).toEqual({ scene: "s1", at: 2 });
    // A rebuilt cut clears what was pinned to the old shots, voiceovers too (nothing left dangling).
    const rebuilt = applyOps(doc, replaceTimelineOps(doc, [{ source: "cam", in: 0, out: 2, note: "" }])).doc;
    expect(rebuilt.voiceovers).toEqual([]);
  });
});
