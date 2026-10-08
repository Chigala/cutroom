/**
 * A reference video studied for what indexing doesn't measure: how the frame moves within each shot
 * (punch-ins, slow pushes, pans, shake: the camera tracker that steadying uses), what each cut is (hard,
 * dissolve, flash, dip, whip: from small frames either side), and its sound's pulse and hits. Plain data:
 * measureReference (@vedit/project) lines these up against each other and writes the report.
 */
import { beatMap, type Onset, onsets } from "./beats.ts";
import { CancelledError, run } from "./exec.ts";
import { type Face, facesAtTimes } from "./face.ts";
import { classify, type HeardWindow } from "./hear.ts";
import { trackCamera } from "./steady.ts";

export interface ShotMotion {
  readonly from: number;
  readonly to: number;
  /** Sudden zooms: when, and how much (0.12 is 12% in, negative out). */
  readonly punches: readonly { readonly at: number; readonly size: number }[];
  /** The slow zoom besides those, start to end (0.08 is pushed 8% in). */
  readonly drift: number;
  /** How far the frame travelled, in shares of its width and height (a pan, a tilt). */
  readonly pan: { readonly x: number; readonly y: number };
  /** Frame-to-frame jitter, in shares of the frame: about 0.001 locked off, 0.004+ handheld. */
  readonly shake: number;
}

export type TransitionKind = "cut" | "dissolve" | "flash" | "dip" | "whip";

export interface MotionStudy {
  readonly shots: readonly ShotMotion[];
  readonly transitions: readonly { readonly at: number; readonly kind: TransitionKind }[];
  /** Cuts within a take that change the framing (a jump zoom): when, and how much (0.12 is 12% tighter). */
  readonly jumps: readonly { readonly at: number; readonly size: number }[];
}

/**
 * Jump zooms: at a cut, the same person in about the same place, framed 5-30% tighter or looser (what
 * look.jumpZoom does). Not a cut to another shot size of them (a close-up from a medium), which changes
 * more.
 */
export function jumpZoomsOf(
  cuts: readonly number[],
  faces: readonly (Face | null)[],
): { at: number; size: number }[] {
  const jumps: { at: number; size: number }[] = [];
  for (const [k, at] of cuts.entries()) {
    const a = faces[2 * k];
    const b = faces[2 * k + 1];
    if (!a || !b || a.size < 0.05 || Math.abs(a.x - b.x) > 0.15 || Math.abs(a.y - b.y) > 0.15) continue;
    const r = b.size / a.size;
    if (Math.abs(Math.log(r)) >= Math.log(1.05) && Math.abs(Math.log(r)) <= Math.log(1.3))
      jumps.push({ at, size: Math.round((r - 1) * 100) / 100 });
  }
  return jumps;
}

/** Rate the frame's movement is read at: enough for a punch (one frame jump), quick to track. */
const MOTION_FPS = 15;
/** A punch: the scale jumps at least this much (log) within two frames, and stays. */
const PUNCH = 0.035;

/** Punch-ins, drift, pan and shake from one shot's camera path. */
export function shotMotion(
  from: number,
  to: number,
  path: {
    readonly fps: number;
    readonly x: readonly number[];
    readonly y: readonly number[];
    readonly s: readonly number[];
  },
): ShotMotion {
  const { s, x, y, fps } = path;
  const punches: { at: number; size: number }[] = [];
  for (let i = 2; i < s.length; i++) {
    const step = s[i]! - s[i - 2]!;
    if (Math.abs(step) < PUNCH) continue;
    // A punch holds either side of its jump; a zoom that keeps going is a move (drift), not a punch.
    const after = s[Math.min(s.length - 1, i + 3)]! - s[i]!;
    const before = s[i - 2]! - s[Math.max(0, i - 5)]!;
    if (Math.abs(after) > Math.abs(step) * 0.4 || Math.abs(before) > Math.abs(step) * 0.4) continue;
    const at = Math.round((from + (i - 1) / fps) * 100) / 100;
    const last = punches.at(-1);
    if (last && at - last.at < 0.3) continue;
    punches.push({ at, size: Math.round(Math.expm1(step) * 100) / 100 });
    i += 2;
  }
  const n = s.length;
  const total = n ? s[n - 1]! - s[0]! : 0;
  const punched = punches.reduce((sum, p) => sum + Math.log1p(p.size), 0);
  let jitter = 0;
  for (let i = 2; i < n; i++)
    jitter += (x[i]! - 2 * x[i - 1]! + x[i - 2]!) ** 2 + (y[i]! - 2 * y[i - 1]! + y[i - 2]!) ** 2;
  return {
    from,
    to,
    punches,
    drift: Math.round(Math.expm1(total - punched) * 100) / 100,
    pan: {
      x: n ? Math.round((x[n - 1]! - x[0]!) * 100) / 100 : 0,
      y: n ? Math.round((y[n - 1]! - y[0]!) * 100) / 100 : 0,
    },
    shake: n > 2 ? Math.round(Math.sqrt(jitter / (n - 2)) * 10000) / 10000 : 0,
  };
}

