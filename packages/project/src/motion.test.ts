import { describe, expect, it } from "vitest";
import {
  cutoutKey,
  emptyProject,
  parseDerivedKey,
  poseAt,
  rampKey,
  rampMap,
  STARTER_EFFECTS,
  sceneLength,
  scenesNeedingCutout,
  sourceOffset,
  timelineOf,
} from "./index.ts";

describe("speed ramps", () => {
  const shot = {
    in: 10,
    out: 13,
    ramp: [
      { at: 0, speed: 1 },
      { at: 1, speed: 0.5 },
      { at: 3, speed: 0.5 },
    ],
  };

  it("lasts as long as its footage takes through the speeds", () => {
    // 1s easing 1 -> 0.5 (about 1.4s), then 2s at 0.5 (4s).
    expect(sceneLength(shot)).toBeGreaterThan(5.2);
    expect(sceneLength(shot)).toBeLessThan(5.6);
  });

  it("maps output time to footage and back", () => {
    const m = rampMap(shot);
    for (const t of [0, 0.5, 2, 4, m.length]) expect(m.outputAt(m.sourceAt(t))).toBeCloseTo(t, 2);
    expect(sourceOffset(shot, m.length)).toBeCloseTo(3, 2);
  });

  it("puts ramped shots on the timeline at their ramped length", () => {
    const doc = {
      ...emptyProject("t"),
      scenes: [{ id: "a", source: "c", in: 10, out: 13, note: "", volume: 1, ramp: shot.ramp }],
    };
    expect(timelineOf(doc as never).duration).toBeCloseTo(sceneLength(shot), 5);
  });
});

describe("keyframes", () => {
  it("eases each property between the keyframes that set it, and holds otherwise", () => {
    const keys = [
      { at: 0, scale: 1, x: 0 },
      { at: 1, scale: 2, ease: "linear" as const },
      { at: 2, x: 0.5, ease: "linear" as const },
    ];
    expect(poseAt(keys, 0.5).scale).toBeCloseTo(1.5);
    expect(poseAt(keys, 1.5).scale).toBe(2);
    expect(poseAt(keys, 1.5).x).toBeCloseTo(0.375);
    expect(poseAt(keys, -1).scale).toBe(1);
    expect(poseAt(undefined, 3)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 });
  });
});

describe("cutouts", () => {
  it("needs one for a background change or something behind the subject over the shot", () => {
    const base = emptyProject("t");
    const doc = {
      ...base,
      sources: [{ id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 20 }],
      scenes: [
        { id: "a", source: "c", in: 0, out: 2, note: "", volume: 1 },
        { id: "b", source: "c", in: 5, out: 7, note: "", volume: 1, background: { kind: "blur" } },
        { id: "d", source: "c", in: 9, out: 11, note: "", volume: 1 },
      ],
      titles: [
        {
          id: "t1",
          role: "title",
          anchor: { scene: "d", at: 0.5 },
          duration: 1,
          text: "Hi",
          behindSubject: true,
        },
      ],
    };
    const tl = timelineOf(doc as never);
    const starts = new Map(tl.scenes.map((p) => [p.scene.id, { start: p.start, end: p.start + p.duration }]));
    expect(scenesNeedingCutout(doc as never, starts).map((s) => s.id)).toEqual(["b", "d"]);
  });

  it("needs one for a styled subject, and under an effect that styles the person apart", () => {
    const base = emptyProject("t");
    const doc = {
      ...base,
      sources: [{ id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 20 }],
      scenes: [
        { id: "a", source: "c", in: 0, out: 2, note: "", volume: 1, subject: { shadow: 0.5 } },
        { id: "b", source: "c", in: 5, out: 7, note: "", volume: 1 },
        { id: "d", source: "c", in: 9, out: 11, note: "", volume: 1 },
      ],
      // One that styles the person apart (color-pop), and a plain one that styles the whole frame.
      effects: [
        { id: "e1", anchor: { scene: "b", at: 0.2 }, kind: "color-pop", duration: 1 },
        { id: "e2", anchor: { scene: "d", at: 0.2 }, kind: "shake", duration: 0.5 },
      ],
      effectKinds: STARTER_EFFECTS,
    };
    const tl = timelineOf(doc as never);
    const starts = new Map(tl.scenes.map((p) => [p.scene.id, { start: p.start, end: p.start + p.duration }]));
    expect(scenesNeedingCutout(doc as never, starts).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("names derived footage in keys that parse back", () => {
    expect(parseDerivedKey(cutoutKey("clip_1", 4.1, 7))).toEqual({
      kind: "cutout",
      source: "clip_1",
      from: 4.1,
      to: 7,
    });
    expect(parseDerivedKey(rampKey("clip_1", "abc123"))).toEqual({
      kind: "ramp",
      source: "clip_1",
      hash: "abc123",
    });
    expect(parseDerivedKey("clip_1")).toBeNull();
  });
});
