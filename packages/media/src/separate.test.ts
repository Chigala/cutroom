import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { STEM_RATE, STEM_WINDOW, separateVoice, type VoiceModel } from "./separate.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-separate-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A clip: a low tone left, a higher one right, `seconds` long (as a WAV, like a clip's sound). */
function clip(name: string, seconds: number): string {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=f=220:d=${seconds}:r=${STEM_RATE}`,
    "-f",
    "lavfi",
    "-i",
    `sine=f=330:d=${seconds}:r=${STEM_RATE}`,
    "-filter_complex",
    "[0][1]join=inputs=2:channel_layout=stereo,volume=0.5",
    "-c:a",
    "pcm_f32le",
    file,
  ]);
  return file;
}

/** A file's sound as interleaved stereo floats. */
const samples = (file: string) => {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-"], {
    maxBuffer: 1 << 28,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};

/** A stand-in model: the "voice" is 30% of whatever it's given. */
const fake: VoiceModel = async (mix) => mix.map((x) => x * 0.3);

describe("separating a clip's voice", () => {
  for (const seconds of [3, (2 * 343_980 - 85_995) / STEM_RATE, 21.3]) {
    it(`streams a ${seconds.toFixed(1)}s clip through overlapping windows without a seam`, async () => {
      const input = clip(`clip-${seconds}.wav`, seconds);
      const out = { voice: path.join(dir, `v-${seconds}.wav`), music: path.join(dir, `m-${seconds}.wav`) };
      let progress = 0;
      await separateVoice(input, out, { model: fake, duration: seconds, onProgress: (f) => (progress = f) });
      const mix = samples(input);
      const voice = samples(out.voice);
      const music = samples(out.music);
      expect(voice.length).toBe(mix.length);
      expect(music.length).toBe(mix.length);
      // The voice is the model's, everywhere, seams and both ends included (16-bit WAV: within 1e-3).
      let worst = 0;
      let sum = 0;
      for (let i = 0; i < mix.length; i++) {
        worst = Math.max(worst, Math.abs(voice[i]! - mix[i]! * 0.3));
        sum = Math.max(sum, Math.abs(voice[i]! + music[i]! - mix[i]!));
      }
      expect(worst).toBeLessThan(1e-3);
      // The two add back up to the clip as recorded.
      expect(sum).toBeLessThan(2e-3);
      expect(progress).toBe(1);
      expect(readdirSync(dir).some((f) => f.includes(".part."))).toBe(false);
    });
  }

  it("leaves nothing half made when it's stopped", async () => {
    const input = clip("long.wav", 30);
    const out = { voice: path.join(dir, "stopped-v.wav"), music: path.join(dir, "stopped-m.wav") };
    const stop = new AbortController();
    const slow: VoiceModel = async (mix) => {
      stop.abort();
      return mix;
    };
    await expect(separateVoice(input, out, { model: slow, signal: stop.signal })).rejects.toThrow(
      /Cancelled/,
    );
    expect(existsSync(out.voice) || existsSync(out.music)).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith("stopped"))).toBe(false);
  });

  it("feeds the model whole windows, the clip's end padded with silence", async () => {
    const input = clip("short.wav", 2);
    const sizes: number[] = [];
    const tail: number[] = [];
    const watch: VoiceModel = async (mix) => {
      sizes.push(mix.length);
      tail.push(Math.max(...mix.subarray(STEM_WINDOW - 100, STEM_WINDOW).map(Math.abs)));
      return mix;
    };
    await separateVoice(
      input,
      { voice: path.join(dir, "w-v.wav"), music: path.join(dir, "w-m.wav") },
      { model: watch },
    );
    expect(sizes).toEqual([2 * STEM_WINDOW]);
    expect(tail[0]).toBe(0);
    expect(readFileSync(path.join(dir, "w-v.wav")).length).toBeGreaterThan(1000);
  });
});
