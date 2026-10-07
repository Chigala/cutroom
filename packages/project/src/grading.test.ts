import { describe, expect, it } from "vitest";
import {
  applyGrade,
  applyOps,
  emptyProject,
  gradeColorOf,
  isNeutral,
  lutFromFile,
  parseCube,
  REPLACED_GRADES,
  STARTER_GRADES,
  sampleCurve,
  sampleLut,
  shotColor,
  starterOps,
  validateStyle,
} from "./index.ts";

/** A .cube file of size n whose entries are f(r, g, b). */
function cube(n: number, f: (r: number, g: number, b: number) => number[], header = ""): string {
  const lines = [header, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) lines.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).join(" "));
  return lines.join("\n");
}

const close = (a: readonly number[], b: readonly number[], eps = 1e-4) =>
  a.every((v, i) => Math.abs(v - b[i]!) < eps);

describe("colour grading", () => {
  it("reads .cube LUTs, red fastest, and samples between entries", () => {
    const lut = parseCube(cube(5, (r, g, b) => [r, g, b], 'TITLE "Identity"\n# a comment'));
    expect(lut.size).toBe(5);
    expect(lut.title).toBe("Identity");
    expect(close(sampleLut(lut, [0.3, 0.62, 0.9]), [0.3, 0.62, 0.9])).toBe(true);
    // A LUT that swaps red and blue: red really is the fastest axis.
    const swap = parseCube(cube(3, (r, g, b) => [b, g, r]));
    expect(close(sampleLut(swap, [1, 0.5, 0]), [0, 0.5, 1])).toBe(true);
  });

  it("explains a .cube file it can't use", () => {
    expect(() => parseCube("0 0 0")).toThrow(/LUT_3D_SIZE before/);
    expect(() => parseCube("LUT_1D_SIZE 4")).toThrow(/only 3D/);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n1 1 1")).toThrow(/expected 2³ = 8 entries, found 2/);
    expect(() => parseCube("TITLE nothing")).toThrow(/no LUT_3D_SIZE/);
  });

  it("leaves the picture alone when nothing is set", () => {
    expect(isNeutral({})).toBe(true);
    expect(isNeutral({ lift: 0, gamma: [1, 1, 1], gain: 1, contrast: 1 })).toBe(true);
    expect(isNeutral({ saturation: 1.1 })).toBe(false);
    expect(applyGrade([0.2, 0.5, 0.8], {}, {})).toEqual([0.2, 0.5, 0.8]);
  });

  it("keeps a shot's brightness, contrast and saturation as CSS filters had them", () => {
    // CSS: brightness multiplies, contrast pivots on 0.5, saturate mixes with luma.
    const c: [number, number, number] = [0.3, 0.5, 0.6];
    const css = (() => {
      let [r, g, b] = c.map((v) => v * 1.2);
      [r, g, b] = [r!, g!, b!].map((v) => (v - 0.5) * 1.1 + 0.5);
      const l = 0.213 * r! + 0.715 * g! + 0.072 * b!;
      return [r!, g!, b!].map((v) => Math.min(1, Math.max(0, l + (v - l) * 0.8)));
    })();
    const shot = shotColor({ brightness: 1.2, contrast: 1.1, saturation: 0.8, warmth: 0, tint: 0 });
    expect(close(applyGrade(c, shot, null), css)).toBe(true);
  });

  it("moves shadows with lift and highlights with gain", () => {
    const g = {
      lift: [-0.02, 0.012, 0.04] as [number, number, number],
      gain: [1.06, 1, 0.92] as [number, number, number],
    };
    const dark = applyGrade([0.1, 0.1, 0.1], null, g);
    const bright = applyGrade([0.85, 0.85, 0.85], null, g);
    // Teal shadows (blue up, red down), orange highlights (red up, blue down).
    expect(dark[2]).toBeGreaterThan(dark[0]);
    expect(bright[0]).toBeGreaterThan(bright[2]);
  });

  it("draws smooth curves through their points, ends fixed unless given", () => {
    const straight = sampleCurve(undefined);
    expect(straight[0]).toBe(0);
    expect(straight[255]).toBeCloseTo(1);
    expect(straight[128]).toBeCloseTo(128 / 255, 4);
    const s = sampleCurve([
      [0.25, 0.2],
      [0.75, 0.8],
    ]);
    expect(s[0]).toBe(0);
    expect(s[255]).toBeCloseTo(1);
    expect(s[64]).toBeLessThan(64 / 255);
    expect(s[191]).toBeGreaterThan(191 / 255);
    for (let i = 1; i < 256; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]!);
    const lifted = sampleCurve([[0, 0.05]]);
    expect(lifted[0]).toBeCloseTo(0.05);
  });

  it("applies a LUT last, as much as its strength says", () => {
    const invert = parseCube(cube(2, (r, g, b) => [1 - r, 1 - g, 1 - b]));
    expect(close(applyGrade([0.2, 0.4, 0.6], null, { lut: "x.cube" }, invert), [0.8, 0.6, 0.4])).toBe(true);
    expect(
      close(applyGrade([0.2, 0.4, 0.6], null, { lut: "x.cube", lutStrength: 0.5 }, invert), [0.5, 0.5, 0.5]),
    ).toBe(true);
  });

  it("names LUT files by their file name", () => {
    expect(lutFromFile("Kodak 2383 (D65).cube")).toEqual({
      id: "Kodak-2383-D65",
      file: "Kodak 2383 (D65).cube",
    });
    expect(lutFromFile(".hidden.cube")).toBeNull();
    expect(lutFromFile("notes.txt")).toBeNull();
  });
});

