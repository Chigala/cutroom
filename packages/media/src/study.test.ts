import { describe, expect, it } from "vitest";
import { type CutFrames, effectsOf, jumpZoomsOf, shotMotion, transitionKind } from "./study.ts";

/** A camera path at 15 fps over `seconds`, from per-frame functions. */
const path = (seconds: number, s: (i: number) => number, x = (_: number) => 0, y = (_: number) => 0) => {
  const n = Math.round(seconds * 15);
  return {
    fps: 15,
    s: Array.from({ length: n }, (_, i) => s(i)),
    x: Array.from({ length: n }, (_, i) => x(i)),
    y: Array.from({ length: n }, (_, i) => y(i)),
  };
};

describe("the frame's movement in a shot", () => {
  it("finds a punch-in that holds, its size and when", () => {
    // Held, then 12% in at frame 20 (1.33 s), held again.
    const m = shotMotion(
      10,
      13,
      path(3, (i) => (i >= 20 ? Math.log(1.12) : 0)),
    );
    expect(m.punches).toEqual([{ at: 11.27, size: 0.12 }]);
    expect(m.drift).toBe(0);
  });

  it("calls a zoom that keeps going a push, not punches", () => {
    // 20% in, evenly over 3 s: quick per frame, but never holding.
    const m = shotMotion(
      0,
      3,
      path(3, (i) => (Math.log(1.2) * i) / 44),
    );
    expect(m.punches).toEqual([]);
    expect(m.drift).toBeCloseTo(0.2, 2);
  });

  it("measures a pan, and tells handheld from locked off", () => {
    const pan = shotMotion(
      0,
      2,
      path(
        2,
        () => 0,
        (i) => i * 0.004,
      ),
    );
    expect(pan.pan).toEqual({ x: 0.12, y: 0 });
    expect(pan.shake).toBeLessThan(0.0015);
    const shaky = shotMotion(
      0,
      2,
      path(
        2,
        () => 0,
        (i) => (i % 2 ? 0.004 : -0.004),
      ),
    );
    expect(shaky.shake).toBeGreaterThan(0.005);
  });
});

/** Frames around a cut at index 9 of 18: two shots, each its own brightness and sharpness. */
function cut(o: {
  bright?: (i: number) => number;
  sharp?: (i: number) => number;
  change?: (i: number) => number;
}): CutFrames {
  const n = 18;
  const at = 9;
  return {
    at,
    bright: Array.from({ length: n }, (_, i) => o.bright?.(i) ?? (i < at ? 0.4 : 0.5)),
    sharp: Array.from({ length: n }, (_, i) => o.sharp?.(i) ?? 0.08),
    change: Array.from({ length: n }, (_, i) => o.change?.(i) ?? (i === at ? 0.3 : 0.01)),
  };
}

describe("what a cut is", () => {
  it("tells a hard cut, a dissolve, a flash, a dip to black and a whip apart", () => {
    expect(transitionKind(cut({}))).toBe("cut");
    expect(transitionKind(cut({ change: (i) => (Math.abs(i - 9) <= 3 ? 0.08 : 0.005) }))).toBe("dissolve");
    expect(transitionKind(cut({ bright: (i) => (i === 9 ? 0.97 : 0.45) }))).toBe("flash");
    expect(transitionKind(cut({ bright: (i) => (Math.abs(i - 9) <= 1 ? 0.02 : 0.45) }))).toBe("dip");
    expect(transitionKind(cut({ sharp: (i) => (Math.abs(i - 9) <= 1 ? 0.02 : 0.08) }))).toBe("whip");
  });
});

describe("jump zooms", () => {
  it("are cuts that reframe the same person in the same place, not cuts to another shot", () => {
    const face = (x: number, size: number) => ({ x, y: 0.35, size });
    const jumps = jumpZoomsOf(
      [2, 4, 6, 8],
      [
        // 12% tighter on the same face: a jump zoom.
        face(0.5, 0.2),
        face(0.51, 0.224),
        // Framed the same: a plain jump cut.
        face(0.5, 0.2),
        face(0.5, 0.205),
        // 40% bigger: a closer shot of them, not a jump zoom.
        face(0.5, 0.2),
        face(0.5, 0.28),
        // Somewhere else in the frame: another shot.
        face(0.3, 0.2),
        face(0.7, 0.24),
      ],
    );
    expect(jumps).toEqual([{ at: 2, size: 0.12 }]);
    expect(jumpZoomsOf([2], [null, face(0.5, 0.2)])).toEqual([]);
  });
});

describe("effects heard", () => {
  it("keeps editing effects, pins each where it lands, and one for windows that overlap", () => {
    // Windows a second long every half second; a whoosh heard in two of them, loudest at 3.4 s.
    const windows = [
      {
        t: 2.5,
        d: 1,
        c: [
          ["music", 0.9],
          ["whoosh_swoosh_swish", 0.5],
        ] as [string, number][],
      },
      {
        t: 3,
        d: 1,
        c: [
          ["music", 0.9],
          ["Whoosh, swoosh, swish", 0.6],
        ] as [string, number][],
      },
      // A pop, its attack the strongest onset in the window; and things that aren't effects.
      {
        t: 6,
        d: 1,
        c: [
          ["pop", 0.4],
          ["guitar", 0.8],
          ["door", 0.5],
        ] as [string, number][],
      },
      // Too unsure to count.
      { t: 9, d: 1, c: [["bicycle_bell", 0.1]] as [string, number][] },
    ];
    const hits = [
      { at: 6.2, strength: 3 },
      { at: 6.42, strength: 7 },
    ];
    const loudness = (t: number) => (Math.abs(t - 3.4) < 0.011 ? 1 : 0.1);
    expect(effectsOf(windows, hits, loudness)).toEqual([
      { at: 3.4, kind: "whoosh", confidence: 0.6 },
      { at: 6.42, kind: "pop", confidence: 0.4 },
    ]);
  });
});
