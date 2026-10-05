import { describe, expect, it } from "vitest";
import { STYLE_PRESETS } from "./style-presets.ts";
import { DEFAULT_STYLE, emptyProject } from "./templates.ts";

describe("the style new projects start with", () => {
  it("is the user's own when they chose one, and the default otherwise", () => {
    const podcast = STYLE_PRESETS.find((p) => p.id === "podcast")!.text;
    expect(emptyProject("a", podcast).style).toBe(podcast);
    expect(emptyProject("b", "").style).toBe(DEFAULT_STYLE);
    expect(emptyProject("c").style).toBe(DEFAULT_STYLE);
  });

  it("offers each kind of video once, every one a STYLE.md with rules in it", () => {
    expect(new Set(STYLE_PRESETS.map((p) => p.id)).size).toBe(STYLE_PRESETS.length);
    for (const p of STYLE_PRESETS) {
      expect(p.text.startsWith("# Style")).toBe(true);
      expect(p.text.split("\n").filter((l) => l.startsWith("- ")).length).toBeGreaterThanOrEqual(4);
    }
  });
});
