/**
 * The picture side of indexing: a clip cut into short segments (at its shot changes, and every few
 * seconds within a long shot), and contact sheets of those segments for a vision model to describe.
 * A sheet holds several segments, three frames each, so one model call covers many shots.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./exec.ts";
import { grabFrame } from "./transcode.ts";

export interface Segment {
  readonly start: number;
  readonly end: number;
}

/**
 * Segments from shot changes: each shot, split evenly when it's longer than `maxLength` (a long wide
 * shot that ends in an explosion shouldn't be one description). Slivers merge into their neighbour.
 * At most `cap` segments: very long footage gets longer segments.
 */
export function segmentsOf(duration: number, cuts: readonly number[], maxLength = 6, cap = 900): Segment[] {
  const bounds = [0, ...cuts.filter((t) => t > 0.3 && t < duration - 0.3).sort((a, b) => a - b), duration];
  const length = Math.max(maxLength, duration / cap);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]!;
    const b = bounds[i + 1]!;
    const n = Math.max(1, Math.ceil((b - a) / length));
    for (let k = 0; k < n; k++)
      out.push({ start: a + ((b - a) * k) / n, end: k === n - 1 ? b : a + ((b - a) * (k + 1)) / n });
  }
  const merged: Segment[] = [];
  for (const s of out) {
    const last = merged.at(-1);
    if (last && s.end - s.start < 0.5) merged[merged.length - 1] = { start: last.start, end: s.end };
    else merged.push(s);
  }
  return merged;
}

/** The three moments shown for a segment: just in, the middle, just before it ends. */
export const framesOf = (s: Segment): number[] => {
  const len = s.end - s.start;
  return [s.start + Math.min(0.15, len * 0.1), s.start + len / 2, s.end - Math.min(0.15, len * 0.1)];
};

