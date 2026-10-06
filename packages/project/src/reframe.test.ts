import { describe, expect, it } from "vitest";
import { shotFocus } from "./reframe.ts";

describe("where a shot's frame centres", () => {
  it("is the person when there is one, else where the eye goes over the shot", () => {
    const salient = [
      { t: 1, x: 0.6, y: 0.4, w: 0.2, h: 0.2 },
      { t: 2, x: 0.62, y: 0.4, w: 0.2, h: 0.2 },
      { t: 9, x: 0, y: 0, w: 0.1, h: 0.1 },
    ];
    expect(shotFocus({ face: { x: 0.3, y: 0.3, size: 0.2 }, salient }, 0, 3)).toEqual({
      x: 0.3,
      y: 0.3,
      size: 0.2,
    });
    // Nobody in it: the middle of what draws attention during the shot (not the stretch after it).
    expect(shotFocus({ salient }, 0, 3)).toEqual({ x: 0.72, y: 0.5, size: 0.3 });
    expect(shotFocus({}, 0, 3)).toBeUndefined();
  });
});
