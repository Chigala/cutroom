import { describe, expect, it } from "vitest";
import { alignText, cleanHallucinations, spellLike } from "./whisper.ts";

const words = (text: string) => text.split(" ").map((t, i) => ({ text: t, start: i, end: i + 0.5 }));

describe("cleanHallucinations", () => {
  it("collapses a loop to one sentence and keeps real repetition", () => {
    const loop = `Hi there. ${"He is a master of science in physics. ".repeat(40)}Back to the Moon.`.trim();
    expect(
      cleanHallucinations(words(loop))
        .map((w) => w.text)
        .join(" "),
    ).toBe("Hi there. He is a master of science in physics. Back to the Moon.");
    expect(cleanHallucinations(words("Go. Go. Let's go.")).length).toBe(4);
  });

  it("treats a transcript of only filler as no speech", () => {
    expect(cleanHallucinations(words("Thank you. Thank you. Thank you. Thank you."))).toEqual([]);
    expect(cleanHallucinations(words("Thank you. We are going."))).toHaveLength(5);
  });
});

describe("spellLike", () => {
  it("spells names mid-sentence like the glossary, and leaves ordinary words alone", () => {
    const out = spellLike(words("Meet Reed Wiseman, and Jeremy Hanson. Read this."), [
      "Reid Wiseman",
      "Jeremy Hansen",
    ]);
    expect(out.map((w) => w.text).join(" ")).toBe("Meet Reid Wiseman, and Jeremy Hansen. Read this.");
  });
});

describe("alignText", () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });

  it("times known words by the ones the recognizer heard, and shares out the rest", () => {
    // Sung: "Ugo Nnaka is on fire", heard only "is" and "on".
    const out = alignText("Ugo Nnaka is on fire", [w("is", 2.0, 2.2), w("on", 2.3, 2.5)], 0.5, 4);
    expect(out.map((x) => x.text)).toEqual(["Ugo", "Nnaka", "is", "on", "fire"]);
    expect(out[2]).toMatchObject({ start: 2.0, end: 2.2 });
    expect(out[3]).toMatchObject({ start: 2.3, end: 2.5 });
    // Before "is": from the start of the stretch, longer words longer.
    expect(out[0]!.start).toBe(0.5);
    expect(out[1]!.end).toBeCloseTo(2.0);
    expect(out[1]!.end - out[1]!.start).toBeGreaterThan(out[0]!.end - out[0]!.start);
    // After "on": to the end of the stretch.
    expect(out[4]).toMatchObject({ start: 2.5, end: 4 });
  });

  it("puts unmatched words where the recognizer heard something (misheard words)", () => {
    const out = alignText(
      "bring me home",
      [w("ring", 1.0, 1.3), w("my", 1.3, 1.5), w("home", 1.6, 2.0)],
      0,
      5,
    );
    expect(out[0]!.start).toBe(1.0);
    expect(out[1]!.end).toBeCloseTo(1.5);
    expect(out[2]).toMatchObject({ start: 1.6, end: 2.0 });
  });

  it("matches near spellings and spreads everything over the stretch when nothing was heard", () => {
    expect(alignText("Lagos", [w("Lagoss", 1, 2)], 0, 3)[0]).toMatchObject({ start: 1, end: 2 });
    const out = alignText("la la", [], 1, 2);
    expect(out).toEqual([w("la", 1, 1.5), w("la", 1.5, 2)]);
  });
});
