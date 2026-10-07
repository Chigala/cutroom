/**
 * A clip's sound split in two: the voice, and everything else (the music under a downloaded or reposted
 * video). The voice comes from HT-Demucs fine-tuned for vocals (MIT), run on this computer through ONNX
 * Runtime; the rest is the clip minus the voice, so the two always add back up to the clip as recorded.
 *
 * The model takes 7.8 s at a time. The clip streams through in windows that overlap by a quarter and
 * cross-fade, so a long recording never sits in memory and no seam is heard.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { CancelledError, findBinary } from "./exec.ts";
import { ONNX_PLATFORMS, onnx, session } from "./models.ts";

/** Recorded with a clip's parts (analysis.stems): a better model makes them again. */
export const STEMS_MODEL = "htdemucs-ft-vocals-fp16";

export const STEM_RATE = 44_100;
/** The model's fixed input: 7.8 s of stereo. */
export const STEM_WINDOW = 343_980;
const OVERLAP = Math.floor(STEM_WINDOW / 4);
const STRIDE = STEM_WINDOW - OVERLAP;

/** Whether this computer can separate a voice (ONNX Runtime has no build for Intel Macs). */
export const canSeparate = () => ONNX_PLATFORMS.includes(`${process.platform}-${process.arch}`);

/** The voice in one window: left then right channel (planar), STEM_WINDOW samples each, in and out. */
export type VoiceModel = (mix: Float32Array) => Promise<Float32Array>;

/** The model on ONNX Runtime: its four stems come back, the voice is the last. */
async function demucs(): Promise<VoiceModel> {
  const [ort, s] = await Promise.all([onnx(), session("voices")]);
  return async (mix) => {
    const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor("float32", mix, [1, 2, STEM_WINDOW]) });
    const stems = out[s.outputNames[0]!]!.data as Float32Array;
    return stems.slice(3 * 2 * STEM_WINDOW, 4 * 2 * STEM_WINDOW);
  };
}

export interface SeparateOptions {
  readonly signal?: AbortSignal;
  /** The clip's length (s), for progress. */
  readonly duration?: number;
  readonly onProgress?: (fraction: number) => void;
  /** The model; the real one unless a test gives its own. */
  readonly model?: VoiceModel;
}

/** An ffmpeg that turns interleaved stereo floats on its stdin into a WAV. */
async function wavWriter(file: string) {
  const child = spawn(
    await findBinary("ffmpeg"),
    [
      "-v",
      "error",
      "-y",
      "-f",
      "f32le",
      "-ar",
      String(STEM_RATE),
      "-ac",
      "2",
      "-i",
      "-",
      "-c:a",
      "pcm_s16le",
      file,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let err = "";
  child.stderr?.on("data", (d: Buffer) => {
    err += d;
  });
  const closed = once(child, "close") as Promise<[number | null]>;
  const stdin = child.stdin as Writable;
  return {
    async write(samples: Float32Array) {
      if (!stdin.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)))
        await once(stdin, "drain");
    },
    async end() {
      stdin.end();
      const [code] = await closed;
      if (code !== 0)
        throw new Error(`ffmpeg couldn't write ${path.basename(file)}: ${err.trim().slice(-300)}`);
    },
    kill: () => child.kill("SIGKILL"),
  };
}

/**
 * Splits `input`'s sound into `voice` and `music` (WAVs, 44.1 kHz stereo): the voice as the model hears
 * it, the music the clip minus the voice. Each file appears only when it's whole.
 */
