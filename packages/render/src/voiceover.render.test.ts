/**
 * A voiceover through a real export: the exported file has the recording where it's placed and the
 * shot's own sound stepped back under it. Slow (a browser, a bundle, a render), so only with
 * VEDIT_RENDER_TESTS=1; run it on each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/voiceover.render.test.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOps, emptyProject } from "@vedit/project";
import { afterAll, describe, expect, it } from "vitest";
import { exportVideo } from "./export.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** RMS level (dB) of one band of a file between two times (astats reports on stderr). */
function rms(file: string, from: number, to: number, freq: number): number {
  const { stderr } = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      file,
      "-af",
      `atrim=start=${from}:end=${to},bandpass=f=${freq}:width_type=q:w=4,astats=measure_perchannel=none`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(stderr);
  return m ? (m[1] === "-inf" ? -120 : Number(m[1])) : Number.NaN;
}

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("a voiceover, exported", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-voiceover-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is heard where it's placed, the shot's sound stepping back under it", async () => {
    // The shot: 4s of picture with a low tone. The recording: a high tone.
    const clip = path.join(dir, "clip.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=540x960:r=30:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=f=300:d=4:r=48000",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      clip,
    ]);
    const take = path.join(dir, "take.wav");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=f=1500:d=3:r=48000",
      "-ac",
      "1",
      take,
    ]);
    const doc0 = emptyProject("voiceover");
    const doc = applyOps(
      {
        ...doc0,
        meta: { ...doc0.meta, format: { width: 540, height: 960, fps: 30 } },
        look: { ...doc0.look, drift: false, grade: "none" },
        // The plain mix, so levels can be read: no compression, denoising or room tone.
        mix: { ...doc0.mix, voiceEnhance: false, denoise: false, voiceClean: "off", roomTone: 0 },
        exportSettings: { ...doc0.exportSettings, formats: [], cover: false },
      },
      [
        {
          op: "insert",
          coll: "sources",
          item: {
            id: "clip",
            kind: "video",
            label: "clip",
            path: clip,
            duration: 4,
            width: 540,
            height: 960,
            fps: 30,
            hasAudio: true,
          } as never,
        },
        {
          op: "insert",
          coll: "sources",
          item: {
            id: "take",
            kind: "audio",
            label: "take",
            path: take,
            duration: 3,
            hasAudio: true,
          } as never,
        },
        { op: "insert", coll: "scenes", item: { id: "s1", source: "clip", in: 0, out: 4 } as never },
        // Its 0.5-2s, laid at 1.5s.
        {
          op: "insert",
          coll: "voiceovers",
          item: {
            id: "v1",
            anchor: { scene: "s1", at: 1.5 },
            duration: 1.5,
            source: "take",
            offset: 0.5,
            duck: 0.2,
          } as never,
        },
      ],
    ).doc;
    const out = await exportVideo({
      doc,
      projectDir: dir,
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      cacheDir: path.join(dir, "cache"),
    });
    const before = rms(out, 0.3, 1.0, 300);
    // The shot's sound steps back under the voiceover (by its duck, -14 dB) and returns after.
    expect(rms(out, 1.9, 2.7, 300) - before).toBeLessThan(-10);
    expect(Math.abs(rms(out, 3.3, 3.9, 300) - before)).toBeLessThan(2);
    // The voiceover only where it's placed.
    const speaking = rms(out, 1.9, 2.7, 1500);
    expect(speaking).toBeGreaterThan(before - 6);
    expect(rms(out, 0.3, 1.0, 1500)).toBeLessThan(speaking - 20);
    expect(rms(out, 3.3, 3.9, 1500)).toBeLessThan(speaking - 20);
  }, 600_000);
});
