/**
 * How the timeline is viewed: zoom (1 fits the whole video), where the view starts (seconds), and a
 * stretch selected on the ruler, which goes to the agent with the next request ("tighten this").
 */
import { create } from "zustand";

export interface TimelineView {
  /** 1 fits the whole video in the width; 2 shows half of it... */
  zoom: number;
  /** The time at the view's left edge, in seconds. */
  start: number;
  /** A stretch of the video selected on the ruler, in seconds. */
  range: { start: number; end: number } | null;
  /** Pixels per second at zoom 1, and the track's width: set by the timeline as it lays out. */
  fitPps: number;
  width: number;
}

export const MAX_ZOOM = 60;

export const useTimeline = create<TimelineView>()(() => ({
  zoom: 1,
  start: 0,
  range: null,
  fitPps: 0,
  width: 0,
}));

/** Zooms by a factor around a time (the playhead, for the keyboard), keeping it where it is on screen. */
export function zoomBy(factor: number, time: number): void {
  const { zoom, start, fitPps, width } = useTimeline.getState();
  if (!fitPps) return;
  const pps = fitPps * zoom;
  const x = Math.max(0, Math.min(width, (time - start) * pps));
  zoomTo(zoom * factor, { time, x }, fitPps);
}

/** Zooms to `zoom`, keeping the time at `atX` px from the view's left edge where it is. */
export function zoomTo(zoom: number, around?: { time: number; x: number }, fitPps?: number): void {
  const z = Math.max(1, Math.min(MAX_ZOOM, zoom));
  useTimeline.setState((s) => {
    if (!around || !fitPps) return { zoom: z, start: z === 1 ? 0 : s.start };
    // The time under the cursor stays under the cursor.
    return { zoom: z, start: Math.max(0, around.time - around.x / (fitPps * z)) };
  });
}

export const fitTimeline = () => useTimeline.setState({ zoom: 1, start: 0 });

export const setRange = (range: TimelineView["range"]) => useTimeline.setState({ range });