export async function separateVoice(
  input: string,
  out: { readonly voice: string; readonly music: string },
  o: SeparateOptions = {},
): Promise<void> {
  if (!o.model && !canSeparate())
    throw new Error("Taking music out of a clip isn't available on this computer.");
  const model = o.model ?? (await demucs());
  await mkdir(path.dirname(out.voice), { recursive: true });
  await mkdir(path.dirname(out.music), { recursive: true });
  const part = (f: string) => `${f}.part.wav`;
  const decoder = spawn(
    await findBinary("ffmpeg"),
    ["-v", "error", "-i", input, "-vn", "-ac", "2", "-ar", String(STEM_RATE), "-f", "f32le", "-"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const voiceOut = await wavWriter(part(out.voice));
  const musicOut = await wavWriter(part(out.music));
  const stop = () => {
    decoder.kill("SIGKILL");
    voiceOut.kill();
    musicOut.kill();
  };
  o.signal?.addEventListener("abort", stop, { once: true });

  // The clip as it streams in (interleaved stereo), from sample `held` on.
  let buf = new Float32Array(0);
  let held = 0;
  let ended = false;
  let tail = new Uint8Array(0);
  const reader = (decoder.stdout as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  /** Reads until the clip is known up to sample `upTo`, or has ended. */
  const fill = async (upTo: number) => {
    while (!ended && held + buf.length / 2 < upTo) {
      const next = await reader.next();
      if (next.done) {
        ended = true;
        break;
      }
      const bytes = new Uint8Array(tail.length + next.value.length);
      bytes.set(tail);
      bytes.set(next.value, tail.length);
      const whole = bytes.length - (bytes.length % 8);
      tail = bytes.slice(whole);
      const more = new Float32Array(bytes.buffer.slice(0, whole));
      const grown = new Float32Array(buf.length + more.length);
      grown.set(buf);
      grown.set(more, buf.length);
      buf = grown;
    }
  };

  // The voice so far over the current window, and how much of the cross-fade each sample has had.
  let acc = new Float32Array(2 * STEM_WINDOW);
  let weight = new Float32Array(STEM_WINDOW);
  const fade = new Float32Array(STEM_WINDOW).fill(1);
  for (let i = 0; i < OVERLAP; i++) fade[i] = fade[STEM_WINDOW - 1 - i] = (i + 1) / (OVERLAP + 1);
  const total = o.duration ? o.duration * STEM_RATE : 0;

  try {
    for (let start = 0; ; start += STRIDE) {
      if (o.signal?.aborted) throw new CancelledError();
      await fill(start + STEM_WINDOW);
      const known = held + buf.length / 2;
      if (start >= known && start > 0) break;
      const len = Math.min(STEM_WINDOW, known - start);
      const first = start === 0;
      const last = ended && start + STRIDE >= known;
      // The window, planar, zero past the clip's end.
      const mix = new Float32Array(2 * STEM_WINDOW);
      const at = (start - held) * 2;
      for (let i = 0; i < len; i++) {
        mix[i] = buf[at + i * 2]!;
        mix[STEM_WINDOW + i] = buf[at + i * 2 + 1]!;
      }
      const voice = await model(mix);
      for (let i = 0; i < len; i++) {
        // The clip's own ends don't fade: nothing overlaps them.
        const w = (first && i < OVERLAP) || (last && i >= STRIDE) ? 1 : fade[i]!;
        acc[i * 2] = acc[i * 2]! + voice[i]! * w;
        acc[i * 2 + 1] = acc[i * 2 + 1]! + voice[STEM_WINDOW + i]! * w;
        weight[i] = weight[i]! + w;
      }
      // Up to the next window's start nothing more is coming: write it out.
      const done = last ? len : Math.min(STRIDE, len);
      const v = new Float32Array(done * 2);
      const m = new Float32Array(done * 2);
      for (let i = 0; i < done; i++) {
        const k = Math.max(weight[i]!, 1e-8);
        for (let c = 0; c < 2; c++) {
          v[i * 2 + c] = acc[i * 2 + c]! / k;
          m[i * 2 + c] = buf[at + i * 2 + c]! - v[i * 2 + c]!;
        }
      }
      await Promise.all([voiceOut.write(v), musicOut.write(m)]);
      if (total) o.onProgress?.(Math.min(1, (start + done) / total));
      if (last) break;
      // Slide on: what's held for the overlap moves to the front.
      const nextAcc = new Float32Array(2 * STEM_WINDOW);
      nextAcc.set(acc.subarray(STRIDE * 2));
      acc = nextAcc;
      const nextWeight = new Float32Array(STEM_WINDOW);
      nextWeight.set(weight.subarray(STRIDE));
      weight = nextWeight;
      buf = buf.slice((start + STRIDE - held) * 2);
      held = start + STRIDE;
    }
    await Promise.all([voiceOut.end(), musicOut.end()]);
    if (o.signal?.aborted) throw new CancelledError();
    await rename(part(out.voice), out.voice);
    await rename(part(out.music), out.music);
    o.onProgress?.(1);
  } catch (err) {
    stop();
    await Promise.all([rm(part(out.voice), { force: true }), rm(part(out.music), { force: true })]);
    throw o.signal?.aborted ? new CancelledError() : err;
  } finally {
    o.signal?.removeEventListener("abort", stop);
  }
}
