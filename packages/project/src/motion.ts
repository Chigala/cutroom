/**
 * Motion over time that isn't a fixed animation: speed ramps (a shot's footage played at a speed that
 * changes, the velocity edit), keyframes (graphics, titles and the camera moving through set poses),
 * and the cutouts that separate the person from the background.
 */
import type { Analysis, Keyframe, ProjectDoc, Scene } from "./schema.ts";
import type { Timeline } from "./time.ts";

// --- Speed ramps --------------------------------------------------------------------------------------

export interface RampPoint {
  /** Seconds into the shot's footage, from its in point. */
  readonly at: number;
  readonly speed: number;
}

export interface RampMap {
  /** Output seconds the shot lasts. */
  readonly length: number;
  /** Footage seconds (from the in point) shown at output second `t` into the shot. */
  sourceAt(t: number): number;
  /** Output seconds into the shot where footage second `s` (from the in point) shows. */
  outputAt(s: number): number;
}

const STEP = 1 / 240;

/** Speed at footage second `s`: eased between keyframes (smoothstep), held before the first and after the last. */
export function rampSpeed(points: readonly RampPoint[], s: number): number {
  const p = [...points].sort((a, b) => a.at - b.at);
  if (s <= p[0]!.at) return p[0]!.speed;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    if (s <= b.at) {
      const k = (s - a.at) / Math.max(1e-6, b.at - a.at);
      const e = k * k * (3 - 2 * k);
      return a.speed + (b.speed - a.speed) * e;
    }
  }
  return p.at(-1)!.speed;
}

const ramps = new WeakMap<object, RampMap>();

/** The time mapping of a ramped shot (output time = the integral of 1/speed over its footage). */
export function rampMap(scene: Pick<Scene, "in" | "out"> & { ramp?: readonly RampPoint[] }): RampMap {
  const points = scene.ramp ?? [];
  const hit = points.length ? ramps.get(points) : undefined;
  if (hit) return hit;
  const footage = Math.max(0, scene.out - scene.in);
  // Cumulative output time at each footage step.
  const n = Math.max(1, Math.ceil(footage / STEP));
  const out = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const s = Math.min(footage, i * STEP);
    const ds = s - Math.min(footage, (i - 1) * STEP);
    const mid = s - ds / 2;
    out[i] = out[i - 1]! + ds / Math.max(0.05, points.length ? rampSpeed(points, mid) : 1);
  }
  const length = out[n]!;
  const map: RampMap = {
    length,
    outputAt(s) {
      const x = Math.max(0, Math.min(footage, s)) / STEP;
      const i = Math.min(n - 1, Math.floor(x));
      return out[i]! + (out[i + 1]! - out[i]!) * (x - i);
    },
    sourceAt(t) {
      const tt = Math.max(0, Math.min(length, t));
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (out[mid]! <= tt) lo = mid;
        else hi = mid;
      }
      const span = out[hi]! - out[lo]!;
      const k = span > 0 ? (tt - out[lo]!) / span : 0;
      return Math.min(footage, (lo + k) * STEP);
    },
  };
  if (points.length) ramps.set(points, map);
  return map;
}

/** How long a shot lasts on the timeline: its ramp, or its footage at its speed. */
export function sceneLength(scene: Pick<Scene, "in" | "out" | "speed" | "ramp">): number {
  if (scene.ramp?.length) return rampMap(scene).length;
  return (scene.out - scene.in) / (scene.speed ?? 1);
}

/** Footage seconds from the in point shown `t` output seconds into the shot. */
export function sourceOffset(scene: Pick<Scene, "in" | "out" | "speed" | "ramp">, t: number): number {
  if (scene.ramp?.length) return rampMap(scene).sourceAt(t);
  return t * (scene.speed ?? 1);
}

/** Output seconds into the shot where footage second `s` (from the in point) shows. */
export function outputOffset(scene: Pick<Scene, "in" | "out" | "speed" | "ramp">, s: number): number {
  if (scene.ramp?.length) return rampMap(scene).outputAt(s);
  return s / (scene.speed ?? 1);
}

