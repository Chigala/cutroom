/**
 * One clock for the whole editor. The Remotion player drives it; the timeline, time readout and story
 * list follow it. Per-frame consumers subscribe outside React (see useFrameEffect) and write to the DOM
 * directly, so playback never re-renders the app.
 */
import type { PlayerRef } from "@remotion/player";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createStore, useStore } from "zustand";

interface PlaybackState {
  frame: number;
  playing: boolean;
  fps: number;
  durationInFrames: number;
}

export const playback = createStore<PlaybackState>()(() => ({
  frame: 0,
  playing: false,
  fps: 30,
  durationInFrames: 1,
}));

/** Coarse subscriptions (playing, fps). Do not select `frame` here: use useFrameEffect. */
export const usePlayback = <T>(select: (s: PlaybackState) => T): T => useStore(playback, select);

/**
 * Runs `effect(frame)` on every frame change without rendering, and again after each render so it sees
 * fresh props. Effects should only write to refs or set state that bails out when unchanged.
 */
export function useFrameEffect(effect: (frame: number, s: PlaybackState) => void): void {
  const latest = useRef(effect);
  useLayoutEffect(() => {
    latest.current = effect;
    const s = playback.getState();
    effect(s.frame, s);
  });
  useEffect(
    () =>
      playback.subscribe((s, prev) => {
        if (s.frame !== prev.frame || s.durationInFrames !== prev.durationInFrames)
          latest.current(s.frame, s);
      }),
    [],
  );
}

let player: PlayerRef | null = null;

export function attachPlayer(ref: PlayerRef | null): () => void {
  player = ref;
  if (!ref) return () => {};
  const onFrame = (e: { detail: { frame: number } }) => playback.setState({ frame: e.detail.frame });
  const onPlay = () => playback.setState({ playing: true });
  const onPause = () => playback.setState({ playing: false });
  ref.addEventListener("frameupdate", onFrame);
  ref.addEventListener("seeked", onFrame);
  ref.addEventListener("play", onPlay);
  ref.addEventListener("pause", onPause);
  ref.addEventListener("ended", onPause);
  return () => {
    ref.removeEventListener("frameupdate", onFrame);
    ref.removeEventListener("seeked", onFrame);
    ref.removeEventListener("play", onPlay);
    ref.removeEventListener("pause", onPause);
    ref.removeEventListener("ended", onPause);
    if (player === ref) player = null;
  };
}

const clampFrame = (f: number) =>
  Math.max(0, Math.min(Math.round(f), playback.getState().durationInFrames - 1));

export function seekFrame(frame: number): void {
  const f = clampFrame(frame);
  playback.setState({ frame: f });
  player?.seekTo(f);
}

export const seekTime = (seconds: number) => seekFrame(seconds * playback.getState().fps);
export const currentTime = () => playback.getState().frame / playback.getState().fps;

export function togglePlay(): void {
  player?.toggle();
}

export function pause(): void {
  player?.pause();
}

export function step(frames: number): void {
  pause();
  seekFrame(playback.getState().frame + frames);
}

/** Held this long, an arrow key stops stepping and starts moving the playhead. */
const HOLD_DELAY = 0.3;
/** The speed doubles every this many seconds of holding, up to the top speed. */
const DOUBLING = 0.8;

let held: { dir: 1 | -1; fast: boolean; since: number; last: number; pos: number; raf: number } | null = null;

/**
 * ← or → pressed: a tap steps one frame (Shift: one second), as editors do. Held, the playhead starts
 * moving at normal speed after a moment and speeds up the longer it's held: 1× doubling to 8× (Shift:
 * 4× to 16×). The key's own repeats only update the direction; releaseStep stops it.
 */
export function holdStep(dir: 1 | -1, fast: boolean): void {
  if (held) {
    held.dir = dir;
    held.fast = fast;
    return;
  }
  const { fps } = playback.getState();
  step(dir * (fast ? fps : 1));
  const now = performance.now();
  held = { dir, fast, since: now, last: now, pos: playback.getState().frame, raf: 0 };
  const tick = (t: number) => {
    const h = held;
    if (!h) return;
    const dt = Math.min(0.1, (t - h.last) / 1000);
    h.last = t;
    const holding = (t - h.since) / 1000 - HOLD_DELAY;
    if (holding > 0) {
      const top = h.fast ? 16 : 8;
      const speed = Math.min(top, (h.fast ? 4 : 1) * 2 ** (holding / DOUBLING));
      h.pos = Math.max(
        0,
        Math.min(playback.getState().durationInFrames - 1, h.pos + h.dir * speed * fps * dt),
      );
      const f = Math.round(h.pos);
      if (f !== playback.getState().frame) seekFrame(f);
    }
    h.raf = requestAnimationFrame(tick);
  };
  held.raf = requestAnimationFrame(tick);
}

export function releaseStep(): void {
  if (held) cancelAnimationFrame(held.raf);
  held = null;
}
