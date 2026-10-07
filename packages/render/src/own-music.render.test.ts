/**
 * A clip's own music taken out, through a real export: the dialogue is the clip's voice part, and the
 * music part plays at the shot's share. The parts are put where the separator leaves them (a low tone
 * for the voice, a high one for the music), so this checks the plumbing, not the model. Slow (a browser,
 * a bundle, a render), so only with VEDIT_RENDER_TESTS=1; run it on each platform the app ships on:
 *
 *   VEDIT_RENDER_TESTS=1 pnpm vitest run packages/render/src/own-music.render.test.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivedPaths, STEMS_MODEL } from "@vedit/media";
import { applyOps, emptyProject, type ProjectDoc } from "@vedit/project";
import { afterAll, describe, expect, it } from "vitest";
import { exportVideo } from "./export.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** RMS level (dB) of one narrow band of a file between two times (astats reports on stderr): narrow, so
 * the voice's tone doesn't read as music. */
function rms(file: string, from: number, to: number, freq: number): number {
  const { stderr } = spawnSync(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      file,
      "-af",
      `atrim=start=${from}:end=${to},bandpass=f=${freq}:width_type=q:w=30,astats=measure_perchannel=none`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(stderr);
  return m ? (m[1] === "-inf" ? -120 : Number(m[1])) : Number.NaN;
}

const tone = (file: string, freq: number, seconds: number) =>
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=f=${freq}:d=${seconds}:r=44100`,
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    file,
  ]);

describe.skipIf(!process.env.VEDIT_RENDER_TESTS)("a clip's own music, exported", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-own-music-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // The clip: 4s of picture, its sound a low tone (the voice) and a high one (the music) together.
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
    "-f",
    "lavfi",
    "-i",
    "sine=f=1500:d=4:r=48000",
    "-filter_complex",
    "[1][2]amix=inputs=2:normalize=0[a]",
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    clip,
  ]);
  // Its two parts, where the separator would leave them.
  const parts = derivedPaths(dir);
  mkdirSync(path.dirname(parts.stem("clip", "voice")), { recursive: true });
  tone(parts.stem("clip", "voice"), 300, 4);
  tone(parts.stem("clip", "music"), 1500, 4);

  function project(ownMusic: number): ProjectDoc {
    const doc0 = emptyProject("own music");
    return applyOps(
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
          coll: "scenes",
          item: { id: "s1", source: "clip", in: 0, out: 4, ownMusic } as never,
        },
        { op: "insert", coll: "analyses", item: { id: "clip", silences: [], stems: STEMS_MODEL } as never },
      ],
    ).doc;
  }

  const exported = (doc: ProjectDoc) =>
    exportVideo({
      doc,
      projectDir: dir,
      entry: { kind: "source", path: path.join(here, "entry.tsx"), outDir: path.join(dir, "bundle") },
      cacheDir: path.join(dir, "cache"),
    });

  it("leaves the voice and takes the music out", async () => {
    const out = await exported(project(0));
    const voice = rms(out, 0.5, 3.5, 300);
    expect(voice).toBeGreaterThan(-30);
    expect(rms(out, 0.5, 3.5, 1500)).toBeLessThan(voice - 30);
  }, 600_000);

  it("keeps the share of the music asked for", async () => {
    const out = await exported(project(0.5));
    const voice = rms(out, 0.5, 3.5, 300);
    const music = rms(out, 0.5, 3.5, 1500);
    expect(music).toBeGreaterThan(voice - 20);
    expect(music).toBeLessThan(voice);
  }, 600_000);
});