/** Per frame around a cut: brightness (0-1), sharpness (mean edge, 0-1) and change from the frame before. */
export interface CutFrames {
  readonly bright: readonly number[];
  readonly sharp: readonly number[];
  readonly change: readonly number[];
  /** Index of the first frame of the new shot. */
  readonly at: number;
}

/** What a cut is, from the frames either side of it. */
export function transitionKind(f: CutFrames): TransitionKind {
  const { bright, sharp, change, at } = f;
  const n = bright.length;
  const edge = (xs: readonly number[]) => (xs[0]! + xs[1]! + xs[n - 1]! + xs[n - 2]!) / 4;
  const near = (lo: number, hi: number) =>
    Array.from({ length: hi - lo }, (_, k) => lo + k).filter((i) => i >= 0 && i < n);
  const around = near(at - 4, at + 4);
  const shots = edge(bright);
  // A flash: a frame or few far brighter than both shots. A dip: down to black from shots that aren't.
  if (around.some((i) => bright[i]! > 0.85 && bright[i]! > shots + 0.25)) return "flash";
  if (shots > 0.18 && around.some((i) => bright[i]! < 0.06)) return "dip";
  // A whip: the picture smears (sharpness collapses) across the cut.
  const crisp = edge(sharp);
  if (crisp > 0 && near(at - 2, at + 2).filter((i) => sharp[i]! < crisp * 0.45).length >= 2) return "whip";
  // A dissolve: the change spreads over several frames instead of one jump.
  const biggest = Math.max(...around.map((i) => change[i]!));
  const spread = around.filter((i) => change[i]! >= biggest * 0.3).length;
  if (biggest > 0 && spread >= 4) return "dissolve";
  return "cut";
}

/** Small grey frames either side of a cut, measured (`h` the frames' height at 48 wide). */
async function framesAround(
  video: string,
  cut: number,
  fps: number,
  h: number,
  signal?: AbortSignal,
): Promise<CutFrames | null> {
  const W = 48;
  const from = Math.max(0, cut - 0.3);
  const { stdoutBuffer } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(from),
      "-t",
      "0.6",
      "-i",
      video,
      "-vf",
      `fps=${fps},scale=${W}:${h},format=gray`,
      "-f",
      "rawvideo",
      "-",
    ],
    { binary: true, ...(signal && { signal }) },
  );
  const frames = Math.floor(stdoutBuffer.length / (W * h));
  if (frames < 4) return null;
  const bright: number[] = [];
  const sharp: number[] = [];
  const change: number[] = [];
  let prev: Uint8Array | null = null;
  for (let k = 0; k < frames; k++) {
    const px = stdoutBuffer.subarray(k * W * h, (k + 1) * W * h);
    let sum = 0;
    let edges = 0;
    let diff = 0;
    for (let i = 0; i < px.length; i++) {
      sum += px[i]!;
      if (i % W) edges += Math.abs(px[i]! - px[i - 1]!);
      if (prev) diff += Math.abs(px[i]! - prev[i]!);
    }
    bright.push(sum / px.length / 255);
    sharp.push(edges / px.length / 255);
    change.push(prev ? diff / px.length / 255 : 0);
    prev = px;
  }
  return { bright, sharp, change, at: Math.min(frames - 1, Math.round((cut - from) * fps)) };
}

/** How the frame moves in each shot, and what each cut is. */
export async function studyMotion(
  video: string,
  cuts: readonly number[],
  duration: number,
  o: {
    readonly fps?: number;
    /** The picture's shape (width over height): the frames around cuts keep it. */
    readonly aspect?: number;
    readonly signal?: AbortSignal;
    readonly onProgress?: (f: number) => void;
  } = {},
): Promise<MotionStudy> {
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const shots: ShotMotion[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    if (o.signal?.aborted) throw new CancelledError();
    // Clear of the cuts' own frames, where the tracker would read the change of shot as a move.
    const from = bounds[k]! + 0.05;
    const to = bounds[k + 1]! - 0.05;
    o.onProgress?.((k / (bounds.length - 1)) * 0.8);
    if (to - from < 0.4) continue;
    const path = await trackCamera(video, from, to, {
      fps: MOTION_FPS,
      ...(o.signal && { signal: o.signal }),
    }).catch(() => null);
    if (path) shots.push(shotMotion(from, to, path));
  }
  const fps = o.fps ?? 30;
  const transitions: { at: number; kind: TransitionKind }[] = [];
  for (const [i, cut] of cuts.entries()) {
    if (o.signal?.aborted) throw new CancelledError();
    o.onProgress?.(0.8 + (i / Math.max(1, cuts.length)) * 0.2);
    const h = Math.max(8, 2 * Math.round(48 / (o.aspect ?? 16 / 9) / 2));
    const frames = await framesAround(video, cut, Math.min(60, Math.max(24, fps)), h, o.signal).catch(
      () => null,
    );
    if (frames) transitions.push({ at: cut, kind: transitionKind(frames) });
  }
  // The framing either side of each cut (a tenth of a second off it), for jump zooms.
  const faces = await facesAtTimes(
    video,
    cuts.flatMap((c) => [Math.max(0, c - 0.1), c + 0.1]),
    o.signal,
  ).catch(() => []);
  o.onProgress?.(1);
  return { shots, transitions, jumps: jumpZoomsOf(cuts, faces) };
}

