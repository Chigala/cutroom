export { type CompositionProps, coverBox, FONT_STACK, VideoComposition } from "./Composition.tsx";
export { CoverComposition, type CoverProps, coverMoment } from "./Cover.tsx";
export { type FontSource, fontSources, projectFontSources } from "./fonts.ts";
export * from "./frames.ts";
export { GraphicView, type GraphicViewProps, HOUSE_EASE } from "./GraphicView.tsx";

import { type ProjectDoc, timelineOf } from "@vedit/project";

/** Player/render metadata for a doc. At least one frame, so an empty project still mounts. */
export function compositionMeta(doc: ProjectDoc) {
  const { width, height, fps } = doc.meta.format;
  return { width, height, fps, durationInFrames: Math.max(1, Math.round(timelineOf(doc).duration * fps)) };
}
