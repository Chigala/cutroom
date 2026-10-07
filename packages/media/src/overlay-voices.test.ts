import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { probe } from "./probe.ts";
import { overlayVoices } from "./voice.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-overlay-voices-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tone = (name: string, freq: number, seconds: number) => {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=f=${freq}:d=${seconds}:r=48000`,
    "-af",
    "volume=0.5",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    file,
  ]);
  return file;
};

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

describe("voiceovers in the export's voice mix", () => {
  it("lay the recording at its moment and the dialogue steps back under it", async () => {
    // The dialogue: a low tone for 3s. The voiceover: a high one, its 0.5-1.5s laid at 1s.
    const dialogue = tone("dialogue.wav", 300, 3);
    const voice = tone("voice.wav", 1500, 2);
    const out = path.join(dir, "mixed.wav");
    await overlayVoices(
      dialogue,
      [{ file: voice, start: 0.5, duration: 1, at: 1, volume: 1, duck: 0.2 }],
      out,
    );
    expect((await probe(out)).duration).toBeCloseTo(3, 1);
    // The dialogue: full before, at a fifth (-14 dB) under the voiceover, full again after.
    const before = rms(out, 0.2, 0.6, 300);
    expect(rms(out, 1.4, 1.8, 300) - before).toBeCloseTo(-14, 0);
    expect(rms(out, 2.5, 2.9, 300) - before).toBeCloseTo(0, 0);
    // The voiceover only where it's placed (elsewhere, all its band holds is the dialogue's edge).
    const speaking = rms(out, 1.4, 1.8, 1500);
    expect(speaking).toBeGreaterThan(before - 3);
    expect(rms(out, 0.2, 0.6, 1500)).toBeLessThan(speaking - 20);
    expect(rms(out, 2.5, 2.9, 1500)).toBeLessThan(speaking - 20);
  });
});
