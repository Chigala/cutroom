/**
 * What a stretch of sound does over time, from the waveform the indexer already keeps (50 peaks a
 * second): how loud it is moment to moment, where it's quiet, where it builds, where it's full, and
 * where it hits. It's how the agent "hears" a track it can't play.
 */

import type { ProjectDoc } from "./schema.ts";

const PER_SECOND = 50;

export interface SoundShape {
  /** Seconds analysed, [from, to). */
  readonly from: number;
  readonly to: number;
  /** Level every `step` seconds, dB against the stretch's loud end (0 is as loud as it gets). */
  readonly step: number;
  readonly levels: readonly number[];
  readonly sections: readonly { start: number; end: number; kind: "quiet" | "build" | "full" | "mid" }[];
  /** Where it first gets going (level within 12 dB of full), seconds. */
  readonly start: number | null;
  /** The biggest jump in energy (at least 6 dB within 1.5 s): the drop, the hit. */
  readonly hit: number | null;
}

const BARS = "▁▂▃▄▅▆▇█";

/** Peaks are square-root scaled 0..255; back to amplitude, then dB. */
const dbOf = (peak: number) => 20 * Math.log10(Math.max(1e-4, (peak / 255) ** 2));

const snap = (t: number, grid: readonly number[] | undefined, within: number) => {
  if (!grid?.length) return t;
  let best = t;
  let d = within;
  for (const g of grid)
    if (Math.abs(g - t) < d) {
      d = Math.abs(g - t);
      best = g;
    }
  return best;
};

