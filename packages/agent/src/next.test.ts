import { describe, expect, it } from "vitest";
import { splitNext } from "./agent.ts";

describe("the suggested next request", () => {
  it("comes off the end of the reply", () => {
    expect(
      splitNext(
        "Tightened the middle and evened two cuts.\n\nNext: Tighten the pause after the price reveal",
      ),
    ).toEqual({
      summary: "Tightened the middle and evened two cuts.",
      next: "Tighten the pause after the price reveal",
    });
    expect(splitNext('Done.\n**Next:** "Add a punch-in on the $5,000 line"').next).toBe(
      "Add a punch-in on the $5,000 line",
    );
  });
  it("leaves a reply without one, or with Next: mid-text, alone", () => {
    expect(splitNext("Cut the retakes.")).toEqual({ summary: "Cut the retakes." });
    const mid = "Next: I evened the cuts.\nThen I checked them.";
    expect(splitNext(mid)).toEqual({ summary: mid });
  });
});
