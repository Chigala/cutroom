/**
 * Colour grading the way colourists work: white balance, exposure, lift/gamma/gain, contrast,
 * saturation, curves, and LUTs (.cube files, the format cameras, colourists and editors share).
 *
 * Two places use it. A grade file's header carries the look of the whole video:
 *
 *   / * grade {"name": "Teal and orange", "color": {"lift": [-0.02, 0.01, 0.03], "gain": [1.05, 1, 0.94]}} * /
 *
 * (without the spaces), and a shot's own correction (scene.adjust) runs first, under it: correct each
 * shot, then grade them all the same. The maths here is the spec; the composition runs the same steps
 * on the GPU (color-gl.ts in @vedit/composition), and applyGrade is the reference its tests compare to.
 *
 * Values are the picture's own (sRGB-encoded, 0..1), as in CSS: contrast pivots on 0.5 and saturation
 * mixes with the same luma, so a shot's brightness/contrast/saturation look exactly as they did as CSS
 * filters.
 */
import { z } from "zod";

const Unit = z.number().min(0).max(1);

/** One value for all three channels, or [red, green, blue]. */
const Rgb = (min: number, max: number) =>
  z.union([z.number().min(min).max(max), z.tuple([z.number(), z.number(), z.number()])]);

const Curve = z
  .array(z.tuple([Unit, Unit]))
  .max(16)
  .describe("Points [in, out], 0..1, left to right; the ends are (0,0) and (1,1) unless given");

export const GradeColor = z
  .object({
    warmth: z.number().min(-1).max(1).describe("White balance: -1 cool/blue to 1 warm/orange"),
    tint: z.number().min(-1).max(1).describe("-1 green to 1 magenta"),
    exposure: z.number().min(-4).max(4).describe("Stops of light: 1 is twice as bright"),
    lift: Rgb(-0.5, 0.5).describe("Shadows: 0 neutral; raises (or crushes, below 0) the blacks"),
    gamma: Rgb(0.2, 5).describe("Midtones: 1 neutral; above 1 brightens them"),
    gain: Rgb(0, 4).describe("Highlights: 1 neutral; multiplies the whole picture, most visible up top"),
    contrast: z.number().min(0).max(3).describe("1 neutral, around mid grey"),
    saturation: z.number().min(0).max(3).describe("1 neutral, 0 black and white"),
    curves: z
      .object({ all: Curve, red: Curve, green: Curve, blue: Curve })
      .partial()
      .describe("Tone curves: all (the master), then each channel"),
    lut: z
      .string()
      .regex(/^[^/\\]+\.cube$/i, "a .cube file name in luts/")
      .describe("A LUT from the project's luts/ folder, applied last"),
    lutStrength: Unit.describe("How much of the LUT: 1 all of it"),
    grain: Unit.describe("Film grain, last: 0 none, 0.3 visible, 0.6 heavy; strongest in the midtones"),
    grainSize: z
      .number()
      .min(0.5)
      .max(6)
      .describe("Grain size in pixels of a 1080-wide frame (1.5 if unset)"),
  })
  .partial();
export type GradeColor = z.infer<typeof GradeColor>;

type Vec3 = readonly [number, number, number];

/** Every step of a grade, resolved: what the shader's uniforms hold. */
export interface GradeSteps {
  readonly balance: Vec3;
  readonly exposure: number;
  readonly lift: Vec3;
  readonly gamma: Vec3;
  readonly gain: Vec3;
  readonly contrast: number;
  readonly saturation: number;
  /** 256 entries per channel (r, g, b interleaved), master curve folded in; null when straight. */
  readonly curves: Float32Array | null;
  readonly lut: string | null;
  readonly lutStrength: number;
  readonly grain: number;
  readonly grainSize: number;
}

const rgb = (v: number | readonly number[] | undefined, fallback: number): Vec3 =>
  v === undefined
    ? [fallback, fallback, fallback]
    : typeof v === "number"
      ? [v, v, v]
      : [v[0]!, v[1]!, v[2]!];

/**
 * White balance as channel gains: warmth scales red against blue, tint green against magenta, the way
 * a camera's white balance does (a hue rotation would twist skin tones instead).
 */
