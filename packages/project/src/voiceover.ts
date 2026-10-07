/**
 * Voiceovers placed in the cut (audio/voiceovers.json): where each is heard, and how far the shots' own
 * sound steps back under it. The preview, the export's voice mix and the captions all read it from here,
 * so they agree on every frame.
 */
import type { ProjectDoc, Voiceover } from "./schema.ts";
import { spanOf, type Timeline } from "./time.ts";

export interface PlacedVoice {
  readonly item: Voiceover;
  /** Output seconds. */
  readonly start: number;
  readonly end: number;
}

/** Each voiceover where it's heard, in order. One whose shot is gone is left out. */
export function voicePlan(doc: Partial<Pick<ProjectDoc, "voiceovers">>, tl: Timeline): PlacedVoice[] {
  return (doc.voiceovers ?? [])
    .flatMap((item) => {
      const span = spanOf(tl, item);
      return span && span.end > span.start ? [{ item, ...span }] : [];
    })
    .sort((a, b) => a.start - b.start);
}

/** Seconds the shots' sound takes to step back before a voiceover, and to come back after it. */
export const DUCK_RAMP = 0.25;

/**
 * How loud the shots' own sound is at output time `t`: full, or down to a voiceover's duck while it
 * speaks, easing down just before it and back up just after.
 */
export function duckAt(plan: readonly PlacedVoice[], t: number): number {
  let gain = 1;
  for (const v of plan) {
    if (t <= v.start - DUCK_RAMP || t >= v.end + DUCK_RAMP) continue;
    const into = Math.min(1, (t - (v.start - DUCK_RAMP)) / DUCK_RAMP, (v.end + DUCK_RAMP - t) / DUCK_RAMP);
    gain = Math.min(gain, 1 - (1 - v.item.duck) * into);
  }
  return gain;
}

/** Below this, a shot's own speech is background under a voiceover: its words aren't captioned there. */
export const UNHEARD = 0.5;
