import { type Span, spanOf, type Timeline } from "@vedit/project";

/** Frame where output time `t` starts. Rounded once, here, so adjacent items never gap or overlap. */
export const toFrame = (t: number, fps: number) => Math.round(t * fps);

export interface FrameSpan {
  readonly from: number;
  readonly durationInFrames: number;
}

export function frameSpan(span: Span, fps: number): FrameSpan {
  const from = toFrame(span.start, fps);
  return { from, durationInFrames: Math.max(1, toFrame(span.end, fps) - from) };
}

export interface Timed<T> extends FrameSpan {
  readonly item: T;
}

/** Resolves anchored items to frame spans, dropping ones whose scene is gone. Sorted by start. */
export function placeAll<T extends { anchor: { scene: string; at: number }; duration: number }>(
  tl: Timeline,
  items: readonly T[],
  fps: number,
): Timed<T>[] {
  const out: Timed<T>[] = [];
  for (const item of items) {
    const span = spanOf(tl, item);
    if (span && span.end > span.start) out.push({ item, ...frameSpan(span, fps) });
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * Beat lock: each item's first and last frame moves onto the nearest beat when one is within `tolerance`
 * frames (motion and hits that are nearly on the beat land exactly on it; ones placed elsewhere on
 * purpose, like on a spoken word, stay). Never shorter than a frame.
 */
export function lockToBeats<T>(
  items: readonly Timed<T>[],
  beats: readonly number[],
  tolerance: number,
): Timed<T>[] {
  if (!beats.length || tolerance < 1) return [...items];
  const snap = (f: number) => {
    let lo = 0;
    let hi = beats.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid]! <= f) lo = mid;
      else hi = mid;
    }
    const near = Math.abs(beats[lo]! - f) <= Math.abs(beats[hi]! - f) ? beats[lo]! : beats[hi]!;
    return Math.abs(near - f) <= tolerance ? near : f;
  };
  return items
    .map((t) => {
      const from = snap(t.from);
      const end = snap(t.from + t.durationInFrames);
      return { ...t, from, durationInFrames: Math.max(1, end - from) };
    })
    .sort((a, b) => a.from - b.from);
}

export const isActive = (t: FrameSpan, frame: number) =>
  frame >= t.from && frame < t.from + t.durationInFrames;
