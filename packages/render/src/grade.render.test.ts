/**
 * The colour grade as the renderer really draws it: frames rendered in headless Chrome, their pixels
 * compared with the reference maths (applyGrade in @vedit/project). Slow (a browser, a bundle), so only
 * with VEDIT_RENDER_TESTS=1; run it on each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/grade.render.test.ts
 *
 * VEDIT_GL picks the renderer to check (unset: this platform's default; swangle: software).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyGrade,
  applyOps,
  emptyProject,
  type GradeColor,
  gradeColorOf,
  type Lut,
  type ProjectDoc,
  parseCube,
  STARTER_GRADES,
  shotColor,
} from "@vedit/project";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderStills } from "./stills.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 1080;
const H = 1920;
/** Flat stripes: greys from shadow to highlight, then skin, sky and grass. */
const STRIPES = [
  [20, 20, 20],
  [64, 64, 64],
  [128, 128, 128],
  [192, 192, 192],
  [235, 235, 235],
  [200, 120, 90],
  [60, 110, 170],
  [90, 160, 70],
] as const;
const SW = W / STRIPES.length;

const ffmpeg = (args: string[], input?: Buffer) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
};

/** The middle of each stripe, 0..255, from a rendered PNG. */
function stripes(png: Buffer): number[][] {
  const raw = ffmpeg(["-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], png);
  const w = Math.round(Math.sqrt((raw.length / 3) * (W / H)));
  const h = raw.length / 3 / w;
  return STRIPES.map((_, i) => {
    const x = Math.round((i + 0.5) * (w / STRIPES.length));
    const at = (Math.round(h / 2) * w + x) * 3;
    return [raw[at]!, raw[at + 1]!, raw[at + 2]!];
  });
}

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("the colour grade, rendered", () => {
  let dir: string;
  const files = new Map<string, string>();
  let base: ProjectDoc;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vedit-grade-"));
    const frame = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) frame.set(STRIPES[Math.floor(x / SW)]!, (y * W + x) * 3);
    const raw = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`];
    files.set("img", path.join(dir, "stripes.png"));
    ffmpeg([...raw, "-i", "pipe:0", files.get("img")!], frame);
    files.set("vid", path.join(dir, "stripes.mp4"));
    ffmpeg(
      [
        ...raw,
        "-framerate",
        "30",
        "-i",
        "pipe:0",
        "-t",
        "2",
        "-vf",
        "loop=59:1:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-color_range",
        "tv",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        files.get("vid")!,
      ],
      frame,
    );
    // The same stripes, half see-through: what a cut-out person's edges are.
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      frame.copy(rgba, i * 4, i * 3, i * 3 + 3);
      rgba[i * 4 + 3] = 128;
    }
    files.set("half", path.join(dir, "half.png"));
    ffmpeg(
      ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-i", "pipe:0", files.get("half")!],
      rgba,
    );
    mkdirSync(path.join(dir, "luts"));
    const doc = emptyProject("grade test");
    base = applyOps({ ...doc, look: { ...doc.look, drift: false, grade: "none" } }, [
      {
        op: "insert",
        coll: "sources",
        item: {
          id: "img",
          kind: "image",
          label: "stripes.png",
          path: files.get("img")!,
          width: W,
          height: H,
          duration: 5,
        } as never,
      },
      {
        op: "insert",
        coll: "sources",
        item: {
          id: "vid",
          kind: "video",
          label: "stripes.mp4",
          path: files.get("vid")!,
          width: W,
          height: H,
          duration: 2,
          fps: 30,
        } as never,
      },
      { op: "insert", coll: "scenes", item: { id: "s1", source: "img", in: 0, out: 1 } as never },
      { op: "insert", coll: "scenes", item: { id: "s2", source: "vid", in: 0, out: 1 } as never },
    ]).doc;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** The stripes at the middle of shot 1 (a photo) and shot 2 (a video). */
  async function render(doc: ProjectDoc) {
    const { images, errors } = await renderStills({
      doc,
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      times: [0.5, 1.5],
      resolve: async (key) => files.get(key) ?? (key.startsWith("luts/") ? path.join(dir, key) : null),
      scale: 0.5,
      imageFormat: "png",
    });
    expect(errors).toEqual([]);
    return images.map(stripes);
  }

  const withGrade = (css: string, extra: Partial<ProjectDoc> = {}): ProjectDoc => ({
    ...base,
    ...extra,
    grades: [...base.grades.filter((g) => g.id !== "test"), { id: "test", css }],
    look: { ...base.look, grade: "test" },
  });

  /** Graded pixels against the reference run on the ungraded ones, within `tol` of 255. */
  function expectGraded(
    got: number[][],
    plain: number[][],
    shot: GradeColor | null,
    grade: GradeColor | null,
    lut: Lut | null = null,
    tol = 3,
  ) {
    got.forEach((px, i) => {
      const want = applyGrade(
        plain[i]!.map((v) => v / 255) as [number, number, number],
        shot,
        grade,
        lut,
      ).map((v) => v * 255);
      const off = Math.max(...px.map((v, c) => Math.abs(v - want[c]!)));
      expect(off, `stripe ${i}: got ${px}, want ${want.map((v) => v.toFixed(1))}`).toBeLessThanOrEqual(tol);
    });
  }

  let plain: number[][][];

  it("draws the footage as it is with no grade", async () => {
    plain = await render(base);
    // The photo comes through exactly.
    for (const [i, px] of plain[0]!.entries())
      expect(Math.max(...px.map((v, c) => Math.abs(v - STRIPES[i]![c]!)))).toBeLessThanOrEqual(1);
  }, 300_000);

  it("grades photos and video with every built-in grade, as the reference does", async () => {
    for (const g of STARTER_GRADES) {
      const graded = gradeColorOf(g.css);
      if (!graded) continue;
      // The colour alone: grain is random, checked on its own below.
      const { grain: _grain, grainSize: _size, ...color } = graded;
      const got = await render(withGrade(`/* grade ${JSON.stringify({ color })} */`));
      expectGraded(got[0]!, plain[0]!, null, color);
      expectGraded(got[1]!, plain[1]!, null, color);
    }
  }, 600_000);

  it("corrects a shot first, then grades it", async () => {
    const adjust = {
      brightness: 1.1,
      contrast: 1.05,
      saturation: 0.9,
      warmth: 0.3,
      tint: -0.2,
      blur: 0,
      lift: [0.02, 0, -0.02] as [number, number, number],
      gamma: 1.1,
      exposure: 0.3,
    };
    const grade = gradeColorOf(STARTER_GRADES.find((g) => g.id === "teal-orange")!.css)!;
    const doc = withGrade(`/* grade ${JSON.stringify({ color: grade })} */`);
    const got = await render({ ...doc, scenes: doc.scenes.map((s) => ({ ...s, adjust })) });
    expectGraded(got[0]!, plain[0]!, shotColor(adjust), grade);
    expectGraded(got[1]!, plain[1]!, shotColor(adjust), grade);
  }, 300_000);

  it("grades see-through footage without darkening or fringing its edges", async () => {
    const grade = gradeColorOf(STARTER_GRADES.find((g) => g.id === "teal-orange")!.css)!;
    const doc = withGrade(`/* grade ${JSON.stringify({ color: grade })} */`);
    const half = applyOps({ ...doc, look: { ...doc.look, background: "#ffffff" } }, [
      {
        op: "insert",
        coll: "sources",
        item: {
          id: "half",
          kind: "image",
          label: "half.png",
          path: files.get("half")!,
          width: W,
          height: H,
          duration: 5,
        } as never,
      },
      { op: "update", coll: "scenes", id: "s1", patch: { source: "half" } },
    ]).doc;
    const [got] = await render(half);
    got!.forEach((px, i) => {
      // Graded colour at half strength over white: straight alpha, graded once.
      const a = 128 / 255;
      const want = applyGrade(STRIPES[i]!.map((v) => v / 255) as [number, number, number], null, grade).map(
        (v) => (v * a + (1 - a)) * 255,
      );
      const off = Math.max(...px.map((v, c) => Math.abs(v - want[c]!)));
      expect(off, `stripe ${i}: got ${px}, want ${want.map((v) => v.toFixed(1))}`).toBeLessThanOrEqual(3);
    });
  }, 300_000);

  it("adds grain that moves every frame and leaves the colour where it was", async () => {
    const grade: GradeColor = { grain: 0.5, grainSize: 1 };
    const doc = withGrade(`/* grade ${JSON.stringify({ color: grade })} */`);
    const { images } = await renderStills({
      doc,
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      times: [1.5, 1.6],
      resolve: async (key) => files.get(key) ?? null,
      scale: 0.5,
      imageFormat: "png",
    });
    // A patch of the mid-grey stripe, two frames apart.
    const patch = (png: Buffer) => {
      const raw = ffmpeg(
        ["-i", "pipe:0", "-vf", "crop=40:40:148:460", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
        png,
      );
      return [...raw];
    };
    const [a, b] = images.map(patch) as [number[], number[]];
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
    const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
    // Grain shows (the patch was flat), averages out to the grey it was, and isn't the same next frame.
    expect(sd(a)).toBeGreaterThan(3);
    expect(Math.abs(mean(a) - plain[1]![2]![0]!)).toBeLessThan(2);
    expect(a.filter((v, i) => v !== b[i]).length).toBeGreaterThan(a.length / 2);
  }, 300_000);

  it("applies a .cube LUT from luts/, at its strength", async () => {
    // Channels rotated, with a curve: nothing a LUT could get right by accident.
    const n = 17;
    const lines = [`LUT_3D_SIZE ${n}`];
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++)
          lines.push([g, b, r].map((v) => ((v / (n - 1)) ** 0.8).toFixed(6)).join(" "));
    writeFileSync(path.join(dir, "luts", "Rotate.cube"), lines.join("\n"));
    const lut = parseCube(lines.join("\n"));
    const color: GradeColor = { contrast: 1.1, lut: "Rotate.cube", lutStrength: 0.7 };
    const got = await render(
      withGrade(`/* grade ${JSON.stringify({ color })} */`, {
        luts: [{ id: "Rotate", file: "Rotate.cube" }],
      }),
    );
    expectGraded(got[0]!, plain[0]!, null, color, lut);
    expectGraded(got[1]!, plain[1]!, null, color, lut);
  }, 300_000);
});
