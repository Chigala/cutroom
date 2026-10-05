import { describe, expect, it } from "vitest";
import {
  applyOps,
  emptyProject,
  kitFromDoc,
  kitOps,
  LEARNED_HEADING,
  mergeStyle,
  rememberIn,
} from "./index.ts";

describe("brand kits", () => {
  it("carries a project's taste into another and links it", () => {
    const a = emptyProject("A");
    const styled = {
      ...a,
      look: { ...a.look, grade: "film", accent: "#FF3D7F" },
      captionStyle: { ...a.captionStyle, size: 52, uppercase: true },
      graphics: [...a.graphics, { id: "brand-badge", html: "<div>badge</div>" }],
      cover: { ...a.cover, text: "Only for A", size: 240 },
      style: "Short hooks.",
    };
    const kit = kitFromDoc(styled, "mine", "Mine");
    const b = { ...emptyProject("B"), style: "Talks fast." };
    const { doc } = applyOps(b, kitOps(b, kit));
    expect(doc.look.grade).toBe("film");
    expect(doc.captionStyle.size).toBe(52);
    expect(doc.graphics.some((g) => g.id === "brand-badge")).toBe(true);
    // The cover's style comes, not its words.
    expect(doc.cover.size).toBe(240);
    expect(doc.cover.text).toBe("");
    expect(doc.style).toContain("Talks fast.");
    expect(doc.style).toContain("Short hooks.");
    expect(doc.meta.kit).toBe("mine");
  });

  it("merges STYLE.md without repeating lines", () => {
    expect(mergeStyle("- a\n- b\n", "- b\n- c")).toBe("- a\n- b\n\n- c\n");
    expect(mergeStyle("", "- c")).toBe("- c");
    expect(mergeStyle("- a", "- a")).toBe("- a");
  });

  it("remembers preferences once, under their heading", () => {
    const once = rememberIn("# Style\nWarm.", "Never use whooshes");
    expect(once).toBe(`# Style\nWarm.\n\n${LEARNED_HEADING}\n- Never use whooshes\n`);
    const twice = rememberIn(once, "Captions low");
    expect(twice).toBe(`# Style\nWarm.\n\n${LEARNED_HEADING}\n- Never use whooshes\n- Captions low\n`);
    expect(rememberIn(twice, "- Captions low")).toBe(twice);
    // Lands in its section even when another follows.
    const mid = rememberIn(`${LEARNED_HEADING}\n- x\n\n## Notes\nhi`, "y");
    expect(mid).toBe(`${LEARNED_HEADING}\n- x\n- y\n\n## Notes\nhi`);
  });
});