export function balanceGains(warmth = 0, tint = 0): Vec3 {
  return [1 + 0.25 * warmth, 1 + 0.03 * warmth - 0.12 * tint, 1 - 0.25 * warmth];
}

export function gradeSteps(c: GradeColor): GradeSteps {
  return {
    balance: balanceGains(c.warmth, c.tint),
    exposure: c.exposure ?? 0,
    lift: rgb(c.lift, 0),
    gamma: rgb(c.gamma, 1),
    gain: rgb(c.gain, 1),
    contrast: c.contrast ?? 1,
    saturation: c.saturation ?? 1,
    curves: c.curves && Object.values(c.curves).some((p) => p?.length) ? curveTable(c.curves) : null,
    lut: c.lut ?? null,
    lutStrength: c.lutStrength ?? 1,
    grain: c.grain ?? 0,
    grainSize: c.grainSize ?? 1.5,
  };
}

/** True when a grade leaves the picture as it is (so nothing needs to run). */
export function isNeutral(c: GradeColor | null | undefined): boolean {
  if (!c) return true;
  const s = gradeSteps(c);
  const one = (v: Vec3, n: number) => v.every((x) => x === n);
  return (
    one(s.balance, 1) &&
    s.exposure === 0 &&
    one(s.lift, 0) &&
    one(s.gamma, 1) &&
    one(s.gain, 1) &&
    s.contrast === 1 &&
    s.saturation === 1 &&
    !s.curves &&
    (!s.lut || s.lutStrength === 0) &&
    s.grain === 0
  );
}

/** A shot's own correction (scene.adjust) as a grade: brightness is gain, as CSS brightness() was. */
export function shotColor(a: {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
  tint?: number;
  exposure?: number | undefined;
  lift?: number | readonly number[] | undefined;
  gamma?: number | readonly number[] | undefined;
  gain?: number | readonly number[] | undefined;
}): GradeColor {
  const b = a.brightness ?? 1;
  const gain = rgb(a.gain as number | number[] | undefined, 1).map((g) => g * b) as [number, number, number];
  return {
    ...(a.warmth && { warmth: a.warmth }),
    ...(a.tint && { tint: a.tint }),
    ...(a.exposure && { exposure: a.exposure }),
    ...(a.lift !== undefined && { lift: rgb(a.lift as number | number[], 0) as [number, number, number] }),
    ...(a.gamma !== undefined && { gamma: rgb(a.gamma as number | number[], 1) as [number, number, number] }),
    ...(gain.some((g) => g !== 1) && { gain }),
    ...(a.contrast !== undefined && a.contrast !== 1 && { contrast: a.contrast }),
    ...(a.saturation !== undefined && a.saturation !== 1 && { saturation: a.saturation }),
  };
}

// ---- Curves --------------------------------------------------------------------------------------

/**
 * A smooth curve through the points that never overshoots between them (monotone cubic, the way
 * grading tools draw curves), sampled at 256 steps.
 */
