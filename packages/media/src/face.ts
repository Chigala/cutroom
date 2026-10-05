/**
 * Where the speaker's face sits, via Apple's Vision framework (ported from tiktok-studio's cli/face.js).
 * Runs on a handful of frames and keeps the median, so one turned head doesn't move the framing.
 * macOS only: elsewhere it returns null and framing falls back to the frame's upper middle.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./exec.ts";
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
  if (process.platform !== "darwin" || duration <= 0) return null;
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
