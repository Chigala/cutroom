/**
 * A clip process_media keyed (a green screen made see-through), drawn over a shot by the renderer: the
 * shot shows where the green was. Slow (a browser, a bundle), so only with VEDIT_RENDER_TESTS=1; run it on
 * each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/process.render.test.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProcessed, probe, renderableAsIs } from "@vedit/media";
import { applyOps, emptyProject } from "@vedit/project";
import { afterAll, describe, expect, it } from "vitest";
import { renderStills } from "./stills.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("a keyed clip, rendered", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-keyed-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("shows the shot under it where the green was", async () => {
    const green = path.join(dir, "green.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x00FF00:s=1080x1920:d=3:r=30,drawbox=x=340:y=760:w=400:h=400:c=red:t=fill",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      green,
    ]);
    const keyed = await makeProcessed({
      inputs: [{ path: green, kind: "video" }],
      graph: "[0:v]chromakey=0x00FF00:0.2:0.05,format=yuva420p[v]",
      kind: "video",
      alpha: true,
      dir,
    });
    expect(await renderableAsIs(keyed)).toBe(true);
    const p = await probe(keyed);
    const doc0 = emptyProject("keyed");
    const doc = applyOps({ ...doc0, look: { ...doc0.look, drift: false, grade: "none" } }, [
      {
        op: "insert",
        coll: "sources",
        item: { id: "blue", kind: "solid", label: "blue", color: "#2040ff", duration: 0 } as never,
      },
      {
        op: "insert",
        coll: "sources",
        item: { ...p, id: "keyed", label: "keyed", status: "ready" } as never,
      },
      { op: "insert", coll: "scenes", item: { id: "s1", source: "blue", in: 0, out: 3 } as never },
      {
        op: "insert",
        coll: "visuals",
        item: {
          id: "v1",
          anchor: { scene: "s1", at: 0 },
          duration: 3,
          layout: "overlay",
          content: { kind: "cutaway", source: "keyed", in: 0, settle: 1 },
        } as never,
      },
    ]).doc;
    const { images, errors } = await renderStills({
      doc,
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      times: [1.5],
      resolve: async (key) => (key === "keyed" ? keyed : null),
      scale: 0.5,
      imageFormat: "png",
    });
    expect(errors).toEqual([]);
    const at = (x: number, y: number) => [
      ...execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          "pipe:0",
          "-vf",
          `crop=1:1:${x}:${y}`,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { input: images[0] },
      ),
    ];
    const [r, g] = at(270, 480);
    // The red box, in the middle.
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    // The blue shot where the green was: no green left, and not black.
    const corner = at(40, 80);
    expect(corner[2]).toBeGreaterThan(200);
    expect(corner[1]).toBeLessThan(110);
  }, 300_000);
});