export function soundShape(
  peaks: Uint8Array,
  {
    from = 0,
    to,
    step = 0.25,
    beats,
  }: { from?: number; to?: number; step?: number; beats?: readonly number[] } = {},
): SoundShape {
  const total = peaks.length / PER_SECOND;
  const end = Math.min(total, to ?? total);
  const start = Math.max(0, Math.min(from, end));
  // Exact window edges (a quarter second is 12.5 peaks): rounding each window would drift the times.
  const raw: number[] = [];
  for (let k = 0; start + k * step < end - 1e-9; k++) {
    const a = Math.round((start + k * step) * PER_SECOND);
    const b = Math.min(peaks.length, Math.max(a + 1, Math.round((start + (k + 1) * step) * PER_SECOND)));
    // The window's loudness: the mean of its peaks, as a level.
    let sum = 0;
    for (let j = a; j < b; j++) sum += peaks[j]!;
    raw.push(dbOf(sum / (b - a)));
  }
  if (!raw.length) return { from: start, to: end, step, levels: [], sections: [], start: null, hit: null };
  // Against the loud end of this stretch (95th percentile), so a quiet master still reads right.
  const sorted = [...raw].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? sorted.at(-1)!;
  const levels = raw.map((l) => Math.round(Math.min(0, l - loud) * 10) / 10);
  // About a second of smoothing for the shape; the bars keep the detail.
  const w = Math.max(1, Math.round(1 / step / 2));
  const smooth = levels.map((_, i) => {
    const win = levels.slice(Math.max(0, i - w), i + w + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
  const at = (i: number) => Math.round(Math.min(end, start + i * step) * 100) / 100;
  // Sections: quiet, mid and full stretches of at least a second; a mid stretch that climbs into a full
  // one is a build.
  const kindOf = (l: number) => (l < -18 ? "quiet" : l < -7 ? "mid" : "full");
  const runs: { start: number; end: number; kind: "quiet" | "build" | "full" | "mid" }[] = [];
  smooth.forEach((l, i) => {
    const k = kindOf(l);
    const last = runs.at(-1);
    if (last && last.kind === k) last.end = at(i + 1);
    else runs.push({ start: at(i), end: at(i + 1), kind: k });
  });
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && (r.end - r.start < 1 || last.kind === r.kind)) last.end = r.end;
    else merged.push({ ...r });
  }
  merged.forEach((r, i) => {
    const next = merged[i + 1];
    if (r.kind === "mid" && next?.kind === "full") {
      const a = smooth[Math.round((r.start - start) / step)] ?? 0;
      const b = smooth[Math.max(0, Math.round((r.end - start) / step) - 1)] ?? 0;
      if (b - a > 3) r.kind = "build";
    }
  });
  const firstLoud = smooth.findIndex((l) => l > -12);
  // The hit: the largest rise in the smoothed level over 1.5 s.
  const span = Math.max(1, Math.round(1.5 / step));
  let hit: number | null = null;
  let rise = 6;
  for (let i = span; i < smooth.length; i++) {
    // A hit lands somewhere loud: a rise inside a quiet intro isn't one.
    if (smooth[i]! < -8) continue;
    const d = smooth[i]! - Math.min(...smooth.slice(i - span, i));
    if (d > rise) {
      rise = d;
      hit = i;
    }
  }
  // The jump lands a little before the smoothed peak: walk back to where it started climbing fast.
  if (hit !== null) while (hit > 0 && levels[hit - 1]! > levels[hit]! - 4 && levels[hit - 1]! > -10) hit--;
  return {
    from: start,
    to: end,
    step,
    levels,
    sections: merged,
    start: firstLoud >= 0 ? snap(at(firstLoud), beats, 0.3) : null,
    hit: hit !== null ? snap(at(hit), beats, 0.1) : null,
  };
}

/** The shape as text: a level bar per step, a line per stretch of time, then sections, start and hit. */
export function describeSound(shape: SoundShape, { perLine = 8 }: { perLine?: number } = {}): string {
  const { levels, step } = shape;
  if (!levels.length) return "Silent, or no waveform for this stretch.";
  const per = Math.max(1, Math.round(perLine / step));
  const lines: string[] = [];
  for (let i = 0; i < levels.length; i += per) {
    const bars = levels
      .slice(i, i + per)
      .map((l) => BARS[Math.max(0, Math.min(7, Math.round(((l + 30) / 30) * 7)))])
      .join("");
    lines.push(`${(shape.from + i * step).toFixed(1).padStart(6)}s ${bars}`);
  }
  const t = (x: number) => `${x.toFixed(2)}s`;
  return [
    `Level every ${step}s (▁ quiet, █ as loud as it gets):`,
    ...lines,
    "",
    `Sections: ${shape.sections.map((s) => `${t(s.start)}-${t(s.end)} ${s.kind}`).join(", ")}`,
    `Gets going: ${shape.start !== null ? t(shape.start) : "never gets loud"}`,
    `Hit (biggest jump in energy): ${shape.hit !== null ? t(shape.hit) : "none, it stays at one level"}`,
  ].join("\n");
}

export interface Stretch {
  readonly start: number;
  readonly end: number;
  /** Repeated to fill the video (the track, or its strong part, is shorter than the video). */
  readonly loop: boolean;
  /** Its quietest moments (10th percentile level, dB against the loud end): near 0 has no flat spots. */
  readonly floor: number;
}

/**
 * The best part of a track for a video `length` seconds long: a stretch that long with no quiet or flat
 * spots when the track has one, otherwise the best loop (whole bars, on downbeats, with no level jump
 * at the seam). `mode` forces a loop or a single stretch.
 */
export function bestStretch(
  peaks: Uint8Array,
  length: number,
  {
    duration = peaks.length / PER_SECOND,
    downbeats,
    beats,
    mode = "auto",
  }: {
    duration?: number;
    downbeats?: readonly number[];
    beats?: readonly number[];
    mode?: "auto" | "part" | "loop";
  } = {},
): Stretch | null {
  const step = 0.25;
  const { levels } = soundShape(peaks, { step });
  if (levels.length < 8) return null;
  const grid =
    downbeats && downbeats.length >= 4
      ? [...downbeats]
      : beats && beats.length >= 8
        ? [...beats]
        : Array.from({ length: Math.floor(duration / 0.5) }, (_, i) => i * 0.5);
  const bin = (t: number) => Math.max(0, Math.min(levels.length, Math.round(t / step)));
  const judge = (a: number, b: number) => {
    const win = levels.slice(bin(a), bin(b));
    if (!win.length) return { score: -Infinity, floor: -60 };
    const sorted = [...win].sort((x, y) => x - y);
    const floor = sorted[Math.floor(sorted.length * 0.1)]!;
    const mean = win.reduce((x, y) => x + y, 0) / win.length;
    const quiet = win.filter((l) => l < -18).length / win.length;
    // Its weakest moments matter most: a flat stretch is what a listener notices.
    return { score: 1.5 * floor + 0.5 * mean - 30 * quiet, floor };
  };
  const fits = duration >= length + 0.05;
  if (mode === "part" || (mode === "auto" && fits)) {
    if (!fits) return null;
    let best: Stretch | null = null;
    let top = -Infinity;
    for (const g of grid.length ? grid : [0]) {
      if (g + length > duration + 0.05) break;
      const { score, floor } = judge(g, g + length);
      if (score > top) {
        top = score;
        best = {
          start: round2(g),
          end: round2(Math.min(duration, g + length)),
          loop: false,
          floor: round2(floor),
        };
      }
    }
    if (best || mode === "part") return best;
  }
  // A loop: whole stretches between grid points, long enough not to feel repetitive, with matching
  // levels either side of the seam.
  // Long enough not to feel repetitive, but in proportion to the track: a short edit's best loop may be
  // two bars.
  const minLen = Math.min(duration * 0.9, Math.max(3, Math.min(8, length / 4, duration * 0.4)));
  let best: Stretch | null = null;
  let top = -Infinity;
  for (let i = 0; i < grid.length; i++)
    for (let j = i + 1; j < grid.length; j++) {
      const a = grid[i]!;
      const b = grid[j]!;
      if (b - a < minLen) continue;
      if (b - a > 32 || b > duration + 0.05) break;
      const { score, floor } = judge(a, b);
      const head = levels.slice(bin(a), bin(a + 0.5));
      const tail = levels.slice(bin(b - 0.5), bin(b));
      const avg = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0);
      const seam = Math.abs(avg(head) - avg(tail));
      const total = score - 0.5 * seam + 0.08 * (b - a);
      if (total > top) {
        top = total;
        best = { start: round2(a), end: round2(b), loop: true, floor: round2(floor) };
      }
    }
  return best;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The music's beats in output time: the track's beat map from where it starts (its section, or its
 * offset), repeated with the loop, up to `duration`. Empty without music or a beat map.
 */
export function musicBeats(doc: ProjectDoc, duration: number): number[] {
  const m = doc.music;
  const a = m.source ? doc.analyses.find((x) => x.id === m.source) : undefined;
  const src = m.source ? doc.sources.find((x) => x.id === m.source) : undefined;
  if (!a?.beats?.length || !src) return [];
  const from = m.section ? m.section.start : m.offset;
  const end = m.section ? m.section.end : src.duration;
  const len = end - from;
  if (len <= 0.2) return [];
  const out: number[] = [];
  const passes = m.loop ? Math.ceil(duration / len) : 1;
  for (let k = 0; k < passes; k++)
    for (const b of a.beats)
      if (b >= from && b < end && b - from + k * len < duration) out.push(b - from + k * len);
  return out;
}

/** Seconds per beat, from the music's tempo; null without one. */
export const beatLength = (doc: ProjectDoc): number | null => {
  const a = doc.music.source ? doc.analyses.find((x) => x.id === doc.music.source) : undefined;
  return a?.bpm ? 60 / a.bpm : null;
};