describe("grade files", () => {
  it("are all colour, or CSS, or both; a bad colour is explained", () => {
    expect(validateStyle("grade", '/* grade {"name": "X", "color": {"saturation": 1.2}} */')).toBeNull();
    expect(validateStyle("grade", ".picture { filter: saturate(1.2); }")).toBeNull();
    expect(validateStyle("grade", '/* grade {"color": {"saturation": 9}} */')).toMatch(/color\.saturation/);
    expect(validateStyle("grade", '/* grade {"color": {"lut": "../x.cube"}} */')).toMatch(/color\.lut/);
    expect(validateStyle("grade", '/* grade {"color": {"sparkle": 1}} */')).toMatch(/sparkle/);
    expect(validateStyle("grade", '/* grade {"name": "X"} */')).toMatch(/\.picture/);
  });

  it("built-ins are valid, and the colour ones read back", () => {
    for (const g of STARTER_GRADES) expect(validateStyle("grade", g.css), g.id).toBeNull();
    const teal = STARTER_GRADES.find((g) => g.id === "teal-orange")!;
    expect(gradeColorOf(teal.css)).toMatchObject({ lift: [-0.02, 0.012, 0.04], gain: [1.06, 1, 0.92] });
  });

  it("replaces an older project's built-in grades, unless they were changed", () => {
    const fresh = emptyProject("t");
    const old = {
      ...fresh,
      meta: { ...fresh.meta, starters: 3 },
      grades: fresh.grades.map((g) =>
        g.id === "moody"
          ? { ...g, css: ".picture { filter: saturate(0.5); }" }
          : REPLACED_GRADES.has(g.id)
            ? { ...g, css: REPLACED_GRADES.get(g.id)! }
            : g,
      ),
    };
    const { doc } = applyOps(old, starterOps(old));
    const css = (id: string) => doc.grades.find((g) => g.id === id)!.css;
    expect(css("teal-orange")).toBe(STARTER_GRADES.find((g) => g.id === "teal-orange")!.css);
    expect(css("moody")).toBe(".picture { filter: saturate(0.5); }");
    expect(starterOps(doc)).toEqual([]);
  });
});