export interface SheetOptions {
  /** Segments per sheet. */
  readonly perSheet?: number;
  /** Frame width in pixels (landscape); portrait frames are made narrower so sheets stay square-ish. */
  readonly width?: number;
  readonly portrait?: boolean;
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

/**
 * Contact sheets for `segments` of `video`: JPEGs whose tiles read left to right, top to bottom, every
 * three consecutive tiles one segment (start, middle, end).
 */
export async function contactSheets(
  video: string,
  segments: readonly Segment[],
  o: SheetOptions = {},
): Promise<Buffer[]> {
  const per = o.perSheet ?? 8;
  const width = o.portrait ? 144 : (o.width ?? 256);
  const columns = o.portrait ? 6 : 3;
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-sheets-"));
  try {
    // Every frame, a few at a time (each is a fast keyframe seek into the preview copy).
    const times = segments.flatMap(framesOf);
    const files: string[] = new Array(times.length);
    let next = 0;
    let done = 0;
    let failed = false;
    const worker = async () => {
      while (next < times.length && !failed) {
        const i = next++;
        const file = path.join(dir, `${String(i).padStart(6, "0")}.jpg`);
        await writeFile(file, await grabFrame(video, times[i]!, width, o.signal));
        files[i] = file;
        o.onProgress?.((++done / times.length) * 0.9);
      }
    };
    // One frame failing stops the rest, and they all finish before the folder is removed (one still
    // writing into it would fail the removal, and that error would hide this one).
    const ended = await Promise.allSettled(
      Array.from({ length: o.concurrency ?? 6 }, () =>
        worker().catch((err: unknown) => {
          failed = true;
          throw err;
        }),
      ),
    );
    const failure = ended.find((e): e is PromiseRejectedResult => e.status === "rejected");
    if (failure) throw failure.reason;
    const sheets: Buffer[] = [];
    for (let s = 0; s * per < segments.length; s++) {
      const chunk = files.slice(s * per * 3, (s + 1) * per * 3);
      const list = path.join(dir, `sheet-${s}.txt`);
      await writeFile(list, chunk.map((f) => `file '${f}'`).join("\n"));
      const out = path.join(dir, `sheet-${s}.jpg`);
      const rows = Math.ceil(chunk.length / columns);
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          list,
          "-vf",
          `tile=${columns}x${rows}:padding=6:margin=6:color=black`,
          "-frames:v",
          "1",
          "-q:v",
          "4",
          out,
        ],
        { ...(o.signal && { signal: o.signal }) },
      );
      sheets.push(await readFile(out));
    }
    o.onProgress?.(1);
    return sheets;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface StripOptions {
  /** Tile width in pixels. */
  readonly width?: number;
  /** Tiles per row (one row by default). */
  readonly columns?: number;
  /** The cut falls after this tile (0-based): a red bar there, thin dark gaps elsewhere. */
  readonly cutAfter?: number | null;
}

/**
 * Frames side by side in one JPEG, left to right then row by row: consecutive frames either side of a
 * cut, so a flash, a black frame or a jump shows in one picture instead of a guess between stills.
 */
export async function frameStrip(frames: readonly Buffer[], o: StripOptions = {}): Promise<Buffer> {
  if (!frames.length) throw new Error("no frames for a strip");
  const width = o.width ?? 200;
  const columns = Math.max(1, Math.min(frames.length, o.columns ?? frames.length));
  const GAP = 4;
  const BAR = 10;
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-strip-"));
  try {
    const inputs: string[] = [];
    for (const [i, f] of frames.entries()) {
      const file = path.join(dir, `${i}.jpg`);
      await writeFile(file, f);
      inputs.push("-i", file);
    }
    const rows: number[][] = [];
    for (let i = 0; i < frames.length; i += columns)
      rows.push(Array.from({ length: Math.min(columns, frames.length - i) }, (_, k) => i + k));
    // Each tile carries the gap on its right: the red bar after the cut, nothing at a row's end.
    const right = (i: number, last: boolean) => (i === o.cutAfter ? BAR : last ? 0 : GAP);
    const rowWidth = (row: number[]) =>
      row.reduce((w, i, k) => w + width + right(i, k === row.length - 1), 0);
    const widest = Math.max(...rows.map(rowWidth));
    const graph: string[] = [];
    for (const row of rows)
      for (const [k, i] of row.entries()) {
        const gap = right(i, k === row.length - 1);
        const color = i === o.cutAfter ? "0xff2d2d" : "0x111111";
        graph.push(`[${i}:v]scale=${width}:-2${gap ? `,pad=iw+${gap}:ih:0:0:color=${color}` : ""}[t${i}]`);
      }
    for (const [j, row] of rows.entries()) {
      const below = j < rows.length - 1 ? GAP * 2 : 0;
      const tiles = row.map((i) => `[t${i}]`).join("");
      const stack = row.length > 1 ? `${tiles}hstack=inputs=${row.length},` : tiles;
      graph.push(`${stack}pad=${widest}:ih+${below}:0:0:color=0x111111[r${j}]`);
    }
    graph.push(
      rows.length > 1
        ? `${rows.map((_, j) => `[r${j}]`).join("")}vstack=inputs=${rows.length}[out]`
        : "[r0]null[out]",
    );
    const out = path.join(dir, "strip.jpg");
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      ...inputs,
      "-filter_complex",
      graph.join(";"),
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-q:v",
      "4",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Loud stretches with no speech, from the waveform (50 values a second): crowds, applause, engines,
 * music. [start, end] in seconds, at least `minLength` long.
 */
export function loudStretches(
  peaks: Uint8Array,
  speech: readonly { start: number; end: number }[],
  perSecond = 50,
  minLength = 1.5,
): [number, number][] {
  if (!peaks.length) return [];
  // A second's average, against the loud end of this clip (its 95th percentile).
  const avg = new Float32Array(peaks.length);
  let sum = 0;
  for (let i = 0; i < peaks.length; i++) {
    sum += peaks[i]!;
    if (i >= perSecond) sum -= peaks[i - perSecond]!;
    avg[i] = sum / Math.min(i + 1, perSecond);
  }
  const sorted = [...avg].sort((a, b) => a - b);
  const loud = Math.max(60, sorted[Math.floor(sorted.length * 0.95)]! * 0.7);
  // Where someone is talking, as a mask over the waveform (built once: an hour has thousands of words).
  const talk = new Uint8Array(peaks.length);
  for (const w of speech) {
    const a = Math.max(0, Math.floor((w.start - 0.3) * perSecond));
    const b = Math.min(peaks.length - 1, Math.ceil((w.end + 0.3) * perSecond));
    talk.fill(1, a, b + 1);
  }
  const out: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= avg.length; i++) {
    const t = i / perSecond;
    const on = i < avg.length && avg[i]! >= loud && !talk[i];
    if (on && from < 0) from = t;
    if (!on && from >= 0) {
      const last = out.at(-1);
      if (last && from - last[1] < 0.5) last[1] = t;
      else out.push([from, t]);
      from = -1;
    }
  }
  return out
    .filter(([a, b]) => b - a >= minLength)
    .map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]);
}
