// Ported from tiktok-studio's cli/beats.ts.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findBinary } from "./exec.ts";

// Beat tracking for music beds: tempo from the autocorrelation of an onset envelope, beats by dynamic programming
// (Ellis 2007), downbeats from where the kick lands, and the track's energy map (where it gets going, where it drops).

export type BeatMap = {
  durationMs: number;
  bpm: number | null;
  beats: number[];
  downbeats: number[];
  /** The first bar at full energy: where an edit should usually start the track. */
  startMs: number;
  /** The biggest lift in energy (the drop), if the track has one. */
  dropMs: number | null;
  /** How clearly the beat stands out, roughly 1 (no pulse) to 4+ (a clean kick). */
  pulse: number;
};

const SR = 22050;
const N = 1024;
const HOP = 512;
const FRAME_MS = (HOP / SR) * 1000;

const decode = async (file: string): Promise<Float32Array> => {
  const ffmpeg = await findBinary("ffmpeg");
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      "-v",
      "error",
      "-i",
      file,
      "-ac",
      "1",
      "-ar",
      String(SR),
      "-f",
      "f32le",
      "-",
    ]);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Could not decode ${path.basename(file)}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      // Copy: the concatenated buffer's offset is not guaranteed to be 4-byte aligned.
      resolve(
        new Float32Array(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + Math.floor(buf.byteLength / 4) * 4),
        ),
      );
    });
  });
};

/** In-place radix-2 FFT. */
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const xi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};

/** Spectral flux (all bands, and the kick band on its own) and loudness per frame. */
const features = (samples: Float32Array) => {
  const frames = Math.max(0, Math.floor((samples.length - N) / HOP));
  const window = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const bins = N / 2;
  const kickBins = Math.round((150 / SR) * N);
  const flux = new Float64Array(frames);
  const low = new Float64Array(frames);
  const rms = new Float64Array(frames);
  let prev = new Float64Array(bins);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const x = samples[f * HOP + i] ?? 0;
      energy += x * x;
      re[i] = x * (window[i] ?? 0);
      im[i] = 0;
    }
    rms[f] = Math.sqrt(energy / N);
    fft(re, im);
    const mag = new Float64Array(bins);
    let sum = 0;
    let sumLow = 0;
    for (let k = 1; k < bins; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k] ?? 0, im[k] ?? 0));
      mag[k] = m;
      const rise = m - (prev[k] ?? 0);
      if (rise > 0) {
        sum += rise;
        if (k <= kickBins) {
          sumLow += rise;
        }
      }
    }
    flux[f] = sum;
    low[f] = sumLow;
    prev = mag;
  }
  return { flux, low, rms };
};

/** Onsets above the local average, normalised, so a loud chorus doesn't swamp the pulse. */
const onsetEnvelope = (flux: Float64Array) => {
  const half = Math.round(250 / FRAME_MS);
  const out = new Float64Array(flux.length);
  let acc = 0;
  for (let i = 0; i < flux.length; i++) {
    acc += flux[i] ?? 0;
    if (i - 2 * half - 1 >= 0) {
      acc -= flux[i - 2 * half - 1] ?? 0;
    }
    const centre = i - half;
    if (centre >= 0) {
      const count = Math.min(i + 1, 2 * half + 1);
      out[centre] = Math.max(0, (flux[centre] ?? 0) - acc / count);
    }
  }
  let sq = 0;
  for (const v of out) {
    sq += v * v;
  }
  const std = Math.sqrt(sq / Math.max(1, out.length)) || 1;
  return out.map((v) => v / std);
};

/** The beat period in frames: autocorrelation weighted towards ~120 BPM, where most edit music sits. */
const beatPeriod = (onset: Float64Array): number | null => {
  const minLag = Math.floor(60_000 / 190 / FRAME_MS);
  const maxLag = Math.ceil(60_000 / 65 / FRAME_MS);
  const scores: number[] = [];
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    if (lag < minLag) {
      scores.push(0);
      continue;
    }
    let sum = 0;
    for (let i = lag; i < onset.length; i++) {
      sum += (onset[i] ?? 0) * (onset[i - lag] ?? 0);
    }
    const bpm = 60_000 / (lag * FRAME_MS);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    scores.push((sum / (onset.length - lag)) * prior);
  }
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if ((scores[lag] ?? 0) > (scores[best] ?? 0)) {
      best = lag;
    }
  }
  if ((scores[best] ?? 0) <= 0) {
    return null;
  }
  // Parabolic interpolation for a fractional period: a whole-frame error drifts a beat off within a minute.
  const a = scores[best - 1] ?? 0;
  const b = scores[best] ?? 0;
  const c = scores[best + 1] ?? 0;
  const denom = a - 2 * b + c;
  return denom < 0 ? best + (0.5 * (a - c)) / denom : best;
};

