import { mkdir } from "node:fs/promises";
import path from "node:path";
import { run } from "./exec.ts";

/** 16 kHz mono PCM: what whisper.cpp wants. All of it, or the stretch [from, to) in seconds. */
export async function extractSpeechWav(
  input: string,
  output: string,
  signal?: AbortSignal,
  range?: { from: number; to: number },
): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  const seek = range ? ["-ss", String(range.from), "-t", String(Math.max(0.1, range.to - range.from))] : [];
  await run(
    "ffmpeg",
    ["-y", ...seek, "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output],
    signal ? { signal } : {},
  );
}

/** Quiet stretches, as [start, end] pairs in seconds. */
export async function detectSilences(
  input: string,
  {
    noiseDb = -35,
    minDuration = 0.35,
    signal,
  }: { noiseDb?: number; minDuration?: number; signal?: AbortSignal } = {},
): Promise<[number, number][]> {
  const { stderr } = await run(
    "ffmpeg",
    ["-i", input, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minDuration}`, "-f", "null", "-"],
    signal ? { signal } : {},
  );
  const out: [number, number][] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push([round(start), round(Number(e[1]))]);
      start = null;
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export { PEAKS_PER_SECOND } from "@vedit/project";

import { PEAKS_PER_SECOND } from "@vedit/project";

/**
 * Loudness envelope for drawing waveforms: one byte per 20 ms (0-255, perceptual scale). A ten minute
 * clip is 30 KB, cheap enough to ship to the timeline whole.
 */
export async function waveformPeaks(input: string, signal?: AbortSignal): Promise<Uint8Array> {
  const rate = 8000;
  const { stdoutBuffer } = await run(
    "ffmpeg",
    ["-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"],
    { binary: true, ...(signal && { signal }) },
  );
  const samples = new Int16Array(
    stdoutBuffer.buffer,
    stdoutBuffer.byteOffset,
    Math.floor(stdoutBuffer.byteLength / 2),
  );
  const per = rate / PEAKS_PER_SECOND;
  const peaks = new Uint8Array(Math.ceil(samples.length / per));
  for (let i = 0; i < peaks.length; i++) {
    let max = 0;
    const end = Math.min(samples.length, (i + 1) * per);
    for (let j = i * per; j < end; j++) {
      const v = Math.abs(samples[j]!);
      if (v > max) max = v;
    }
    // Square-root scale reads closer to how loud things sound than a linear one.
    peaks[i] = Math.round(Math.sqrt(max / 32768) * 255);
  }
  return peaks;
}

/** Integrated loudness in LUFS (EBU R128). */
export async function measureLoudness(input: string, signal?: AbortSignal): Promise<number | null> {
  const { stderr } = await run(
    "ffmpeg",
    ["-i", input, "-vn", "-af", "ebur128", "-f", "null", "-"],
    signal ? { signal } : {},
  );
  const m =
    /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(stderr) ??
    /I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf("Summary")));
  return m ? Number(m[1]) : null;
}

/**
 * How loud the voice is, 100 times a second, in dB: only the voice's band (120 Hz to 4 kHz), so room hum,
 * a fan or traffic don't read as speech. What alignToOnsets uses to find where words really start.
 */
export async function voiceEnvelope(input: string, signal?: AbortSignal): Promise<Float32Array> {
  const rate = 16000;
  const { stdoutBuffer } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-af",
      "highpass=f=120,lowpass=f=4000",
      "-f",
      "s16le",
      "-",
    ],
    { binary: true, ...(signal && { signal }) },
  );
  const samples = new Int16Array(
    stdoutBuffer.buffer,
    stdoutBuffer.byteOffset,
    Math.floor(stdoutBuffer.byteLength / 2),
  );
  const per = rate / 100;
  const out = new Float32Array(Math.floor(samples.length / per));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = i * per; j < (i + 1) * per; j++) sum += samples[j]! * samples[j]!;
    out[i] = 10 * Math.log10(sum / per + 1);
  }
  return out;
}
