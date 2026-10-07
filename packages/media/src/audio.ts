import { mkdir, readFile, writeFile } from "node:fs/promises";
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

/**
 * A speech wav cut down to where someone talks: its stretches end to end, half a second of silence
 * between them (so a phrase isn't run into the next), for the transcriber to hear only speech. Each
 * piece says where it came from, to put the words back in the clip's time (fromSpeechCut).
 */
export interface SpeechCut {
  readonly pieces: readonly { readonly from: number; readonly at: number; readonly length: number }[];
}

const CUT_GAP = 0.5;

export async function cutToSpeech(
  wav: string,
  spans: readonly (readonly [number, number])[],
  output: string,
): Promise<SpeechCut> {
  const buf = await readFile(wav);
  // A 16-bit PCM wav (extractSpeechWav's): its rate and channels from the header, samples after "data".
  const rate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const data = buf.indexOf("data", 12, "ascii");
  const start = data < 0 ? 44 : data + 8;
  const frame = 2 * channels;
  const total = Math.floor((buf.length - start) / frame);
  const gap = Math.round(CUT_GAP * rate);
  const parts: Buffer[] = [];
  const pieces: { from: number; at: number; length: number }[] = [];
  let at = 0;
  for (const [a, b] of spans) {
    const from = Math.max(0, Math.min(total, Math.round(a * rate)));
    const to = Math.max(from, Math.min(total, Math.round(b * rate)));
    if (to <= from) continue;
    if (pieces.length) {
      parts.push(Buffer.alloc(gap * frame));
      at += gap;
    }
    parts.push(buf.subarray(start + from * frame, start + to * frame));
    pieces.push({ from: from / rate, at: at / rate, length: (to - from) / rate });
    at += to - from;
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + body.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * frame, 28);
  header.writeUInt16LE(frame, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(body.length, 40);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.concat([header, body]));
  return { pieces };
}

/** Words heard in a speech cut, back in the clip's own time (a word in a gap belongs to the piece before). */
export function fromSpeechCut<W extends { start: number; end: number }>(
  words: readonly W[],
  cut: SpeechCut,
): W[] {
  return words.flatMap((w) => {
    const piece = cut.pieces.findLast((p) => p.at <= w.start + 0.01) ?? cut.pieces[0];
    if (!piece) return [];
    const shift = piece.from - piece.at;
    const last = piece.from + piece.length;
    const start = Math.min(last, Math.max(piece.from, w.start + shift));
    const end = Math.min(last, Math.max(start, w.end + shift));
    return [{ ...w, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }];
  });
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
