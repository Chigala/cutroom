/**
 * Overlays that last, as the renderer draws them: a watermark on for the whole video, over everything,
 * inside the app's clear area in a portrait frame. Slow (a browser, a bundle), so only with
 * VEDIT_RENDER_TESTS=1; run it on each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/overlay.render.test.ts
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

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("overlays that last, rendered", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-overlay-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Two plain shots, a full-frame black graphic on the top layer over both, and the watermark. */
  function project(width: number, height: number): ProjectDoc {
    const doc0 = emptyProject("overlays");
    const doc = {
      ...doc0,
      meta: { ...doc0.meta, format: { ...doc0.meta.format, width, height } },
      look: { ...doc0.look, drift: false, grade: "none" },
      graphics: [
        ...doc0.graphics,
        {
          id: "cover-all",
          html: '<div class="stage" style="position:absolute;inset:0;background:#000"></div>\n',
        },
      ],
    };
    return applyOps(doc, [
      {
        op: "insert",
        coll: "sources",
        item: { id: "blue", kind: "solid", label: "blue", color: "#1030c0", duration: 0 } as never,
      },
      {
        op: "insert",
        coll: "sources",
        item: { id: "red", kind: "solid", label: "red", color: "#c01010", duration: 0 } as never,
      },
      { op: "insert", coll: "scenes", item: { id: "s1", source: "blue", in: 0, out: 3 } as never },
      { op: "insert", coll: "scenes", item: { id: "s2", source: "red", in: 0, out: 3 } as never },
      {
        op: "insert",
        coll: "visuals",
        item: {
          id: "black",
          anchor: { scene: "s1", at: 0 },
          duration: 1,
          until: "end",
          layer: 10,
          layout: "overlay",
          content: { kind: "graphic", graphic: "cover-all", params: {} },
        } as never,
      },
      {
        op: "insert",
        coll: "visuals",
        item: {
          id: "mark",
          // Anchored late on purpose: whole ignores it.
          anchor: { scene: "s2", at: 2 },
          duration: 1,
          whole: true,
          onTop: true,
          clear: true,
          layout: "overlay",
          content: {
            kind: "graphic",
            graphic: "watermark",
            params: { text: "@cutroom", size: 9, opacity: 1 },
          },
        } as never,
      },
    ]).doc;
  }

  async function frames(doc: ProjectDoc, times: number[]) {
    const { images, errors } = await renderStills({
      doc,
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      times,
      resolve: async () => null,
      scale: 0.5,
      imageFormat: "png",
    });
    expect(errors).toEqual([]);
    return images;
  }

  /** The brightest pixel in a box of a rendered frame (full-size coordinates, rendered at half). */
  const brightest = (png: Buffer, x: number, y: number, w: number, h: number) => {
    const raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        "pipe:0",
        "-vf",
        `crop=${w / 2}:${h / 2}:${x / 2}:${y / 2},format=gray`,
        "-f",
        "rawvideo",
        "-",
      ],
      { input: png },
    );
    let max = 0;
    for (const v of raw) if (v > max) max = v;
    return max;
  };

  it("stays on through every shot, over everything, off a phone app's buttons", async () => {
    const shots = await frames(project(1080, 1920), [0.5, 5.5]);
    for (const png of shots) {
      // In the clear area's bottom right corner (TikTok's: 82% across, 78% down)...
      expect(brightest(png, 520, 1380, 360, 118)).toBeGreaterThan(200);
      // ...and nothing under the buttons, or anywhere else: the black graphic covers the rest.
      expect(brightest(png, 900, 1520, 180, 400)).toBeLessThan(40);
      expect(brightest(png, 0, 0, 1080, 1300)).toBeLessThan(40);
    }
  }, 300_000);

  it("uses the whole frame of a wide video", async () => {
    const [png] = await frames(project(1920, 1080), [1.5]);
    expect(brightest(png!, 1400, 960, 520, 120)).toBeGreaterThan(200);
  }, 300_000);
});
