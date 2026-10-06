/**
 * Motion over time that isn't a fixed animation: speed ramps (a shot's footage played at a speed that
 * changes, the velocity edit), keyframes (graphics, titles and the camera moving through set poses),
 * and the cutouts that separate the person from the background.
 */
import type { Analysis, Keyframe, ProjectDoc, Scene } from "./schema.ts";

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
    const at = starts.get(item.anchor.scene);
    if (!at) continue;
    const start = at.start + item.anchor.at;
    behind.push({ start, end: start + item.duration });
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

/** The stretch of a clip a shot's cutout should cover: its footage, widened to tenths of a second. */
export const cutoutRange = (scene: Pick<Scene, "in" | "out">) => ({
  from: Math.max(0, Math.floor(scene.in * 10) / 10),
  to: Math.ceil(scene.out * 10) / 10,
});
