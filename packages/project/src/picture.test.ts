import { describe, expect, it } from "vitest";
import { castCorrected, castCorrection } from "./picture.ts";

describe("colour casts", () => {
  it("corrects in proportion to the cast, up to a limit, and leaves neutral footage alone", () => {
    expect(castCorrection(2)).toBe(0);
    expect(castCorrection(14)).toBe(-0.4);
    expect(castCorrection(23.1)).toBe(-0.6);
    expect(castCorrection(-14)).toBe(0.4);
  });

  it("counts a shot as corrected near the correction, the right way", () => {
    expect(castCorrected(23.1, -0.6)).toBe(true);
    expect(castCorrected(23.1, -0.45)).toBe(true);
    expect(castCorrected(23.1, -0.3)).toBe(false);
    expect(castCorrected(23.1, 0.6)).toBe(false);
    expect(castCorrected(3, undefined)).toBe(true);
  });
});
