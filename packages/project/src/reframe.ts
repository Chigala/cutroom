/**
 * One edit, every shape: the same cut rendered 9:16, 4:5, 1:1 or 16:9, each shot reframed on the person
 * in it. A shot is framed on where its face is (from the clip's face tracks over the shot's stretch,
 * else the clip's usual face), and with look.reframe "follow" the frame pans with them, smoothly.
 */
import { sourceOffset } from "./motion.ts";
import type { Analysis, Format, ProjectDoc, Scene } from "./schema.ts";

export const SHAPES = ["9:16", "4:5", "1:1", "16:9"] as const;
export type Shape = (typeof SHAPES)[number];

/** A shape at the project's size: the short side kept, the long side set by the shape (even pixels). */
export function shapeSize(
  format: Pick<Format, "width" | "height">,
  shape: Shape,
): { width: number; height: number } {
  const short = Math.min(format.width, format.height);
  const [w, h] = shape.split(":").map(Number) as [number, number];
  const even = (n: number) => Math.round(n / 2) * 2;
  return w >= h
    ? { width: even((short * w) / h), height: short }
    : { width: short, height: even((short * h) / w) };
}

/** The project's own shape, when it is one of the shapes (else null). */
export function shapeOf(format: Pick<Format, "width" | "height">): Shape | null {
  const r = format.width / format.height;
  return (
    SHAPES.find((s) => {
      const [w, h] = s.split(":").map(Number) as [number, number];
      return Math.abs(w / h - r) < 0.01;
    }) ?? null
  );
}

