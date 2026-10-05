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
