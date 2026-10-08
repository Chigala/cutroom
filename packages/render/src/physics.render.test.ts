/**
 * Physics in a scripted graphic (Matter.js through graphic.physics), as the renderer draws it: a box
 * falls onto a floor, and any frame comes out the same however the frames are asked for. Slow (a
 * browser, a bundle), so only with VEDIT_RENDER_TESTS=1; run it on each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/physics.render.test.ts
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

/** A white box (a fifth of the width) dropped from the top onto a floor at 80% of the height. */
const FALL = `<!-- graphic {"name":"Fall","description":"A box falls onto a floor","duration":3,"libs":["matter"]} -->
<style>.box { position: absolute; left: 0; top: 0; background: #fff; }</style>
<div class="box" id="box"></div>
<script>
  graphic.physics((Matter, engine, f) => {
    const size = f.width * 0.2;
    const el = document.getElementById("box");
    el.style.width = el.style.height = size + "px";
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(f.width / 2, size, size, size, { plugin: { el } }),
      Matter.Bodies.rectangle(f.width / 2, f.height * 0.8 + 50, f.width * 2, 100, { isStatic: true }),
    ]);
  });
</script>`;

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("physics, rendered", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-physics-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function project(): ProjectDoc {
    const doc0 = emptyProject("physics");
    const doc = {
      ...doc0,
      meta: { ...doc0.meta, format: { ...doc0.meta.format, width: 1080, height: 1920 } },
      look: { ...doc0.look, drift: false, grade: "none" },
      graphics: [...doc0.graphics, { id: "fall", html: FALL }],
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
          layout: "overlay",
          content: { kind: "graphic", graphic: "fall", params: {} },
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

  it("falls onto the floor, and a frame asked for again after a later one is the same", async () => {
    const { images, errors } = await renderStills({
      doc: project(),
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      // Early (once the visual has faded in), late, then early again: the world is built again from the start.
      times: [0.6, 2.5, 0.6],
      resolve: async () => null,
      scale: 0.5,
      imageFormat: "png",
    });
    expect(errors).toEqual([]);
    const [early, late, again] = images as [Buffer, Buffer, Buffer];
    // Early, the box is still high up (it starts 108-324px down and has fallen a little)...
    expect(brightest(early, 440, 100, 200, 600)).toBeGreaterThan(200);
    expect(brightest(early, 0, 1100, 1080, 436)).toBeLessThan(40);
    // ...and later it rests on the floor (its bottom at 1536, so it spans 1320-1536).
    expect(brightest(late, 440, 1340, 200, 180)).toBeGreaterThan(200);
    expect(brightest(late, 0, 0, 1080, 1200)).toBeLessThan(40);
    expect(again.equals(early)).toBe(true);
  }, 300_000);
});
