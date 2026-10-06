export { type CompositionProps, coverBox, FONT_STACK, VideoComposition } from "./Composition.tsx";
export { CoverComposition, type CoverProps, coverMoment } from "./Cover.tsx";
export { type FontSource, fontSources, projectFontSources } from "./fonts.ts";
export * from "./frames.ts";
export { GraphicView, type GraphicViewProps, HOUSE_EASE } from "./GraphicView.tsx";

import { type ProjectDoc, timelineOf } from "@vedit/project";

/** Player/render metadata for a doc. At least one frame, so an empty project still mounts. */
/**
 * The composition's size, rate and length, always valid numbers: the player refuses (and stops the whole
 * window) on a NaN or a zero, whatever a broken edit might hold.
 */
export function compositionMeta(doc: ProjectDoc) {
  const whole = (n: number, fallback: number) => (Number.isFinite(n) && n >= 1 ? Math.round(n) : fallback);
  const { width, height, fps } = doc.meta.format;
  const rate = whole(fps, 30);
  return {
    width: whole(width, 1080),
    height: whole(height, 1920),
    fps: rate,
    durationInFrames: whole(timelineOf(doc).duration * rate, 1),
  };
}
