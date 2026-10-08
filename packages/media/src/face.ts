/**
 * Where the speaker's face sits, via Apple's Vision framework (ported from tiktok-studio's cli/face.js).
 * Runs on a handful of frames and keeps the median, so one turned head doesn't move the framing.
 * Off macOS, the open face detector does it (vision.ts). Null when no face is clear enough, and framing
 * falls back to the frame's upper middle.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./exec.ts";
import { useOpenModels } from "./models.ts";
import { grabFrame } from "./transcode.ts";

const VISION = `
ObjC.import("Foundation");
ObjC.import("Vision");
function median(v) { const s = v.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function run(argv) {
  const xs = [], ys = [], sizes = [];
  for (const file of argv) {
    const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(file), $());
    const request = $.VNDetectFaceRectanglesRequest.alloc.init;
    handler.performRequestsError($([request]), null);
    let best = null;
    for (let i = 0; i < request.results.count; i++) {
      const box = request.results.objectAtIndex(i).boundingBox;
      if (!best || box.size.width > best.size.width) best = box;
    }
    if (best) {
      xs.push(best.origin.x + best.size.width / 2);
      ys.push(1 - (best.origin.y + best.size.height / 2));
      sizes.push(best.size.width);
    }
  }
  if (xs.length < Math.max(1, Math.floor(argv.length / 2))) return "null";
  return JSON.stringify({ x: median(xs), y: median(ys), size: median(sizes) });
}
`;

export interface Face {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export async function detectFace(
  video: string,
  duration: number,
  signal?: AbortSignal,
): Promise<Face | null> {
  if (duration <= 0) return null;
  if (useOpenModels()) return openModelFace(video, duration, signal);
  if (process.platform !== "darwin") return null;
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-face-"));
  try {
    const frames: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const file = path.join(dir, `f${i}.jpg`);
      await writeFile(file, await grabFrame(video, (duration * i) / 6, 540, signal));
      frames.push(file);
    }
    const script = path.join(dir, "face.js");
    await writeFile(script, VISION);
    const { stdout } = await run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", script, ...frames],
      signal ? { signal } : {},
    );
    const face = JSON.parse(stdout.trim()) as Face | null;
    if (!face) return null;
    const r = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    return { x: r(face.x), y: r(face.y), size: r(face.size) };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

/** The same, with the open face detector: the biggest face on five stills, the median of them. */
async function openModelFace(video: string, duration: number, signal?: AbortSignal): Promise<Face | null> {
  try {
    const { facesAt } = await import("./vision.ts");
    const times = [1, 2, 3, 4, 5].map((i) => (duration * i) / 6);
    const found = (await facesAt(video, times, signal)).filter((f) => f !== null);
    // A face on at least half the stills, as with Vision: one lucky frame doesn't set the framing.
    if (found.length < Math.max(1, Math.floor(times.length / 2))) return null;
    const r = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    return {
      x: r(median(found.map((f) => f.x))),
      y: r(median(found.map((f) => f.y))),
      size: r(median(found.map((f) => f.size))),
    };
  } catch (err) {
    console.warn("[face] the open face detector failed:", (err as Error).message);
    return null;
  }
}

/** Each frame's biggest face, none where there's none: Vision on a list of stills, one answer each. */
const VISION_EACH = `
ObjC.import("Foundation");
ObjC.import("Vision");
function run(argv) {
  const out = [];
  for (const file of argv) {
    const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(file), $());
    const request = $.VNDetectFaceRectanglesRequest.alloc.init;
    handler.performRequestsError($([request]), null);
    let best = null;
    for (let i = 0; i < request.results.count; i++) {
      const box = request.results.objectAtIndex(i).boundingBox;
      if (!best || box.size.width > best.size.width) best = box;
    }
    out.push(best ? { x: best.origin.x + best.size.width / 2, y: 1 - (best.origin.y + best.size.height / 2), size: best.size.width } : null);
  }
  return JSON.stringify(out);
}
`;

/**
 * The biggest face in a clip at each of `times` (null where there's none): how the framing changes
 * across a cut. Vision on a Mac, the open face detector elsewhere.
 */
export async function facesAtTimes(
  video: string,
  times: readonly number[],
  signal?: AbortSignal,
): Promise<(Face | null)[]> {
  if (!times.length) return [];
  if (useOpenModels()) {
    const { facesAt } = await import("./vision.ts");
    return facesAt(video, times, signal);
  }
  if (process.platform !== "darwin") return times.map(() => null);
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-faces-"));
  try {
    const frames: string[] = [];
    for (const [i, t] of times.entries()) {
      const file = path.join(dir, `f${i}.jpg`);
      await writeFile(file, await grabFrame(video, t, 540, signal));
      frames.push(file);
    }
    const script = path.join(dir, "faces.js");
    await writeFile(script, VISION_EACH);
    const { stdout } = await run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", script, ...frames],
      signal ? { signal } : {},
    );
    return JSON.parse(stdout.trim()) as (Face | null)[];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