export interface Focus {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** The face tracked longest (and largest) over [from, to] of a clip, as its points there. */
function mainFace(analysis: Pick<Analysis, "tracks"> | undefined, from: number, to: number) {
  let best: { t: number; x: number; y: number; w: number }[] | null = null;
  let score = 0;
  for (const track of analysis?.tracks ?? []) {
    if (track.kind !== "face" || track.end < from || track.start > to) continue;
    const pts = track.points.filter((p) => p.t >= from - 0.05 && p.t <= to + 0.05);
    if (!pts.length) continue;
    const s = pts.length * (pts.reduce((a, p) => a + p.w, 0) / pts.length);
    if (s > score) {
      score = s;
      best = pts;
    }
  }
  return best;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Where the person is over a shot's stretch of its clip: its main tracked face, else the clip's usual face. */
export function shotFace(
  analysis: Pick<Analysis, "tracks" | "face"> | undefined,
  from: number,
  to: number,
): Focus | undefined {
  const pts = mainFace(analysis, from, to);
  if (pts && pts.length >= 3)
    return {
      x: median(pts.map((p) => p.x)),
      y: median(pts.map((p) => p.y)),
      size: median(pts.map((p) => p.w)),
    };
  return analysis?.face;
}

/**
 * Where a shot's frame centres for another shape: on its person (shotFace), else, for a shot with nobody
 * in it (b-roll, a product, scenery), on where the eye goes over the shot: the middle of what draws
 * attention, from the clip's saliency.
 */
export function shotFocus(
  analysis: Pick<Analysis, "tracks" | "face" | "salient"> | undefined,
  from: number,
  to: number,
): Focus | undefined {
  const face = shotFace(analysis, from, to);
  if (face) return face;
  const seen = (analysis?.salient ?? []).filter((s) => s.t >= from - 0.5 && s.t <= to + 0.5);
  if (!seen.length) return undefined;
  return {
    x: median(seen.map((s) => s.x + s.w / 2)),
    y: median(seen.map((s) => s.y + s.h / 2)),
    size: 0.3,
  };
}

/**
 * The face's place frame by frame through a shot, for a frame that follows the person: the track,
 * smoothed (about half a second), then followed like a camera operator would, holding still until the
 * person drifts out of a small dead zone and easing after them. Null without a face track.
 */
export function followPath(
  analysis: Pick<Analysis, "tracks"> | undefined,
  scene: Pick<Scene, "in" | "out" | "speed" | "ramp">,
  fps: number,
  frames: number,
  /** look.follow: smoothing (s), dead zone (share of the frame) and catch-up speed per frame. */
  follow: { smooth: number; deadZone: number; speed: number } = {
    smooth: 0.35,
    deadZone: 0.035,
    speed: 0.12,
  },
): { x: Float32Array; y: Float32Array } | null {
  const pts = mainFace(analysis, scene.in, scene.out);
  if (!pts || pts.length < 3) return null;
  const sigma = follow.smooth;
  const at = (s: number, key: "x" | "y") => {
    let sum = 0;
    let w = 0;
    for (const p of pts) {
      const d = p.t - s;
      if (Math.abs(d) > 3 * sigma) continue;
      const k = Math.exp(-(d * d) / (2 * sigma * sigma));
      sum += p[key] * k;
      w += k;
    }
    if (w > 0) return sum / w;
    // Outside the track: hold its nearest end.
    return (s < pts[0]!.t ? pts[0]! : pts.at(-1)!)[key];
  };
  const x = new Float32Array(frames);
  const y = new Float32Array(frames);
  const dead = follow.deadZone;
  let cx = at(scene.in + sourceOffset(scene, 0), "x");
  let cy = at(scene.in + sourceOffset(scene, 0), "y");
  for (let f = 0; f < frames; f++) {
    const s = scene.in + sourceOffset(scene, f / fps);
    const tx = at(s, "x");
    const ty = at(s, "y");
    const dx = tx - cx;
    const dy = ty - cy;
    if (Math.abs(dx) > dead) cx += (dx - Math.sign(dx) * dead) * follow.speed;
    if (Math.abs(dy) > dead) cy += (dy - Math.sign(dy) * dead) * follow.speed;
    x[f] = cx;
    y[f] = cy;
  }
  return { x, y };
}

/**
 * How footage fills a frame of another shape (look.fit): cover crops to fill; fit shows all of it over a
 * blurred, darkened copy of itself; auto crops, except portrait footage in a landscape frame, which
 * cropping would cut through the head.
 */
export function fitsInside(
  fit: "auto" | "cover" | "fit",
  source: { width?: number | undefined; height?: number | undefined },
  frame: { width: number; height: number },
): boolean {
  if (fit === "cover" || !source.width || !source.height) return false;
  if (fit === "fit") return true;
  return source.height > source.width * 1.05 && frame.width > frame.height * 1.05;
}

/**
 * The part of a shot's clip that shows in the frame, as shares of the clip's picture: filling the frame
 * (cropped to the project's shape), centred on the shot's framing or its focus (shotFocus), zoomed by the
 * framing's scale. Zooms and camera moves over the shot aren't counted. Null without the clip's size.
 */
export function frameWindow(
  doc: Pick<ProjectDoc, "meta" | "sources" | "analyses">,
  scene: Pick<Scene, "source" | "in" | "out" | "framing">,
): { x: number; y: number; w: number; h: number } | null {
  const src = doc.sources.find((s) => s.id === scene.source);
  if (!src?.width || !src.height) return null;
  const srcAspect = src.width / src.height;
  const outAspect = doc.meta.format.width / doc.meta.format.height;
  const scale = scene.framing?.scale ?? 1;
  const w = (srcAspect > outAspect ? outAspect / srcAspect : 1) / scale;
  const h = (srcAspect > outAspect ? 1 : srcAspect / outAspect) / scale;
  const focus =
    scene.framing ??
    shotFocus(
      doc.analyses.find((a) => a.id === scene.source),
      scene.in,
      scene.out,
    );
  const cx = focus?.x ?? 0.5;
  const cy = focus?.y ?? 0.5;
  const clamp = (v: number, size: number) => Math.min(1 - size, Math.max(0, v - size / 2));
  return { x: clamp(cx, w), y: clamp(cy, h), w, h };
}

/** A box on a clip's picture (shares, from the top left) as it lands in the frame; null when it's cropped away. */
export function toFrame(
  win: { x: number; y: number; w: number; h: number },
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const x1 = Math.max(0, (box.x - win.x) / win.w);
  const y1 = Math.max(0, (box.y - win.y) / win.h);
  const x2 = Math.min(1, (box.x + box.w - win.x) / win.w);
  const y2 = Math.min(1, (box.y + box.h - win.y) / win.h);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}