/** A ramped shot's rendered clip: a stable name for its footage stretch and ramp. */
export function rampHash(scene: Pick<Scene, "source" | "in" | "out" | "ramp">, fps: number): string {
  const text = JSON.stringify([scene.source, scene.in.toFixed(3), scene.out.toFixed(3), scene.ramp, fps]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// --- Keyframes ---------------------------------------------------------------------------------------

export const EASES = ["linear", "in", "out", "inOut", "expoOut", "back", "hold"] as const;
export type Ease = (typeof EASES)[number];

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotate: number;
  readonly opacity: number;
}

const REST: Pose = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };

const EASE: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - (1 - k) ** 3,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  expoOut: (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
  back: (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2,
  hold: (k) => (k >= 1 ? 1 : 0),
};

/**
 * The pose at `t` seconds: each property eases from the keyframe that last set it to the next one that
 * sets it, with the later keyframe's ease. Unset properties hold; before the first keyframe, its pose.
 */
export function poseAt(keyframes: readonly Keyframe[] | undefined, t: number): Pose {
  if (!keyframes?.length) return REST;
  const keys = [...keyframes].sort((a, b) => a.at - b.at);
  const prop = (name: keyof Pose): number => {
    const set = keys.filter((k) => k[name] !== undefined);
    if (!set.length) return REST[name];
    if (t <= set[0]!.at) return set[0]![name]!;
    for (let i = 1; i < set.length; i++) {
      const a = set[i - 1]!;
      const b = set[i]!;
      if (t <= b.at) {
        const k = (t - a.at) / Math.max(1e-6, b.at - a.at);
        return a[name]! + (b[name]! - a[name]!) * EASE[b.ease ?? "inOut"](k);
      }
    }
    return set.at(-1)![name]!;
  };
  return {
    x: prop("x"),
    y: prop("y"),
    scale: prop("scale"),
    rotate: prop("rotate"),
    opacity: prop("opacity"),
  };
}

/** A pose as a CSS transform (x and y as shares of the frame). */
export const poseTransform = (p: Pose, width: number, height: number) =>
  `translate(${(p.x * width).toFixed(2)}px, ${(p.y * height).toFixed(2)}px) rotate(${p.rotate.toFixed(3)}deg) scale(${p.scale.toFixed(4)})`;

// --- Cutouts -----------------------------------------------------------------------------------------

/** A short hash of points, for tags. */
function pointsHash(points: readonly { x: number; y: number; at: number }[]): string {
  let h = 2166136261;
  for (const c of points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.at.toFixed(2)}`).join(";"))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * What a shot's cutout is, as a short tag for keys and records: who (everyone, or "q<hash>" for people
 * picked by points) and what's kept with them ("subject" for everything in the foreground, "p<hash>" for
 * objects at points). "" for everyone and nothing else: the cutout as it always was.
 */
export function keepTag(scene: Pick<Scene, "keep" | "person">): string {
  const who = scene.person?.length ? `q${pointsHash(scene.person)}` : "";
  const what = !scene.keep ? "" : scene.keep === "subject" ? "subject" : `p${pointsHash(scene.keep)}`;
  return who + what;
}

/** Media keys for files made from a clip: its cutout over a stretch (and what it keeps), a ramped shot. */
export const cutoutKey = (source: string, from: number, to: number, keep = "") =>
  `${source}~cutout~${from.toFixed(2)}~${to.toFixed(2)}${keep ? `~${keep}` : ""}`;
export const rampKey = (source: string, hash: string) => `${source}~ramp~${hash}`;
/** A slowed shot made with in-between frames (smooth slow motion). */
export const flowKey = (source: string, hash: string) => `${source}~flow~${hash}`;
/** The background of a cutout's stretch blurred without the person (no halo), at a blur amount. */
export const blurPlateKey = (source: string, from: number, to: number, amount: number, keep = "") =>
  `${source}~bgblur~${from.toFixed(2)}~${to.toFixed(2)}~${amount}${keep ? `~${keep}` : ""}`;

/** A still for a cover, from one moment of a clip: the frame, the person cut out, or the background blurred. */
export type CoverPart = "frame" | "cut" | `blur${number}`;
export const coverKey = (source: string, t: number, part: CoverPart) =>
  `${source}~cover~${t.toFixed(2)}~${part}`;

export function parseDerivedKey(
  key: string,
):
  | { kind: "cover"; source: string; t: number; part: "frame" | "cut" | "blur"; amount: number }
  | { kind: "cutout"; source: string; from: number; to: number; keep: string }
  | { kind: "bgblur"; source: string; from: number; to: number; amount: number; keep: string }
  | { kind: "ramp"; source: string; hash: string }
  | { kind: "flow"; source: string; hash: string }
  | null {
  const v = /^(.+)~cover~(\d+(?:\.\d+)?)~(frame|cut|blur)(\d+)?$/.exec(key);
  if (v)
    return {
      kind: "cover",
      source: v[1]!,
      t: Number(v[2]),
      part: v[3] as "frame" | "cut" | "blur",
      amount: Number(v[4] ?? 0),
    };
  const b = /^(.+)~bgblur~(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)(?:~([a-z0-9]+))?$/.exec(key);
  if (b)
    return {
      kind: "bgblur",
      source: b[1]!,
      from: Number(b[2]),
      to: Number(b[3]),
      amount: Number(b[4]),
      keep: b[5] ?? "",
    };
  const c = /^(.+)~cutout~(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)(?:~([a-z0-9]+))?$/.exec(key);
  if (c) return { kind: "cutout", source: c[1]!, from: Number(c[2]), to: Number(c[3]), keep: c[4] ?? "" };
  const r = /^(.+)~ramp~([0-9a-z]+)$/.exec(key);
  if (r) return { kind: "ramp", source: r[1]!, hash: r[2]! };
  const f = /^(.+)~flow~([0-9a-z]+)$/.exec(key);
  if (f) return { kind: "flow", source: f[1]!, hash: f[2]! };
  return null;
}

/** The made cutout of a clip that covers [from, to] of it and keeps the same things (keepTag), if any. */
export function cutoutCovering(
  analysis: Pick<Analysis, "cutouts"> | undefined,
  from: number,
  to: number,
  keep = "",
): { from: number; to: number; blurs?: number[] | undefined; keep?: string | undefined } | null {
  return (
    analysis?.cutouts?.find((c) => c.from <= from + 1e-3 && c.to >= to - 1e-3 && (c.keep ?? "") === keep) ??
    null
  );
}

/**
 * Shots that need the person cut out: ones with a background change or a styled subject, and ones a
 * graphic or title marked behind the subject, or an effect styling the subject apart, overlaps. Ramped shots don't (their footage is re-timed).
 */
export function scenesNeedingCutout(
  doc: ProjectDoc,
  starts: ReadonlyMap<string, { start: number; end: number }>,
): Scene[] {
  const behind: { start: number; end: number }[] = [];
  // Effects whose file styles the person or the background apart (.subject, .background).
  const split = new Set(doc.effectKinds.filter((f) => separatesSubject(f.css)).map((f) => f.id));
  const items = [
    ...doc.visuals.filter((v) => v.behindSubject),
    ...doc.titles.filter((t) => t.behindSubject),
    ...doc.effects.filter((e) => split.has(e.kind)),
  ];
  for (const item of items) {
    // Over the whole video, or to a later moment (overlays that last), or for its duration.
    if ("whole" in item && item.whole) {
      behind.push({ start: 0, end: Number.POSITIVE_INFINITY });
      continue;
    }
    const at = starts.get(item.anchor.scene);
    if (!at) continue;
    const start = at.start + item.anchor.at;
    const until = "until" in item ? item.until : undefined;
    const to =
      until === "end"
        ? Number.POSITIVE_INFINITY
        : until
          ? (starts.get(until.scene)?.start ?? Number.NaN) + until.at
          : Number.NaN;
    behind.push({ start, end: to > start ? to : start + item.duration });
  }
  return doc.scenes.filter((s) => {
    if (s.ramp?.length) return false;
    const src = doc.sources.find((x) => x.id === s.source);
    if (src?.kind !== "video" && src?.kind !== "image") return false;
    if (s.background || s.subject) return true;
    const at = starts.get(s.id);
    return !!at && behind.some((b) => b.start < at.end && b.end > at.start);
  });
}

/** An effect file that styles the person (.subject) or what's behind them (.background) on their own. */
export const separatesSubject = (css: string) => /\.(subject|background)\b/.test(css);

/**
 * How far past its own cut a shot's picture shows, in output seconds: into a transition, the shot coming
 * in starts early and the one going out ends late (half the transition each side, never longer than
 * either shot). A little over, for the rounding to frames.
 */
export function pictureReach(tl: Timeline, id: string): { early: number; late: number } {
  const p = tl.byId.get(id);
  if (!p) return { early: 0, late: 0 };
  const half = (q: Timeline["scenes"][number] | undefined) => {
    const prev = q && tl.scenes[q.index - 1];
    const tr = q?.scene.transition;
    if (!q || !prev || !tr) return 0;
    return Math.max(0.07, Math.min(tr.duration, prev.duration, q.duration)) / 2 + 0.05;
  };
  return { early: half(p), late: half(tl.scenes[p.index + 1]) };
}

/**
 * The stretch of a clip a shot's cutout should cover: its footage, and what shows of it past its cut
 * into a transition either side (with the shot's timeline), widened to tenths of a second and kept in
 * the clip (`length`, when known).
 */
export function cutoutRange(
  scene: Pick<Scene, "id" | "in" | "out" | "speed">,
  tl?: Timeline,
  length?: number,
): { from: number; to: number } {
  const reach = tl ? pictureReach(tl, scene.id) : { early: 0, late: 0 };
  const speed = scene.speed ?? 1;
  const end = length && length > 0 ? length : Number.POSITIVE_INFINITY;
  return {
    from: Math.max(0, Math.floor((scene.in - reach.early * speed) * 10) / 10),
    to: Math.ceil(Math.max(scene.out, Math.min(end, scene.out + reach.late * speed)) * 10) / 10,
  };
}

// --- Steadying ----------------------------------------------------------------------------------------

export type CameraPath = NonNullable<Analysis["cameraPaths"]>[number];

/** The measured camera path of a clip that covers [from, to] of it, if any. */
export function cameraPathCovering(
  analysis: Pick<Analysis, "cameraPaths"> | undefined,
  from: number,
  to: number,
): CameraPath | null {
  return analysis?.cameraPaths?.find((c) => c.from <= from + 1e-3 && c.to >= to - 1e-3) ?? null;
}

/**
 * A steadied shot: for each frame of its camera path, the move that cancels the shake (x, y in shares
 * of the picture, a in radians, s as log scale), and the zoom that keeps the frame filled through it.
 */
export interface Steadied {
  readonly fps: number;
  /** Clip seconds where the path starts. */
  readonly from: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly a: Float32Array;
  readonly s: Float32Array;
  readonly zoom: number;
  /** The footage's size as shown in the frame, in pixels: what x and y are shares of. */
  readonly shown: { readonly w: number; readonly h: number };
}

/** Each value averaged with its neighbours, a Gaussian `sigma` frames wide (fewer at the ends). */
function smoothed(v: readonly number[], sigma: number): Float32Array {
  const out = new Float32Array(v.length);
  const reach = Math.ceil(sigma * 3);
  for (let i = 0; i < v.length; i++) {
    let sum = 0;
    let weight = 0;
    for (let j = Math.max(0, i - reach); j <= Math.min(v.length - 1, i + reach); j++) {
      const w = Math.exp(-((j - i) ** 2) / (2 * sigma * sigma));
      sum += v[j]! * w;
      weight += w;
    }
    out[i] = sum / weight;
  }
  return out;
}

/**
 * How to steady a shot over its camera path. The camera's path is smoothed (a Gaussian up to 1.5 s
 * wide by `amount`; at 1 held still, as on a tripod) and each frame moved from where it was to where
 * the smooth path puts it. The zoom is what keeps the frame filled through those moves, in a frame of
 * `frame` size showing the footage at `shown` size; past `zoom` the moves are scaled down to fit.
 */
export function steady(
  path: CameraPath,
  settings: { amount: number; zoom: number },
  frame: { w: number; h: number },
  shown: { w: number; h: number },
): Steadied {
  const n = path.x.length;
  const target = (v: readonly number[]): Float32Array => {
    if (settings.amount >= 0.999) {
      const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
      return new Float32Array(v.length).fill(mean);
    }
    const sigma = settings.amount * 1.5 * path.fps;
    if (sigma < 0.5) return Float32Array.from(v);
    // A steady pan is kept as it is (a straight line through the path); only the shake around it is
    // smoothed, so the ends of the shot don't drift.
    const n = v.length;
    const mi = (n - 1) / 2;
    const mv = v.reduce((a, b) => a + b, 0) / Math.max(1, n);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - mi) * (v[i]! - mv);
      den += (i - mi) ** 2;
    }
    const slope = den ? num / den : 0;
    const line = (i: number) => mv + slope * (i - mi);
    const rest = smoothed(
      v.map((x, i) => x - line(i)),
      sigma,
    );
    return rest.map((x, i) => x + line(i));
  };
  const moves = (["x", "y", "a", "s"] as const).map((k) => {
    const v = path[k];
    const t = target(v);
    return Float32Array.from(v, (x, i) => t[i]! - x);
  }) as [Float32Array, Float32Array, Float32Array, Float32Array];
  // The zoom a share k of the moves needs: the frame, turned and shifted, must stay inside the footage.
  const needs = (k: number) => {
    let z = 1;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(moves[2][i]! * k);
      const sc = Math.exp(moves[3][i]! * k);
      const tx = Math.abs(moves[0][i]! * k) * shown.w;
      const ty = Math.abs(moves[1][i]! * k) * shown.h;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      z = Math.max(
        z,
        (frame.w * cos + frame.h * sin + 2 * tx) / (sc * shown.w),
        (frame.h * cos + frame.w * sin + 2 * ty) / (sc * shown.h),
      );
    }
    return z;
  };
  let k = 1;
  if (needs(1) > settings.zoom) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (needs(mid) > settings.zoom) hi = mid;
      else lo = mid;
    }
    k = lo;
  }
  const [x, y, a, s] = moves.map((m) => (k === 1 ? m : m.map((v) => v * k))) as typeof moves;
  return { fps: path.fps, from: path.from, x, y, a, s, zoom: Math.max(1, needs(k)), shown };
}

/** A steadied shot's move at `t` seconds of its clip, between the path's frames. */
export function steadyAt(st: Steadied, t: number): { x: number; y: number; a: number; s: number } {
  const f = Math.max(0, Math.min(st.x.length - 1, (t - st.from) * st.fps));
  const i = Math.floor(f);
  const j = Math.min(st.x.length - 1, i + 1);
  const u = f - i;
  const at = (v: Float32Array) => v[i]! + (v[j]! - v[i]!) * u;
  return { x: at(st.x), y: at(st.y), a: at(st.a), s: at(st.s) };
}

// --- Smooth slow motion -------------------------------------------------------------------------------

/** The slowest a shot plays its footage: its speed, or the slowest point of its ramp. */
export const slowest = (scene: Pick<Scene, "speed" | "ramp">): number =>
  scene.ramp?.length ? Math.min(...scene.ramp.map((r) => r.speed)) : (scene.speed ?? 1);

/**
 * Whether a shot needs in-between frames: slowed past the frames its footage has at `fps` (30 fps
 * footage at half speed has 15 a second for 30), and not asked to repeat frames instead.
 */
export function needsFlow(
  scene: Pick<Scene, "speed" | "ramp" | "interpolate">,
  source: { kind: string; fps?: number | undefined } | undefined,
  fps: number,
): boolean {
  if (scene.interpolate === false || source?.kind !== "video") return false;
  return slowest(scene) * (source.fps ?? 30) < fps * 0.95;
}

/**
 * The stretch of the clip a slowed shot's smooth version covers: a ramped shot's footage (it doesn't
 * reach into transitions), else what shows of it, into a transition either side too.
 */
export function flowRange(
  scene: Pick<Scene, "id" | "in" | "out" | "speed" | "ramp">,
  tl: Timeline,
  length?: number,
): { from: number; to: number } {
  return scene.ramp?.length ? { from: scene.in, to: scene.out } : cutoutRange(scene, tl, length);
}

/** What a smooth version is made from, as a short hash (a change to any of it makes a new one). */
export function flowHash(
  scene: Pick<Scene, "source" | "in" | "out" | "speed" | "ramp">,
  range: { from: number; to: number },
  fps: number,
): string {
  const text = JSON.stringify([
    scene.source,
    scene.in.toFixed(3),
    scene.out.toFixed(3),
    scene.ramp?.length ? scene.ramp : (scene.speed ?? 1),
    range.from.toFixed(2),
    range.to.toFixed(2),
    fps,
  ]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
