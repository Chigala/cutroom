import { emptyProject, type ProjectDoc } from "@vedit/project";
import { describe, expect, it } from "vitest";
import { type AgentHost, runTool, type Scratch, type ToolContext } from "./tools.ts";

/** A host whose Google Fonts has Oswald (200-700) and Barlow Condensed, and fetches what it's asked for. */
function ctx(doc: ProjectDoc) {
  const asked: { family: string; weights: readonly number[]; italic: boolean }[] = [];
  const fonts: NonNullable<AgentHost["fonts"]> = {
    find: async (q) =>
      [
        {
          family: "Oswald",
          category: "Sans Serif",
          weights: [200, 300, 400, 700],
          italics: [],
          popularity: 19,
        },
        {
          family: "Barlow Condensed",
          category: "Sans Serif",
          weights: [300, 700],
          italics: [300],
          popularity: 120,
        },
      ].filter((f) => !q.name || f.family.toLowerCase().includes(q.name)),
    add: async (family, weights, italic) => {
      if (family === "Comic Sans") throw new Error('Google Fonts has no "Comic Sans"; near it: Comic Neue.');
      asked.push({ family, weights, italic });
      const names: Record<number, string> = { 300: "Light", 400: "Regular", 700: "Bold" };
      return weights.map((w) => `${family}-${names[w]}.ttf`);
    },
  };
  const scratch: Scratch = { doc, ops: [], groups: [] };
  const c: ToolContext = {
    scratch,
    host: { frame: async () => Buffer.from([0xff, 0xd8, 0xff]), fonts },
    step: () => {},
  };
  return { c, scratch, asked };
}

describe("Google Fonts for the agent", () => {
  it("finds families with their weights", async () => {
    const { c } = ctx(emptyProject("f"));
    const out = await runTool("find_font", { name: "condensed", category: "sans serif" }, c);
    expect(out.text).toBe("Barlow Condensed (sans serif): 300, 700; italics 300");
  });

  it("adds a family to the project, known to the request at once", async () => {
    const { c, scratch, asked } = ctx(emptyProject("f"));
    const out = await runTool("add_font", { family: "Oswald", weights: [300, 700] }, c);
    expect(out.isError).toBeFalsy();
    expect(out.text).toBe('Added Oswald: 300, 700. Use it as "Oswald" with those weights.');
    expect(scratch.doc.fonts.map((f) => [f.family, f.weight, f.file])).toEqual([
      ["Oswald", 300, "Oswald-Light.ttf"],
      ["Oswald", 700, "Oswald-Bold.ttf"],
    ]);
    // Asked again with one more weight: only the new one is fetched.
    await runTool("add_font", { family: "Oswald", weights: [300, 400] }, c);
    expect(asked.map((a) => a.weights)).toEqual([[300, 700], [400]]);
    // Not an edit of its own: the store picks the files up from fonts/.
    expect(scratch.ops).toEqual([]);
  });

  it("doesn't fetch what the app already has", async () => {
    const { c, asked } = ctx(emptyProject("f"));
    const out = await runTool("add_font", { family: "bebas neue", weights: [400] }, c);
    expect(out.text).toMatch(/already here/);
    expect(asked).toEqual([]);
  });

  it("passes on what Google Fonts says when it can't", async () => {
    const { c } = ctx(emptyProject("f"));
    const out = await runTool("add_font", { family: "Comic Sans", weights: [400] }, c);
    expect(out).toMatchObject({
      isError: true,
      text: 'Google Fonts has no "Comic Sans"; near it: Comic Neue.',
    });
  });
});
