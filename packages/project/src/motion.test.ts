import { describe, expect, it } from "vitest";
import {
  blurPlateKey,
  cutoutCovering,
  cutoutKey,
  cutoutRange,
  emptyProject,
  keepTag,
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

  it("cuts the person out of a photo shot too", () => {
    const base = emptyProject("t");
    const doc = {
      ...base,
      sources: [
        { id: "c", kind: "video", label: "c", path: "/c.mp4", duration: 20 },
        { id: "p", kind: "image", label: "p", path: "/p.webp", duration: 0 },
        { id: "s", kind: "solid", label: "s", color: "#000", duration: 0 },
      ],
      scenes: [
        { id: "a", source: "c", in: 0, out: 2, note: "", volume: 1 },
        { id: "b", source: "p", in: 0, out: 2.4, note: "", volume: 1, subject: { shadow: 0.5 } },
        { id: "d", source: "s", in: 0, out: 2, note: "", volume: 1, background: { kind: "blur" } },
      ],
    };
    const tl = timelineOf(doc as never);
    const starts = new Map(tl.scenes.map((p) => [p.scene.id, { start: p.start, end: p.start + p.duration }]));
    expect(scenesNeedingCutout(doc as never, starts).map((s) => s.id)).toEqual(["b"]);
  });

  it("covers what shows of a shot into the transitions either side", () => {
    const scenes = [
      { id: "a", source: "c", in: 0, out: 2, note: "", volume: 1 },
      {
        id: "b",
        source: "c",
        in: 5,
        out: 7,
        note: "",
        volume: 1,
        transition: { kind: "glitch", duration: 0.4 },
      },
      { id: "d", source: "c", in: 9, out: 11, note: "", volume: 1, speed: 2 },
    ];
    const tl = timelineOf({ scenes } as never);
    // Without a timeline (or a transition), just its own footage.
    expect(cutoutRange(scenes[0]!)).toEqual({ from: 0, to: 2 });
    // Into the glitch: "b" starts early, "a" ends late; neither past the clip.
    expect(cutoutRange(scenes[1]! as never, tl)).toEqual({ from: 4.7, to: 7 });
    expect(cutoutRange(scenes[0]! as never, tl, 2.1)).toEqual({ from: 0, to: 2.1 });
    expect(cutoutRange(scenes[0]! as never, tl)).toEqual({ from: 0, to: 2.3 });
    // A shot at double speed shows twice the footage in the same time.
    const fast = timelineOf({
      scenes: [scenes[0], { ...scenes[2], transition: { kind: "x", duration: 0.4 } }],
    } as never);
    expect(cutoutRange({ ...scenes[2]!, transition: { kind: "x", duration: 0.4 } } as never, fast).from).toBe(
      8.5,
    );
  });

  it("names derived footage in keys that parse back", () => {
    expect(parseDerivedKey(cutoutKey("clip_1", 4.1, 7))).toEqual({
      kind: "cutout",
      source: "clip_1",
      from: 4.1,
      to: 7,
      keep: "",
    });
    expect(parseDerivedKey(rampKey("clip_1", "abc123"))).toEqual({
      kind: "ramp",
      source: "clip_1",
      hash: "abc123",
    });
    expect(parseDerivedKey("clip_1")).toBeNull();
  });
});

describe("what a cutout keeps with the person", () => {
  it("is part of its key and file, and a cutout keeping something else never stands in for it", () => {
    expect(keepTag({})).toBe("");
    expect(keepTag({ keep: "subject" })).toBe("subject");
    const mic = [{ x: 0.12, y: 0.6, at: 3 }];
    expect(keepTag({ keep: mic })).toMatch(/^p[0-9a-z]+$/);
    expect(keepTag({ keep: mic })).toBe(keepTag({ keep: [{ x: 0.12, y: 0.6, at: 3 }] }));
    expect(keepTag({ keep: mic })).not.toBe(keepTag({ keep: [{ x: 0.5, y: 0.6, at: 3 }] }));
    // Who the cutout is goes in the tag too: the speaker alone, and the speaker with the mic, differ.
    const host = [{ x: 0.7, y: 0.3, at: 3 }];
    expect(keepTag({ person: host })).toMatch(/^q[0-9a-z]+$/);
    expect(keepTag({ person: host, keep: "subject" })).toMatch(/^q[0-9a-z]+subject$/);
    expect(keepTag({ person: host })).not.toBe(keepTag({ person: host, keep: mic }));

    // The person-only key is as it always was, so cutouts already made stay valid.
    expect(cutoutKey("clip_1", 1, 4)).toBe("clip_1~cutout~1.00~4.00");
    expect(parseDerivedKey(cutoutKey("clip_1", 1, 4))).toMatchObject({ kind: "cutout", keep: "" });
    expect(parseDerivedKey(cutoutKey("clip_1", 1, 4, "subject"))).toMatchObject({
      kind: "cutout",
      source: "clip_1",
      from: 1,
      to: 4,
      keep: "subject",
    });
    expect(parseDerivedKey(blurPlateKey("clip_1", 1, 4, 18, keepTag({ keep: mic })))).toMatchObject({
      kind: "bgblur",
      amount: 18,
      keep: keepTag({ keep: mic }),
    });

    const analysis = {
      cutouts: [
        { from: 0, to: 10 },
        { from: 0, to: 10, keep: "subject" },
      ],
    };
    expect(cutoutCovering(analysis, 2, 5)).toEqual({ from: 0, to: 10 });
    expect(cutoutCovering(analysis, 2, 5, "subject")).toMatchObject({ keep: "subject" });
    expect(cutoutCovering(analysis, 2, 5, keepTag({ keep: mic }))).toBeNull();
  });
});
