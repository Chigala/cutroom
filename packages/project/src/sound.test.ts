import { describe, expect, it } from "vitest";
import { bestStretch, describeSound, soundShape } from "./sound.ts";

/** Peaks at 50 a second from [seconds, peak] stretches. */
const peaks = (...parts: [number, number][]) =>
  Uint8Array.from(parts.flatMap(([s, p]) => Array.from({ length: Math.round(s * 50) }, () => p)));

describe("soundShape", () => {
  it("finds a quiet intro, the build, and the hit where it slams in", () => {
    const shape = soundShape(peaks([4, 20], [3, 90], [1, 30], [5, 250]));
    expect(shape.sections[0]?.kind).toBe("quiet");
    expect(shape.hit).toBeCloseTo(8, 0);
    expect(shape.start).not.toBeNull();
  });

  it("finds no hit in a track that's loud throughout", () => {
    const shape = soundShape(peaks([10, 240]));
    expect(shape.hit).toBeNull();
    expect(shape.start).toBe(0);
    expect(shape.sections).toEqual([{ start: 0, end: 10, kind: "full" }]);
  });

  it("ignores rises inside a quiet intro", () => {
    const shape = soundShape(peaks([2, 5], [2, 25], [6, 240]));
    expect(shape.hit).toBeCloseTo(4, 0);
  });

  it("reads as bars and sections", () => {
    const text = describeSound(soundShape(peaks([2, 20], [2, 250])));
    expect(text).toMatch(/█/);
    expect(text).toMatch(/Hit .*: 2\.00s/);
  });
});

describe("bestStretch", () => {
  const bars = (n: number, every = 2) => Array.from({ length: n }, (_, i) => i * every);

  it("takes a stretch as long as the video that avoids a flat part", () => {
    // Loud 0-20s, a flat 20-30s, loud 30-80s; a 30s video fits in 30-80.
    const s = bestStretch(peaks([20, 240], [10, 15], [50, 240]), 30, { downbeats: bars(40) });
    expect(s?.loop).toBe(false);
    expect(s!.start).toBeGreaterThanOrEqual(30);
    expect(s!.end - s!.start).toBeCloseTo(30, 1);
  });

  it("loops the strong part of a track shorter than the video, leaving out a dropout at the end", () => {
    const s = bestStretch(peaks([10, 240], [1, 5]), 35, { downbeats: bars(6) });
    expect(s?.loop).toBe(true);
    expect(s!.end).toBeLessThanOrEqual(10);
    expect(s!.floor).toBeGreaterThan(-6);
  });

  it("can be told to loop even when the track is long enough", () => {
    const s = bestStretch(peaks([60, 240]), 30, { downbeats: bars(30), mode: "loop" });
    expect(s?.loop).toBe(true);
  });
});
