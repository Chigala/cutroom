/**
 * A graphic on its own: a copy of the project cut down to one shot with that graphic on it, so the
 * agent (and the graphic editor) can see a graphic move without touching the user's timeline. The
 * shot's speech captions stay, since a graphic has to live with them.
 */

import { graphicParams, parseGraphic } from "./graphic.ts";
import type { ProjectDoc, Visual } from "./schema.ts";

export interface GraphicPreview {
  readonly graphic: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly layout?: Visual["layout"];
  /** Seconds; the graphic's own suggested length when omitted. */
  readonly duration?: number;
}

/** The preview project and the graphic's length, or null when the graphic or footage is missing. */
export function graphicPreviewDoc(
  doc: ProjectDoc,
  p: GraphicPreview,
): { doc: ProjectDoc; duration: number } | null {
  const graphic = doc.graphics.find((g) => g.id === p.graphic);
  // The first shot of video, preferably one with a face to frame against.
  const faces = new Set(doc.analyses.filter((a) => a.face).map((a) => a.id));
  const isVideo = (id: string) => doc.sources.some((s) => s.id === id && s.kind === "video");
  const shot =
    doc.scenes.find((s) => isVideo(s.source) && faces.has(s.source)) ??
    doc.scenes.find((s) => isVideo(s.source)) ??
    doc.scenes[0];
  if (!graphic || !shot) return null;
  const meta = parseGraphic(graphic.html).meta;
  const duration = Math.min(15, Math.max(0.5, p.duration ?? meta.duration));
  const source = doc.sources.find((s) => s.id === shot.source);
  const room = source?.kind === "video" || source?.kind === "audio" ? source.duration - shot.in : Infinity;
  const length = Math.max(shot.out - shot.in, Math.min(room, duration + 0.5));
  const visual: Visual = {
    id: "preview",
    anchor: { scene: shot.id, at: 0 },
    duration,
    layout: p.layout ?? "overlay",
    content: { kind: "graphic", graphic: graphic.id, params: graphicParams(meta, p.params ?? {}) },
    sfx: "none",
  };
  return {
    duration,
    doc: {
      ...doc,
      scenes: [{ ...shot, out: shot.in + length }],
      visuals: [visual],
      titles: [],
      zooms: [],
      effects: [],
      sfx: [],
      captions: [],
      comments: [],
      music: { ...doc.music, source: null },
    },
  };
}