export function sampleCurve(
  points: readonly (readonly [number, number])[] | undefined,
  n = 256,
): Float32Array {
  const out = new Float32Array(n);
  const p = [...(points ?? [])].sort((a, b) => a[0] - b[0]);
  if (!p.length || p[0]![0] > 0) p.unshift([0, 0]);
  if (p.at(-1)![0] < 1) p.push([1, 1]);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const k = xs.length;
  const d: number[] = [];
  for (let i = 0; i < k - 1; i++) d.push((ys[i + 1]! - ys[i]!) / Math.max(1e-6, xs[i + 1]! - xs[i]!));
  const m: number[] = [d[0] ?? 0];
  for (let i = 1; i < k - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  m.push(d[k - 2] ?? 0);
  // Fritsch–Carlson: keep each piece monotone.
  for (let i = 0; i < k - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  let j = 0;
  for (let s = 0; s < n; s++) {
    const x = s / (n - 1);
    while (j < k - 2 && x > xs[j + 1]!) j++;
    const h = Math.max(1e-6, xs[j + 1]! - xs[j]!);
    const t = Math.min(1, Math.max(0, (x - xs[j]!) / h));
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * ys[j]! +
      (t3 - 2 * t2 + t) * h * m[j]! +
      (-2 * t3 + 3 * t2) * ys[j + 1]! +
      (t3 - t2) * h * m[j + 1]!;
    out[s] = Math.min(1, Math.max(0, y));
  }
  return out;
}

/** The three channel curves with the master folded in: entry i of channel c is c(all(i)). */
export function curveTable(c: NonNullable<GradeColor["curves"]>, n = 256): Float32Array {
  const all = sampleCurve(c.all, n);
  const chans = [sampleCurve(c.red, n), sampleCurve(c.green, n), sampleCurve(c.blue, n)];
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = lookup1d(chans[ch]!, all[i]!);
  return out;
}

function lookup1d(table: Float32Array, v: number): number {
  const x = Math.min(1, Math.max(0, v)) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(x));
  return table[i]! + (table[i + 1]! - table[i]!) * (x - i);
}

// ---- LUTs ----------------------------------------------------------------------------------------

/** A 3D LUT: size³ entries of r, g, b, red changing fastest (the .cube order). */
export interface Lut {
  readonly size: number;
  readonly data: Float32Array;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly title?: string;
}

/** Reads a .cube file (Adobe/Resolve). Throws a readable error on anything else. */
export function parseCube(text: string): Lut {
  let size = 0;
  let min: Vec3 = [0, 0, 0];
  let max: Vec3 = [1, 1, 1];
  let title: string | undefined;
  let data: Float32Array | null = null;
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const c = line.charCodeAt(0);
    // Data lines start with a digit, a sign or a dot.
    if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
      if (!data) throw new Error("a .cube file needs LUT_3D_SIZE before its numbers");
      const parts = line.split(/\s+/);
      if (parts.length < 3) throw new Error(`a .cube line needs three numbers: "${line}"`);
      if (n >= data.length) throw new Error(`more than ${size}³ entries`);
      data[n++] = Number(parts[0]);
      data[n++] = Number(parts[1]);
      data[n++] = Number(parts[2]);
      continue;
    }
    const [key, ...rest] = line.split(/\s+/);
    switch (key) {
      case "TITLE":
        title = rest.join(" ").replace(/^"|"$/g, "");
        break;
      case "LUT_3D_SIZE":
        size = Number(rest[0]);
        if (!Number.isInteger(size) || size < 2 || size > 129)
          throw new Error(`LUT_3D_SIZE ${rest[0]} isn't 2..129`);
        data = new Float32Array(size * size * size * 3);
        break;
      case "LUT_1D_SIZE":
        throw new Error("only 3D LUTs (LUT_3D_SIZE) are supported, not 1D ones");
      case "DOMAIN_MIN":
        min = [Number(rest[0]), Number(rest[1]), Number(rest[2])];
        break;
      case "DOMAIN_MAX":
        max = [Number(rest[0]), Number(rest[1]), Number(rest[2])];
        break;
      default:
      // Other keywords (LUT_IN_VIDEO_RANGE and the like) change nothing here.
    }
  }
  if (!data) throw new Error("not a .cube LUT: no LUT_3D_SIZE");
  if (n !== data.length) throw new Error(`expected ${size}³ = ${size ** 3} entries, found ${n / 3}`);
  if (data.some((v) => !Number.isFinite(v))) throw new Error("a .cube entry isn't a number");
  return { size, data, min, max, ...(title && { title }) };
}

/** A LUT's colour for one input colour, trilinear (what the GPU's 3D texture does). */
export function sampleLut(lut: Lut, c: Vec3): Vec3 {
  const n = lut.size;
  const pos = c.map((v, i) => {
    const x = ((v - lut.min[i]!) / (lut.max[i]! - lut.min[i]!)) * (n - 1);
    return Math.min(n - 1, Math.max(0, x));
  });
  const i0 = pos.map((x) => Math.min(n - 2, Math.floor(x)));
  const f = pos.map((x, i) => x - i0[i]!);
  const at = (r: number, g: number, b: number, ch: number) => lut.data[((b * n + g) * n + r) * 3 + ch]!;
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let v = 0;
    for (let dr = 0; dr < 2; dr++)
      for (let dg = 0; dg < 2; dg++)
        for (let db = 0; db < 2; db++) {
          const w = (dr ? f[0]! : 1 - f[0]!) * (dg ? f[1]! : 1 - f[1]!) * (db ? f[2]! : 1 - f[2]!);
          v += w * at(i0[0]! + dr, i0[1]! + dg, i0[2]! + db, ch);
        }
    out[ch] = v;
  }
  return out as unknown as Vec3;
}