/** Beats that follow the onsets but stay close to the period (Ellis' dynamic programme). */
const trackBeats = (onset: Float64Array, period: number): number[] => {
  const tightness = 100;
  const score = new Float64Array(onset.length);
  const back = new Int32Array(onset.length).fill(-1);
  for (let t = 0; t < onset.length; t++) {
    let best = 0;
    let from = -1;
    for (let tau = Math.max(0, Math.round(t - 2 * period)); tau <= t - Math.round(period / 2); tau++) {
      const penalty = -tightness * Math.log((t - tau) / period) ** 2;
      const s = (score[tau] ?? 0) + penalty;
      if (from < 0 || s > best) {
        best = s;
        from = tau;
      }
    }
    score[t] = (onset[t] ?? 0) + (from >= 0 ? best : 0);
    back[t] = from;
  }
  let end = onset.length - 1;
  for (let t = Math.max(0, onset.length - Math.round(period)); t < onset.length; t++) {
    if ((score[t] ?? 0) > (score[end] ?? 0)) {
      end = t;
    }
  }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t] ?? -1) {
    beats.push(t);
  }
  return beats.reverse();
};

const analyze = async (file: string): Promise<BeatMap> => {
  const samples = await decode(file);
  const durationMs = (samples.length / SR) * 1000;
  const { flux, low, rms } = features(samples);
  const onset = onsetEnvelope(flux);
  const period = beatPeriod(onset);
  const loud = median(Array.from(rms));
  if (!period || onset.length < 200) {
    return { durationMs, bpm: null, beats: [], downbeats: [], startMs: 0, dropMs: null, pulse: 1 };
  }
  // Beats in a silent intro or tail are the tracker guessing.
  const frames = trackBeats(onset, period).filter((f) => (rms[f] ?? 0) > loud * 0.12);

  let atBeats = 0;
  for (const f of frames) {
    atBeats += Math.max(onset[f - 1] ?? 0, onset[f] ?? 0, onset[f + 1] ?? 0);
  }
  let total = 0;
  for (const v of onset) {
    total += v;
  }
  const pulse = frames.length > 0 ? atBeats / frames.length / Math.max(1e-6, total / onset.length) : 1;

  // Downbeats: the one of four phases where the kick band hits hardest.
  let phase = 0;
  let phaseScore = -1;
  for (let p = 0; p < 4; p++) {
    let sum = 0;
    for (let k = p; k < frames.length; k += 4) {
      const f = frames[k] ?? 0;
      sum += Math.max(low[f - 1] ?? 0, low[f] ?? 0, low[f + 1] ?? 0);
    }
    if (sum > phaseScore) {
      phaseScore = sum;
      phase = p;
    }
  }
  const downFrames = frames.filter((_, k) => k % 4 === phase);

  // Energy per bar: where the track is properly going, and where it lifts most.
  const barEnergy = downFrames.map((f, n) => {
    const to = downFrames[n + 1] ?? Math.min(rms.length, f + Math.round(period * 4));
    let sum = 0;
    for (let i = f; i < to; i++) {
      sum += (rms[i] ?? 0) ** 2;
    }
    return Math.sqrt(sum / Math.max(1, to - f));
  });
  const full = quantile(barEnergy, 0.75);
  const startBar = Math.max(
    0,
    barEnergy.findIndex((e) => e >= full * 0.7),
  );
  const mean = (from: number, to: number) => {
    const slice = barEnergy.slice(Math.max(0, from), Math.max(0, to));
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  };
  let dropBar: number | null = null;
  let lift = 1.3;
  for (let n = 4; n < barEnergy.length - 2; n++) {
    const ratio = mean(n, n + 2) / Math.max(1e-6, mean(n - 4, n));
    if (ratio > lift) {
      lift = ratio;
      dropBar = n;
    }
  }

  // A frame's flux rises when the hit reaches the middle of its window.
  const ms = (f: number) => Math.round(f * FRAME_MS + (N / 2 / SR) * 1000);
  return {
    durationMs: Math.round(durationMs),
    bpm: Math.round((60_000 / (period * FRAME_MS)) * 10) / 10,
    beats: frames.map(ms),
    downbeats: downFrames.map(ms),
    startMs: ms(downFrames[startBar] ?? downFrames[0] ?? 0),
    dropMs: dropBar !== null ? ms(downFrames[dropBar] ?? 0) : null,
    pulse: Math.round(pulse * 100) / 100,
  };
};

/** The beat map for an audio file, cached by its path and modification time. */
export const beatMap = async (file: string, cacheDir: string): Promise<BeatMap> => {
  const key = createHash("sha1")
    .update(`${path.resolve(file)}|${statSync(file).mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
  const cached = path.join(cacheDir, "beats-v2", `${key}.json`);
  if (existsSync(cached)) {
    return JSON.parse(readFileSync(cached, "utf8")) as BeatMap;
  }
  const map = await analyze(file);
  mkdirSync(path.dirname(cached), { recursive: true });
  writeFileSync(cached, JSON.stringify(map));
  return map;
};
