import { cutoutCovering, cutoutRange } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { padded } from "./cutouts.ts";

describe("a new cutout", () => {
  it("still covers its shot after the shot is trimmed a little, so it isn't made again", () => {
    // The agent cut out 5.5-6.9, then moved the shot's out to 7.12 (the clip-87b3e case).
    const made = padded(cutoutRange({ id: "sc3", in: 5.5, out: 6.9 }), 20);
    const trimmed = cutoutRange({ id: "sc3", in: 5.5, out: 7.12 });
    expect(cutoutCovering({ cutouts: [made] }, trimmed.from, trimmed.to)).not.toBeNull();
  });

  it("stays inside the clip", () => {
    expect(padded({ from: 0.2, to: 9.8 }, 10)).toEqual({ from: 0, to: 10 });
  });
});
