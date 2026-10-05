import { describe, expect, it } from "vitest";
import { wordsFromDtw } from "./whisper.ts";

const tok = (text: string, cs: number, from = 0) => ({ text, t_dtw: cs, offsets: { from, to: from } });

describe("word timings from whisper's alignment", () => {
  it("ends each word where its last spoken token is aligned, not on the drifting offsets", () => {
    const words = wordsFromDtw([
      {
        tokens: [
          tok("[_BEG_]", 0),
          tok(" building", 820),
          tok(" an", 840),
          tok(" AI", 868),
          tok(" agency", 914),
          tok(".", 930),
          tok(" And", 938),
          tok(" selling", 1000),
          tok("$", 1010),
          tok("10", 1030),
        ],
      },
    ])!;
    expect(words.map((w) => w.text)).toEqual(["building", "an", "AI", "agency.", "And", "selling", "$10"]);
    const agency = words[3]!;
    expect(agency.end).toBeCloseTo(9.14, 2);
    // "And" starts after the full stop's place (the pause), not on top of "agency".
    expect(words[4]!.start).toBeGreaterThanOrEqual(9.3);
  });

  it("gives no words when whisper didn't align", () => {
    expect(wordsFromDtw([{ tokens: [tok(" hi", -1)] }])).toBeNull();
  });
});