/** Editing effects the sound recognizer names (Apple's ids, or AudioSet's names made the same way). */
const EFFECTS: Readonly<Record<string, string>> = {
  whoosh_swoosh_swish: "whoosh",
  thump_thud: "impact",
  bang: "impact",
  boom: "impact",
  slam: "impact",
  pop: "pop",
  boing: "boing",
  click: "click",
  clicking: "click",
  tick: "click",
  ding: "ding",
  bicycle_bell: "ding",
  chime: "ding",
  camera: "camera shutter",
  cash_register: "cash register",
  whip: "whip crack",
  zing: "zing",
  beep_bleep: "beep",
};
/** How sure the recognizer has to be: effects are short, under music, in a second-long window. */
const EFFECT_SURE = 0.25;

export interface Effect {
  /** Where it lands: a whoosh's loudest moment, the others' attack. */
  readonly at: number;
  readonly kind: string;
  readonly confidence: number;
}

/**
 * Effects heard: the recognizer's windows (a second long, every half second) kept to editing effects,
 * each pinned inside its window to where it lands, and one per effect where windows overlap.
 */
export function effectsOf(
  windows: readonly HeardWindow[],
  hits: readonly Onset[],
  loudness: (t: number) => number,
): Effect[] {
  const found: Effect[] = [];
  for (const w of windows)
    for (const [label, confidence] of w.c) {
      const kind =
        EFFECTS[
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
        ];
      if (!kind || confidence < EFFECT_SURE) continue;
      let at = w.t + w.d / 2;
      if (kind === "whoosh") {
        let loudest = -1;
        for (let t = w.t; t <= w.t + w.d; t += 0.02)
          if (loudness(t) > loudest) {
            loudest = loudness(t);
            at = t;
          }
      } else {
        const attack = hits
          .filter((h) => h.at >= w.t - 0.05 && h.at <= w.t + w.d + 0.05)
          .sort((a, b) => b.strength - a.strength)[0];
        if (attack) at = attack.at;
      }
      found.push({ at: Math.round(at * 100) / 100, kind, confidence: Math.round(confidence * 100) / 100 });
    }
  found.sort((a, b) => a.at - b.at);
  const out: Effect[] = [];
  for (const e of found) {
    const same = out.findLast((o) => o.kind === e.kind && e.at - o.at < 0.4);
    if (!same) out.push(e);
    else if (e.confidence > same.confidence) out[out.indexOf(same)] = e;
  }
  return out;
}

export interface RhythmStudy {
  readonly bpm: number | null;
  /** How clearly the beat stands out: about 1 (none) to 4+ (a clean kick). */
  readonly pulse: number;
  /** Seconds. */
  readonly beats: readonly number[];
  /** Sudden sounds that stand out (drums on the beat, hits off it), in the sound without the voice when it could be taken out. */
  readonly hits: readonly Onset[];
  /** Whether the hits come from the sound without the voice (else the whole mix, the voice's own onsets among them). */
  readonly voiceless: boolean;
  /** Loudness every 50 ms (of the same sound as the hits): what rises into a moment. */
  readonly loudness: readonly number[];
  /** Effects named, from the sound without the voice (none when it couldn't be taken out). */
  readonly effects: readonly Effect[];
}

/**
 * The pulse (from the whole mix: a voice over it doesn't hide a beat), the hits (from `voiceless` when
 * given), and the effects (heard in `voiceless` by `ear`, the sound recognizer: in the whole mix the
 * music buries them).
 */
export async function studyRhythm(
  mix: string,
  voiceless: string | null,
  cacheDir: string,
  ear: string | null = null,
  signal?: AbortSignal,
): Promise<RhythmStudy> {
  const map = await beatMap(mix, cacheDir);
  const found = await onsets(voiceless ?? mix, 2.5);
  const end = map.durationMs / 1000;
  const loudness: number[] = [];
  for (let t = 0; t <= end; t += 0.05) loudness.push(Math.round(found.loudness(t) * 10000) / 10000);
  return {
    bpm: map.bpm,
    pulse: map.pulse,
    beats: map.beats.map((ms) => ms / 1000),
    hits: found.onsets,
    voiceless: voiceless !== null,
    loudness,
    effects:
      voiceless && ear
        ? effectsOf(await classify(ear, voiceless, signal).catch(() => []), found.onsets, found.loudness)
        : [],
  };
}
