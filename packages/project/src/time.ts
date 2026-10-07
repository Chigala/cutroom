import { sceneLength, sourceOffset } from "./motion.ts";
import type { Anchor, ProjectDoc, Scene } from "./schema.ts";

export interface PlacedScene {
  readonly scene: Scene;
  readonly index: number;
  /** Output time where the scene starts, in seconds. */
  readonly start: number;
  readonly duration: number;
}

export interface Timeline {
  readonly scenes: readonly PlacedScene[];
  readonly byId: ReadonlyMap<string, PlacedScene>;
  readonly duration: number;
}

const cache = new WeakMap<readonly Scene[], Timeline>();

/**
 * Where every scene sits in output time. Memoized on the scenes array: docs share structure, so any
 * edit that doesn't touch scenes gets the cached layout for free.
 */
export function timelineOf(doc: Pick<ProjectDoc, "scenes">): Timeline {
  const hit = cache.get(doc.scenes);
  if (hit) return hit;
  let t = 0;
  const scenes = doc.scenes.map((scene, index) => {
    // A shot lasts its length of footage at its speed (or through its speed ramp).
    const placed = { scene, index, start: t, duration: sceneLength(scene) };
    t += placed.duration;
    return placed;
  });
  const timeline: Timeline = { scenes, byId: new Map(scenes.map((s) => [s.scene.id, s])), duration: t };
  cache.set(doc.scenes, timeline);
  return timeline;
}

/** Where one shot's sound plays, which with J- and L-cuts isn't exactly where its picture does. */
export interface AudioSpan {
  readonly placed: PlacedScene;
  /** Output seconds where its sound takes over from the shot before, and hands over to the next. */
  readonly from: number;
  readonly to: number;
  /** Crossfades centred on `from` and `to`, in seconds (0 is a hard cut with a click-free micro fade). */
  readonly fadeIn: number;
  readonly fadeOut: number;
}

/** A J- or L-cut eases over this long; a transition's sound crossfades over the transition. */
const JL_FADE = 0.2;

const audioCache = new WeakMap<Timeline, Map<string, AudioSpan[]>>();

/**
 * The sound plan of the cut. Every shot's sound hands over to the next at its cut, moved by J- and
 * L-cuts (the next shot's audioLead pulls the handover earlier, this shot's audioTail pushes it later),
 * and crossfades when there's a transition or a J/L cut. The preview, the export's voice track and the
 * captions all follow this one plan.
 */
export function audioPlan(timeline: Timeline, jlFade = JL_FADE, cutFade = 0): AudioSpan[] {
  const byFade = audioCache.get(timeline) ?? new Map<string, AudioSpan[]>();
  const key = `${jlFade}:${cutFade}`;
  const hit = byFade.get(key);
  if (hit) return hit;
  const { scenes } = timeline;
  // Where each cut's sound happens. Never past the middle of either shot, so spans stay in order.
  const handover = scenes.map((p, i) => {
    const prev = scenes[i - 1];
    if (!prev) return 0;
    const shift = (prev.scene.audioTail ?? 0) - (p.scene.audioLead ?? 0);
    return p.start + Math.max(-prev.duration / 2, Math.min(p.duration / 2, shift));
  });
  const fade = scenes.map((p, i) => {
    const prev = scenes[i - 1];
    if (!prev) return 0;
    const jl = (prev.scene.audioTail ?? 0) > 0 || (p.scene.audioLead ?? 0) > 0;
    // A transition's length, a J/L-cut's crossfade, or the short crossfade every hard cut gets.
    const want = p.scene.transition
      ? Math.min(1, p.scene.transition.duration)
      : jl
        ? jlFade
        : (p.scene.crossfade ?? cutFade);
    return Math.min(want, prev.duration / 2, p.duration / 2);
  });
  const plan = scenes.map((placed, i) => ({
    placed,
    from: handover[i]!,
    to: i + 1 < scenes.length ? handover[i + 1]! : timeline.duration,
    fadeIn: fade[i]!,
    fadeOut: fade[i + 1] ?? 0,
  }));
  byFade.set(key, plan);
  audioCache.set(timeline, byFade);
  return plan;
}

/** The source time playing at output time `t` in a shot (which can be outside its in/out, in a J/L-cut). */
export const sourceTime = (p: PlacedScene, t: number) =>
  p.scene.ramp?.length
    ? p.scene.in + sourceOffset(p.scene, t - p.start)
    : p.scene.in + (t - p.start) * (p.scene.speed ?? 1);

/** Absolute output time of an anchor, or null if its scene is gone. Offsets clamp to the scene. */
export function resolveAnchor(timeline: Timeline, anchor: Anchor): number | null {
  const placed = timeline.byId.get(anchor.scene);
  if (!placed) return null;
  return placed.start + Math.min(anchor.at, placed.duration);
}

/** The scene playing at output time `t` (last scene for t past the end). */
export function sceneAt(timeline: Timeline, t: number): PlacedScene | undefined {
  const { scenes } = timeline;
  let lo = 0;
  let hi = scenes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (scenes[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  return scenes[lo];
}

/** Anchor for an absolute time: the inverse of resolveAnchor. */
export function anchorAt(timeline: Timeline, t: number): Anchor | null {
  const placed = sceneAt(timeline, t);
  if (!placed) return null;
  return { scene: placed.scene.id, at: round(Math.max(0, t - placed.start)) };
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Something anchored with a duration, that may instead last a stretch or the whole video (an overlay). */
export interface Anchored {
  readonly anchor: Anchor;
  readonly duration: number;
  readonly whole?: boolean | undefined;
  readonly until?: Anchor | "end" | undefined;
}

/**
 * Absolute span of anything anchored: from its anchor for its duration, or to its `until` moment, or the
 * whole video. A stretch whose end has gone (its shot removed) or now comes first (a reorder) falls back
 * to its duration.
 */
export function spanOf(timeline: Timeline, item: Anchored): Span | null {
  if (item.whole) return timeline.duration > 0 ? { start: 0, end: timeline.duration } : null;
  const start = resolveAnchor(timeline, item.anchor);
  if (start === null) return null;
  const until =
    item.until === "end" ? timeline.duration : item.until ? resolveAnchor(timeline, item.until) : null;
  const end = until !== null && until > start ? until : start + item.duration;
  return { start, end: Math.min(end, timeline.duration) };
}

/** Whether an overlay lasts beyond a moment (a stretch or the whole video): it frames the video, it isn't an event in it. */
export const lasting = (item: Pick<Anchored, "whole" | "until">): boolean =>
  !!item.whole || item.until !== undefined;

export const round = (n: number, places = 3): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function formatTime(seconds: number, tenths = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const ss = tenths ? rest.toFixed(1).padStart(4, "0") : String(Math.floor(rest)).padStart(2, "0");
  return `${m}:${ss}`;
}

/** Waveform resolution the indexer writes (one byte per 20 ms). Shared so drawing and measuring agree. */
export const PEAKS_PER_SECOND = 50;
