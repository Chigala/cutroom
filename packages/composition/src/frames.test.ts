import { describe, expect, it } from "vitest";
import { lockToBeats } from "./frames.ts";

describe("beat lock", () => {
  const item = (from: number, durationInFrames: number) => ({ from, durationInFrames, item: {} });
  const beats = [0, 15, 30, 45, 60];

  it("snaps starts and ends within the tolerance onto the beat", () => {
    expect(lockToBeats([item(13, 18)], beats, 3)).toEqual([{ from: 15, durationInFrames: 15, item: {} }]);
  });

  it("leaves what's further away where it was put", () => {
    expect(lockToBeats([item(22, 3)], beats, 3)).toEqual([item(22, 3)]);
  });

  it("does nothing without beats", () => {
    expect(lockToBeats([item(13, 18)], [], 3)).toEqual([item(13, 18)]);
  });
});

describe("trims", () => {
  it("never start a clip or song before its first frame, and always end after the start", async () => {
    const { trimFrom, trimTo } = await import("./frames.ts");
    // A J-cut's sound leading in a tenth of a second before the clip starts: -3 frames, played from 0.
    expect(trimFrom(-0.1, 30)).toBe(0);
    expect(trimFrom(2, 30)).toBe(60);
    expect(trimFrom(Number.NaN, 30)).toBe(0);
    expect(trimTo(4, 30, 2)).toBe(120);
    // An end at or before the start (a zero-length stretch) still leaves one frame.
    expect(trimTo(1, 30, 2)).toBe(61);
    expect(trimTo(-1, 30, -2)).toBe(1);
  });
});