// ---- The reference --------------------------------------------------------------------------------

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** One grade's steps on one colour, in order. The shader does exactly this, then adds the grain (random). */
export function applySteps(c: Vec3, s: GradeSteps, lut: Lut | null): Vec3 {
  let [r, g, b] = c.map((v, i) => v * s.balance[i]!) as [number, number, number];
  if (s.exposure) {
    const k = 2 ** s.exposure;
    [r, g, b] = [r, g, b].map((v) => toSrgb(toLinear(Math.max(0, v)) * k)) as [number, number, number];
  }
  [r, g, b] = [r, g, b].map((v, i) => {
    const lifted = s.gain[i]! * (v + s.lift[i]! * (1 - v));
    return Math.max(0, lifted) ** (1 / s.gamma[i]!);
  }) as [number, number, number];
  [r, g, b] = [r, g, b].map((v) => (v - 0.5) * s.contrast + 0.5) as [number, number, number];
  const luma = 0.213 * r + 0.715 * g + 0.072 * b;
  [r, g, b] = [r, g, b].map((v) => clamp(luma + (v - luma) * s.saturation)) as [number, number, number];
  if (s.curves) {
    const n = s.curves.length / 3;
    [r, g, b] = [r, g, b].map((v, ch) => {
      const x = v * (n - 1);
      const i = Math.min(n - 2, Math.floor(x));
      const a = s.curves![i * 3 + ch]!;
      return a + (s.curves![(i + 1) * 3 + ch]! - a) * (x - i);
    }) as [number, number, number];
  }
  if (lut && s.lutStrength > 0) {
    const l = sampleLut(lut, [r, g, b]);
    [r, g, b] = [r, g, b].map((v, i) => clamp(v + (l[i]! - v) * s.lutStrength)) as [number, number, number];
  }
  return [r, g, b];
}

/** A shot's correction, then the grade: what one pixel becomes. */
export function applyGrade(
  c: Vec3,
  shot: GradeColor | null,
  grade: GradeColor | null,
  lut: Lut | null = null,
): Vec3 {
  let out = c;
  if (shot && !isNeutral(shot)) out = applySteps(out, gradeSteps(shot), null);
  if (grade && !isNeutral(grade)) out = applySteps(out, gradeSteps(grade), lut);
  return out;
}

/**
 * The nearest CSS filter, for a screen that can't run WebGL2: exposure and gain as brightness, then
 * contrast and saturation. White balance, lift, gamma, curves and LUTs are left out.
 */
export function cssApproximation(c: GradeColor | null): string {
  if (!c) return "";
  const s = gradeSteps(c);
  const parts: string[] = [];
  const bright = ((s.gain[0] + s.gain[1] + s.gain[2]) / 3) * 2 ** (s.exposure / 2.2);
  if (Math.abs(bright - 1) > 0.001) parts.push(`brightness(${bright.toFixed(3)})`);
  if (s.contrast !== 1) parts.push(`contrast(${s.contrast})`);
  if (s.saturation !== 1) parts.push(`saturate(${s.saturation})`);
  return parts.join(" ");
}

/** luts/<file>: a LUT the user dropped into the project. */
export const LUTS_DIR = "luts";

/** A LUT file's entry, from its name: "Kodak 2383.cube" is id "Kodak-2383". */
export function lutFromFile(file: string): { id: string; file: string } | null {
  const m = /^(.+)\.cube$/i.exec(file);
  if (!m || file.includes("/") || file.includes("\\") || file.startsWith(".")) return null;
  const id = m[1]!
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return id ? { id, file } : null;
}
