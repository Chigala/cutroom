import { Analysis } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { type FrameSeen, summarize } from "./see.ts";

const frame = (t: number, texts: string[], extra: Partial<FrameSeen> = {}): FrameSeen => ({
  t,
  text: texts.map((s) => ({ s, box: [0.1, 0.8, 0.5, 0.05] as const })),
  salient: [[0.2, 0.2, 0.3, 0.4]],
  ...extra,
});

describe("what a clip's picture holds", () => {
  it("keeps each piece of text as one stretch while it's on screen, and where the eye goes", () => {
    const seen = summarize(
      [
        frame(0, ["SALE 50%"], { face: 0.6 }),
        frame(1, ["Sale 50%", "Open daily"]),
        // Missed for a frame (motion blur), then back: still the same stretch.
        frame(2, ["Open daily"]),
        frame(3, ["SALE 50%"]),
        frame(6, ["SALE 50%"], { look: 0.4 }),
      ],
      1,
    );
    expect(seen.text.map((r) => [r.text, r.start, r.end])).toEqual([
      ["SALE 50%", 0, 4],
      ["Open daily", 1, 3],
      ["SALE 50%", 6, 7],
    ]);
    expect(seen.salient[0]).toEqual({ t: 0, x: 0.2, y: 0.2, w: 0.3, h: 0.4 });
    expect(seen.quality[0]).toEqual({ t: 0, face: 0.6 });
    expect(seen.quality[4]).toEqual({ t: 6, look: 0.4 });
  });

  it("keeps boxes at the edge inside the frame, so the clip's analysis takes them", () => {
    const seen = summarize(
      [
        {
          t: 0,
          text: [{ s: "EDGE", box: [-0.02, 0.95, 0.3, 0.08] }],
          salient: [[0.8, -0.01, 0.25, 0.5]],
          face: 1.0001,
        },
      ],
      1,
    );
    expect(seen.text[0]).toMatchObject({ x: 0, y: 0.95, w: 0.28, h: 0.05 });
    expect(seen.salient[0]).toMatchObject({ x: 0.8, y: 0, w: 0.2, h: 0.49 });
    expect(Analysis.safeParse({ id: "c", ...seen }).success).toBe(true);
  });
});
