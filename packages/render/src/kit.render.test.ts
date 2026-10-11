/**
 * The graphics kit as the renderer draws it, in both kinds of graphic: a plain one built from the kit's
 * parts (a line split into words that rise in, a fitted line) and a scripted one whose GSAP tween uses the
 * kit's "k-out" ease. Each draws text where it should, without errors. Slow (a browser, a bundle), so
 * only with VEDIT_RENDER_TESTS=1; run it on each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/kit.render.test.ts
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

/** A white line split into words that rise in, top half; a fitted white line, bottom half. */
const PLAIN = `<!-- graphic {"name":"Kit","duration":3,"params":{"line":{"type":"text","default":"Built from the kit"}}} -->
<style>.stage { position: absolute; inset: 0; container-type: size; color: #fff; font-family: var(--font); }</style>
<div class="stage k-out">
  <div class="k-display" style="position:absolute; top: 20cqh; left: 7cqw; font-size: 9cqw;" data-split="words" data-in="rise">{{line}}</div>
  <div class="k-display k-mask" style="position:absolute; top: 60cqh; left: 7cqw;" data-fit>A much longer line that has to fit</div>
</div>`;

/** A white bar that slides in with the kit's GSAP ease, top half. */
const SCRIPTED = `<!-- graphic {"name":"Kit GSAP","duration":3,"libs":["gsap"]} -->
<style>.bar { position: absolute; left: 10%; top: 20%; width: 80%; height: 10%; background: #fff; }</style>
<div class="bar" id="bar"></div>
<script>gsap.from("#bar", { xPercent: -150, duration: 0.6, ease: "k-out" });</script>`;

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("the graphics kit, rendered", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-kit-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function project(html: string): ProjectDoc {
    const doc0 = emptyProject("kit");
    const doc = {
      ...doc0,
      meta: { ...doc0.meta, format: { ...doc0.meta.format, width: 1080, height: 1920 } },
      look: { ...doc0.look, drift: false, grade: "none" },
      graphics: [...doc0.graphics, { id: "g", html }],
    };
    return applyOps(doc, [
      {
        op: "insert",
        coll: "sources",
        item: { id: "black", kind: "solid", label: "black", color: "#000000", duration: 0 } as never,
      },
      { op: "insert", coll: "scenes", item: { id: "s1", source: "black", in: 0, out: 3 } as never },
      {
        op: "insert",
        coll: "visuals",
        item: {
          id: "v1",
          anchor: { scene: "s1", at: 0 },
          duration: 3,
          layout: "full",
          content: { kind: "graphic", graphic: "g", params: {} },
        } as never,
      },
    ]).doc;
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

  const stills = (html: string, times: number[]) =>
    renderStills({
      doc: project(html),
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      times,
      resolve: async () => null,
      scale: 0.5,
      imageFormat: "png",
    });

  it("draws a plain graphic's split and fitted lines once they're in, and nothing before", async () => {
    const { images, errors } = await stills(PLAIN, [0, 1.5]);
    expect(errors).toEqual([]);
    const [start, settled] = images as [Buffer, Buffer];
    expect(brightest(start, 0, 300, 1080, 400)).toBeLessThan(60);
    expect(brightest(settled, 0, 300, 1080, 400)).toBeGreaterThan(200);
    expect(brightest(settled, 0, 1100, 1080, 300)).toBeGreaterThan(200);
    // Fitted, the long line stays inside the frame: nothing at the right edge.
    expect(brightest(settled, 1040, 1100, 40, 300)).toBeLessThan(60);
  }, 300_000);

  it("eases a scripted graphic with the kit's GSAP curve", async () => {
    const { images, errors } = await stills(SCRIPTED, [1.5]);
    expect(errors).toEqual([]);
    expect(brightest(images[0] as Buffer, 200, 400, 600, 160)).toBeGreaterThan(200);
  }, 300_000);
});
