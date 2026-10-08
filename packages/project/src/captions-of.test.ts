import { describe, expect, it } from "vitest";
import { captionsOf, type SeenText } from "./reference.ts";

/** Twelve words said, one every 0.4 s from 1 s in. */
const said = "so here is the thing nobody tells you about selling homes online".split(" ");
const words = said.map((text, i) => ({ text, start: 1 + i * 0.4, end: 1.35 + i * 0.4 }));

/** Captions two words a page in capitals, up 0.1 s ahead of the first word; a title at the top throughout. */
function screen(): SeenText[] {
  const pages: SeenText[] = [];
  for (let i = 0; i < said.length; i += 2) {
    const start = words[i]!.start - 0.1;
    pages.push({
      start,
      end: start + 0.8,
      text: `${said[i]} ${said[i + 1] ?? ""}`.trim().toUpperCase(),
      x: 0.3,
      y: 0.62,
      w: 0.4,
      h: 0.04,
    });
  }
  return [
    { start: 0, end: 6, text: "POV: You finally listed it", x: 0.1, y: 0.08, w: 0.8, h: 0.03 },
    ...pages,
  ];
}

describe("a reference's captions, read off the screen", () => {
  it("tells captions from titles by what's said, and measures how they're set and timed", () => {
    const { captions, onScreen } = captionsOf(screen(), words);
    expect(captions).toHaveLength(1);
    expect(captions[0]).toMatchObject({
      pages: 6,
      wordsPerPage: { median: 2, max: 2 },
      linesPerPage: 1,
      secondsPerPage: 0.8,
      case: "upper",
      y: 0.64,
      height: 0.04,
      lead: -0.1,
    });
    expect(captions[0]!.coverage).toBeGreaterThan(0.8);
    expect(onScreen).toEqual([{ text: "POV: You finally listed it", start: 0, end: 6, where: "top" }]);
  });

  it("counts lines that come up together as one page", () => {
    const stacked = screen().flatMap((t) =>
      t.y > 0.5 ? [t, { ...t, start: t.start + 0.05, y: t.y + 0.05, text: t.text }] : [t],
    );
    expect(captionsOf(stacked, words).captions[0]).toMatchObject({ pages: 6, linesPerPage: 2 });
  });

  it("finds no captions in text nobody says, or too little of it", () => {
    expect(captionsOf(screen().slice(0, 1), words).captions).toEqual([]);
    expect(captionsOf([], words)).toEqual({ captions: [], onScreen: [] });
  });

  it("measures two tracks apart, and counts words caught mid-animation as said", () => {
    // Small subtitles at the bottom, and big words over the speaker, some read half in.
    const kinetic: SeenText[] = said.map((w, i) => ({
      start: words[i]!.start,
      end: words[i]!.start + 0.4,
      text: i % 3 === 1 ? w.slice(1) : i % 3 === 2 ? `${w}${said[i + 1] ?? ""}` : w,
      x: 0.2,
      y: 0.18,
      w: 0.5,
      h: 0.08,
    }));
    const { captions, onScreen } = captionsOf([...screen(), ...kinetic], words);
    expect(captions.map((c) => [c.pages, c.wordsPerPage.median, c.y, c.height])).toEqual([
      [12, 1, 0.22, 0.08],
      [6, 2, 0.64, 0.04],
    ]);
    expect(onScreen.map((o) => o.text)).toEqual(["POV: You finally listed it"]);
  });
});
