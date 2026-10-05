/**
 * Motion tracking: where each face (and each person) is, frame by frame, over a stretch of a clip.
 * Apple's Vision framework detects faces and bodies on frames sampled from the preview copy; detections
 * are linked into tracks (nearest centre, same kind), broken at shot changes, and smoothed. Run on
 * demand over the stretch an edit actually uses, not over whole clips. macOS only (elsewhere: no tracks).
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./exec.ts";

export interface TrackPoint {
  /** Seconds, source time. */
  readonly t: number;
  /** Centre and size, as fractions of the frame (top-left origin). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Track {
  readonly id: string;
  readonly kind: "face" | "person";
  readonly start: number;
  readonly end: number;
  readonly points: readonly TrackPoint[];
}

interface Detection {
  readonly k: "face" | "person";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const VISION = `
ObjC.import("Foundation");
ObjC.import("Vision");
function boxes(results, k) {
  const out = [];
  for (let i = 0; i < results.count; i++) {
    const b = results.objectAtIndex(i).boundingBox;
    out.push({ k, x: b.origin.x + b.size.width / 2, y: 1 - (b.origin.y + b.size.height / 2), w: b.size.width, h: b.size.height });
  }
  return out;
}
function run(argv) {
  const frames = [];
  for (const file of argv) {
    const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(file), $());
    const faces = $.VNDetectFaceRectanglesRequest.alloc.init;
    const people = $.VNDetectHumanRectanglesRequest.alloc.init;
    handler.performRequestsError($([faces, people]), null);
    frames.push(boxes(faces.results, "face").concat(boxes(people.results, "person")));
  }
  return JSON.stringify(frames);
}
`;

/** Detections per sampled frame over [from, to) of `video`, at `rate` frames a second. */
async function detect(
  video: string,
  from: number,
  to: number,
  rate: number,
  signal?: AbortSignal,
): Promise<{ times: number[]; frames: Detection[][] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-track-"));
  try {
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        String(from),
        "-t",
        String(Math.max(0.1, to - from)),
        "-i",
        video,
        "-vf",
        `fps=${rate},scale=640:-2`,
        "-q:v",
        "4",
        path.join(dir, "%05d.jpg"),
      ],
      signal ? { signal } : {},
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    if (!files.length) return { times: [], frames: [] };
    const script = path.join(dir, "track.js");
    await writeFile(script, VISION);
    const { stdout } = await run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", script, ...files.map((f) => path.join(dir, f))],
      signal ? { signal } : {},
    );
    const frames = JSON.parse(stdout.trim()) as Detection[][];
    return { times: files.map((_, i) => from + i / rate), frames };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Links detections into tracks: each detection continues the nearest open track of its kind, if it's
 * close enough for the time that passed; a track ends after a short gap or at a shot change.
 */
export function linkTracks(
  times: readonly number[],
  frames: readonly (readonly Detection[])[],
  cuts: readonly number[] = [],
  idPrefix = "t",
): Track[] {
  interface Open {
    kind: Detection["k"];
    points: TrackPoint[];
    missed: number;
  }
  const done: Open[] = [];
  let open: Open[] = [];
  const shotOf = (t: number) => cuts.filter((c) => c <= t).length;
  times.forEach((t, i) => {
    // A shot change ends every track: a new angle is a new shot.
    if (i > 0 && shotOf(t) !== shotOf(times[i - 1]!)) {
      done.push(...open);
      open = [];
    }
    // Match every detection to an open track at once, cheapest pairs first, so two faces crossing or
    // hugging don't swap identities. Cost: distance in face widths, plus a change in size.
    const taken = new Set<Open>();
    const dets = [...(frames[i] ?? [])];
    const pairs: { tr: Open; d: number; cost: number }[] = [];
    dets.forEach((d, di) => {
      for (const tr of open) {
        if (tr.kind !== d.k) continue;
        const last = tr.points.at(-1)!;
        const dist = Math.hypot(last.x - d.x, last.y - d.y);
        const reach = 0.08 + Math.max(last.w, d.w) * 0.6 + tr.missed * 0.04;
        if (dist >= reach) continue;
        const size = Math.abs(Math.log(Math.max(1e-3, d.w) / Math.max(1e-3, last.w)));
        pairs.push({ tr, d: di, cost: dist / Math.max(0.02, last.w) + size * 2 });
      }
    });
    pairs.sort((a, b) => a.cost - b.cost);
    const used = new Set<number>();
    for (const p of pairs) {
      if (used.has(p.d) || taken.has(p.tr)) continue;
      const d = dets[p.d]!;
      p.tr.points.push({ t, x: d.x, y: d.y, w: d.w, h: d.h });
      p.tr.missed = 0;
      taken.add(p.tr);
      used.add(p.d);
    }
    dets.forEach((d, di) => {
      if (used.has(di)) return;
      const tr: Open = { kind: d.k, points: [{ t, x: d.x, y: d.y, w: d.w, h: d.h }], missed: 0 };
      open.push(tr);
      taken.add(tr);
    });
    for (const tr of open) if (!taken.has(tr)) tr.missed++;
    done.push(...open.filter((tr) => tr.missed > 3));
    open = open.filter((tr) => tr.missed <= 3);
  });
  done.push(...open);
  return done
    .filter((tr) => tr.points.length >= 3)
    .sort((a, b) => a.points[0]!.t - b.points[0]!.t)
    .map((tr, n) => {
      const points = smooth(tr.points);
      return { id: `${idPrefix}${n + 1}`, kind: tr.kind, start: points[0]!.t, end: points.at(-1)!.t, points };
    });
}

/**
 * A centred moving average over three samples: enough to calm detection jitter, short enough (0.2s at
 * 15 a second) that a tag keeps up with a fast pan instead of trailing it.
 */
function smooth(points: readonly TrackPoint[]): TrackPoint[] {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return points.map((p, i) => {
    const win = points.slice(Math.max(0, i - 1), i + 2);
    const avg = (k: "x" | "y" | "w" | "h") => win.reduce((s, q) => s + q[k], 0) / win.length;
    return { t: r(p.t), x: r(avg("x")), y: r(avg("y")), w: r(avg("w")), h: r(avg("h")) };
  });
}

/** Tracks over [from, to) of a clip's preview copy. `cuts` are its shot changes, source time. */
export async function trackRange(
  video: string,
  from: number,
  to: number,
  {
    cuts = [],
    rate = 15,
    idPrefix = "t",
    signal,
  }: {
    cuts?: readonly number[];
    rate?: number;
    idPrefix?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Track[]> {
  if (process.platform !== "darwin" || to <= from) return [];
  const { times, frames } = await detect(video, from, to, rate, signal);
  return linkTracks(times, frames, cuts, idPrefix);
}
