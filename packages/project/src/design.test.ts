import { describe, expect, it } from "vitest";
import { designEchoes, sharedTraits } from "./design.ts";
import { Design } from "./schema.ts";

const cooking = Design.parse({
  idea: "Warm, hand-made kitchen notebook",
  palette: ["#e8743b", "#1b1612", "#f6efe6"],
  display: "Fraunces",
  text: "Inter",
  motion: "soft settling drops, things land from above like ingredients",
  graphics: ["ingredient tag", "recipe card", "price count-up"],
});

describe("designs", () => {
  it("finds nothing shared between two different looks", () => {
    const finance = Design.parse({
      palette: ["#2bd17e", "#0b0f14"],
      display: "Space Grotesk",
      text: "IBM Plex Mono",
      motion: "snappy expo-out, everything travels left to right like a ticker",
      graphics: ["live ticker", "self-drawing chart"],
    });
    expect(sharedTraits(cooking, finance)).toEqual([]);
    expect(designEchoes(cooking, [{ name: "Markets", design: finance }])).toEqual([]);
  });

  it("calls out a design that repeats most of a recent one", () => {
    const again = Design.parse({
      ...cooking,
      palette: ["#f07a30", "#000000"],
      motion: "soft drops from above, settling",
    });
    const echoes = designEchoes(again, [{ name: "Pasta night", design: cooking }]);
    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.name).toBe("Pasta night");
    expect(echoes[0]!.traits).toEqual([
      "the display face (Fraunces)",
      "an accent of nearly the same hue (#f07a30 and #e8743b)",
      "the motion language",
      "most of the graphic kinds",
    ]);
  });

  it("lets one shared trait through: a creator's handwriting", () => {
    const sameFace = Design.parse({
      ...cooking,
      palette: ["#3b6be8"],
      motion: "hard cuts",
      graphics: ["map"],
    });
    expect(sharedTraits(sameFace, cooking)).toEqual(["the display face (Fraunces)"]);
    expect(designEchoes(sameFace, [{ name: "Pasta night", design: cooking }])).toEqual([]);
  });

  it("ignores the hue of near-greys", () => {
    const grey = Design.parse({ palette: ["#808080"] });
    const otherGrey = Design.parse({ palette: ["#7f7f80"] });
    expect(sharedTraits(grey, otherGrey)).toEqual([]);
  });
});

describe("designs under a brand kit", () => {
  it("compare only motion and graphics, since the brand's faces and accent repeat by design", () => {
    const sameBrand = Design.parse({ ...cooking, motion: "hard cuts and whips", graphics: ["map", "stamp"] });
    expect(sharedTraits(sameBrand, cooking, true)).toEqual([]);
    expect(designEchoes(sameBrand, [{ name: "Pasta night", design: cooking }], true)).toEqual([]);
    const again = Design.parse({ ...cooking, motion: "soft drops from above, settling" });
    expect(designEchoes(again, [{ name: "Pasta night", design: cooking }], true)[0]!.traits).toEqual([
      "the motion language",
      "most of the graphic kinds",
    ]);
  });
});
