import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fontFromFile } from "@vedit/project";
import { afterAll, describe, expect, it } from "vitest";
import {
  addGoogleFont,
  findFonts,
  googleFamily,
  googleFontFile,
  parseGoogleFamilies,
} from "./google-fonts.ts";

const list = `)]}'
${JSON.stringify({
  familyMetadataList: [
    {
      family: "Oswald",
      category: "Sans Serif",
      fonts: { 200: {}, 300: {}, 400: {}, 700: {} },
      popularity: 19,
    },
    {
      family: "Barlow Condensed",
      category: "Sans Serif",
      fonts: ["100", "300", "300i", "700"],
      popularity: 120,
    },
    { family: "Bebas Neue", category: "Display", fonts: ["400"], popularity: 60 },
    { family: "Google Sans", category: "Sans Serif", fonts: ["400"], popularity: 4, isOpenSource: false },
    { family: "Playfair Display", category: "Serif", fonts: ["400", "400i", "700"], popularity: 30 },
  ],
})}`;
const families = parseGoogleFamilies(list);

describe("Google Fonts", () => {
  it("lists the open families with their weights and italics", () => {
    expect(families.map((f) => f.family)).toEqual([
      "Oswald",
      "Barlow Condensed",
      "Bebas Neue",
      "Playfair Display",
    ]);
    expect(googleFamily(families, "barlow condensed")).toMatchObject({
      weights: [100, 300, 700],
      italics: [300],
    });
  });

  it("finds them by name, kind and the weights needed, the most used first", () => {
    const names = (q: Parameters<typeof findFonts>[1]) => findFonts(families, q).map((f) => f.family);
    expect(names({ category: "sans serif", weights: [300] })).toEqual(["Oswald", "Barlow Condensed"]);
    expect(names({ name: "condensed" })).toEqual(["Barlow Condensed"]);
    expect(names({ weights: [100] })).toEqual(["Barlow Condensed"]);
    expect(names({ italic: true, category: "Serif" })).toEqual(["Playfair Display"]);
    expect(names({ name: "nothing like it" })).toEqual([]);
  });

  it("names its files so the project reads the family and weight back", () => {
    for (const [family, weight, italic] of [
      ["Barlow Condensed", 300, false],
      ["Oswald", 700, true],
      ["Playfair Display", 400, true],
      ["Bebas Neue", 400, false],
    ] as const) {
      const file = googleFontFile(family, weight, italic);
      expect(fontFromFile(file), file).toMatchObject({ family, weight, style: italic ? "italic" : "normal" });
    }
  });

  describe("fetched into a project", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vedit-fonts-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const asked: string[] = [];
    // Google's CSS for what was asked (one face per weight and style), and a "font" for each file.
    const google: typeof fetch = async (input) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith("https://fonts.googleapis.com/css2"))
        return new Response(
          [
            ["normal", 300, "light.ttf"],
            ["italic", 300, "lightitalic.ttf"],
            ["normal", 700, "bold.ttf"],
          ]
            .map(
              ([style, weight, file]) =>
                `@font-face {\n  font-family: 'Barlow Condensed';\n  font-style: ${style};\n  font-weight: ${weight};\n  src: url(https://fonts.gstatic.com/s/barlowcondensed/${file}) format('truetype');\n}`,
            )
            .join("\n"),
        );
      return new Response(`font:${url.split("/").pop()}`);
    };

    it("asks for exactly the weights and italics wanted, and writes one whole file each", async () => {
      const barlow = googleFamily(families, "Barlow Condensed")!;
      const files = await addGoogleFont(dir, barlow, [300, 700], true, google);
      expect(asked[0]).toBe(
        "https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,300;0,700;1,300",
      );
      expect(files.sort()).toEqual([
        "Barlow Condensed-Bold.ttf",
        "Barlow Condensed-Light.ttf",
        "Barlow Condensed-LightItalic.ttf",
      ]);
      expect(readdirSync(dir).sort()).toEqual(files.sort());
      expect(readFileSync(path.join(dir, "Barlow Condensed-Light.ttf"), "utf8")).toBe("font:light.ttf");
    });

    it("says which weights a family comes in when asked for one it doesn't", async () => {
      await expect(
        addGoogleFont(dir, googleFamily(families, "Bebas Neue")!, [300], false, google),
      ).rejects.toThrow("Bebas Neue doesn't come in 300; it has 400.");
    });
  });
});
