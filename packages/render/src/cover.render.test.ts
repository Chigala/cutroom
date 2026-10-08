/**
 * The cover, as the export draws it: in a graded video (the grade is effects on the cover's pictures)
 * whose cutout can't be had, it still comes out, from the frame with the headline in front. Slow (a
 * browser, a bundle), so only with VEDIT_RENDER_TESTS=1; run it on each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/cover.render.test.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOps, emptyProject, type ProjectDoc } from "@vedit/project";
import { afterAll, describe, expect, it } from "vitest";
import { renderStills } from "./stills.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("the cover, rendered", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-cover-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // The moment's frame: plain red.
  const frame = path.join(dir, "frame.png");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xc01010:s=1080x1920",
    "-frames:v",
    "1",
    frame,
  ]);

  /** A photo shot in the film grade, with a cover behind the person (so it wants a cutout). */
  function project(): ProjectDoc {
    const doc0 = emptyProject("cover");
    const doc = {
      ...doc0,
      meta: { ...doc0.meta, format: { ...doc0.meta.format, width: 1080, height: 1920 } },
      look: { ...doc0.look, grade: "film" },
    };
    return applyOps(doc, [
      {
        op: "insert",
        coll: "sources",
        item: { id: "photo", kind: "image", label: "photo", path: frame, duration: 0 } as never,
      },
      { op: "insert", coll: "scenes", item: { id: "s1", source: "photo", in: 0, out: 3 } as never },
      { op: "merge", key: "cover", patch: { text: "Big *news*", place: "behind" } },
    ]).doc;
  }

  /** The average colour of a box of the rendered cover (full-size coordinates, rendered at half). */
  const average = (png: Buffer, x: number, y: number, w: number, h: number): [number, number, number] => {
    const raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        "pipe:0",
        "-vf",
        `crop=${w / 2}:${h / 2}:${x / 2}:${y / 2},scale=1:1:flags=area`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { input: png },
    );
    return [raw[0]!, raw[1]!, raw[2]!];
  };

  it("comes out in a graded video when the cutout can't be had", async () => {
    const { images, errors } = await renderStills({
      doc: project(),
      composition: "Cover",
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      times: [0],
      // The frame is there; the cutout (and the clean blur made from it) isn't.
      resolve: async (key) => (key.endsWith("~frame") ? frame : null),
      scale: 0.5,
      imageFormat: "png",
    });
    expect(errors).toEqual([]);
    const [r, g, b] = average(images[0]!, 0, 0, 1080, 300);
    // The graded frame: still mostly red.
    expect(r).toBeGreaterThan(90);
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);
  }, 300_000);

  it("draws the cut-out person over the frame when there is one", async () => {
    // The "person": a white square on a see-through frame.
    const cut = path.join(dir, "cut.png");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=400x400,format=rgba,pad=1080:1920:340:600:color=0x00000000",
      "-frames:v",
      "1",
      cut,
    ]);
    const { images, errors } = await renderStills({
      doc: project(),
      composition: "Cover",
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      times: [0],
      resolve: async (key) => (key.endsWith("~frame") ? frame : key.endsWith("~cut") ? cut : null),
      scale: 0.5,
      imageFormat: "png",
    });
    expect(errors).toEqual([]);
    // The square, graded but still near white, over the red frame.
    const [r, g, b] = average(images[0]!, 400, 660, 280, 280);
    expect(Math.min(r, g, b)).toBeGreaterThan(170);
  }, 300_000);
});
