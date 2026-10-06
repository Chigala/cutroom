/**
 * Seeing without Apple's frameworks: faces (YuNet), people (YOLOX-Nano) and the person's alpha (Robust
 * Video Matting) on ONNX Runtime (models.ts). Frames come straight out of ffmpeg as raw pixels, one at a
 * time, so a long stretch never sits in memory. What comes out matches what the Vision paths give:
 * boxes as fractions of the frame, and one matte per frame, white where the person is.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type * as Ort from "onnxruntime-node";
import { CancelledError, findBinary, run } from "./exec.ts";
import { onnx, session } from "./models.ts";
import { probe } from "./probe.ts";

/** A box found in a frame: its centre and size as fractions of the frame (top-left origin). */
export interface Box {
  readonly k: "face" | "person";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly score: number;
}

/**
 * Raw frames from ffmpeg (`args` are its input and filter options; the output is raw `pixFmt`), one
 * buffer of `frameBytes` per frame, in order. Reading pauses ffmpeg while a frame is being worked on.
 */
export async function* rawFrames(
  args: readonly string[],
  frameBytes: number,
  pixFmt: "rgb24" | "gray" = "rgb24",
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  if (signal?.aborted) throw new CancelledError();
  const child = spawn(
    await findBinary("ffmpeg"),
    ["-v", "error", ...args, "-f", "rawvideo", "-pix_fmt", pixFmt, "-"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  const exited = once(child, "close") as Promise<[number | null]>;
  const abort = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", abort, { once: true });
  let pending: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending.push(chunk);
      size += chunk.length;
      while (size >= frameBytes) {
        const all = Buffer.concat(pending, size);
        yield all.subarray(0, frameBytes);
        const rest = all.subarray(frameBytes);
        pending = rest.length ? [rest] : [];
        size = rest.length;
      }
    }
    const [code] = await exited;
    if (signal?.aborted) throw new CancelledError();
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}\n${stderr}`);
  } finally {
    signal?.removeEventListener("abort", abort);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

/** Writes raw frames into ffmpeg (`args`: its output options), waiting whenever it's behind. */
export async function frameWriter(
  width: number,
  height: number,
  pixFmt: "rgb24" | "gray",
  args: readonly string[],
): Promise<{ write(frame: Uint8Array): Promise<void>; close(): Promise<void> }> {
  const child = spawn(
    await findBinary("ffmpeg"),
    [
      "-v",
      "error",
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      pixFmt,
      "-s",
      `${width}x${height}`,
      "-i",
      "-",
      ...args,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  const exited = once(child, "close") as Promise<[number | null]>;
  return {
    async write(frame) {
      if (!child.stdin.write(frame)) await once(child.stdin, "drain");
    },
    async close() {
      child.stdin.end();
      const [code] = await exited;
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}\n${stderr}`);
    },
  };
}

/** The square the detectors look at: the frame fitted into it at the top left, the rest black. */
const SQUARE = 640;

/** ffmpeg's filter for that square, and where the picture sits in it. */
function square(width: number, height: number) {
  const s = SQUARE / Math.max(width, height);
  return {
    filter: `scale=${SQUARE}:${SQUARE}:force_original_aspect_ratio=decrease,pad=${SQUARE}:${SQUARE}:0:0:black`,
    // The picture's size inside the square (ffmpeg rounds the same way, to even pixels).
    cw: Math.min(SQUARE, Math.round((width * s) / 2) * 2),
    ch: Math.min(SQUARE, Math.round((height * s) / 2) * 2),
  };
}

/** Intersection over union of two boxes given as [x1, y1, x2, y2]. */
function iou(a: readonly number[], b: readonly number[]): number {
  const w = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!));
  const h = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!));
  const inter = w * h;
  const union = (a[2]! - a[0]!) * (a[3]! - a[1]!) + (b[2]! - b[0]!) * (b[3]! - b[1]!) - inter;
  return union > 0 ? inter / union : 0;
}

/** Keeps the best of overlapping boxes (non-maximum suppression). */
export function suppress<T extends { box: number[]; score: number }>(found: T[], overlap: number): T[] {
  const kept: T[] = [];
  for (const f of [...found].sort((a, b) => b.score - a.score))
    if (kept.every((k) => iou(k.box, f.box) < overlap)) kept.push(f);
  return kept;
}

/**
 * YuNet's outputs to faces, in the square's pixels: per stride (8, 16, 32), a score from the class and
 * objectness heads and a box from the grid cell (as OpenCV's FaceDetectorYN decodes them).
 */
export function decodeYunet(
  out: Record<string, { data: ArrayLike<number> }>,
  threshold = 0.6,
): { box: number[]; score: number }[] {
  const found: { box: number[]; score: number }[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = out[`cls_${stride}`]!.data;
    const obj = out[`obj_${stride}`]!.data;
    const bbox = out[`bbox_${stride}`]!.data;
    const cols = SQUARE / stride;
    for (let i = 0; i < cls.length; i++) {
      const c = Math.min(1, Math.max(0, cls[i]!));
      const o = Math.min(1, Math.max(0, obj[i]!));
      const score = Math.sqrt(c * o);
      if (score < threshold) continue;
      const cx = ((i % cols) + bbox[i * 4]!) * stride;
      const cy = (Math.floor(i / cols) + bbox[i * 4 + 1]!) * stride;
      const w = Math.exp(bbox[i * 4 + 2]!) * stride;
      const h = Math.exp(bbox[i * 4 + 3]!) * stride;
      found.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], score });
    }
  }
  return suppress(found, 0.3);
}

/** The people in YOLOX's output (COCO class 0), in its input's pixels: grid cells decoded per stride. */
export function decodeYolox(
  data: ArrayLike<number>,
  size: number,
  threshold = 0.4,
): { box: number[]; score: number }[] {
  const found: { box: number[]; score: number }[] = [];
  let i = 0;
  for (const stride of [8, 16, 32]) {
    const cols = size / stride;
    for (let gy = 0; gy < cols; gy++)
      for (let gx = 0; gx < cols; gx++, i++) {
        const o = i * 85;
        const score = data[o + 4]! * data[o + 5]!;
        if (score < threshold) continue;
        const cx = (data[o]! + gx) * stride;
        const cy = (data[o + 1]! + gy) * stride;
        const w = Math.exp(data[o + 2]!) * stride;
        const h = Math.exp(data[o + 3]!) * stride;
        found.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], score });
      }
  }
  return suppress(found, 0.45);
}

/** The square frame (RGB) as YuNet takes it: BGR planes, 0-255. */
function yunetInput(frame: Uint8Array, into: Float32Array): Float32Array {
  const n = SQUARE * SQUARE;
  for (let p = 0; p < n; p++) {
    into[p] = frame[p * 3 + 2]!;
    into[n + p] = frame[p * 3 + 1]!;
    into[2 * n + p] = frame[p * 3]!;
  }
  return into;
}

const YOLO = 416;

/** The square frame shrunk to YOLOX's 416 (BGR planes, 0-255), with its grey padding outside the picture. */
function yoloxInput(frame: Uint8Array, cw: number, ch: number, into: Float32Array): Float32Array {
  const n = YOLO * YOLO;
  const r = YOLO / SQUARE;
  const pw = cw * r;
  const ph = ch * r;
  for (let y = 0; y < YOLO; y++)
    for (let x = 0; x < YOLO; x++) {
      const p = y * YOLO + x;
      if (x >= pw || y >= ph) {
        into[p] = into[n + p] = into[2 * n + p] = 114;
        continue;
      }
      // Bilinear, from the square's pixels.
      const sx = Math.min(SQUARE - 1.001, (x + 0.5) / r - 0.5);
      const sy = Math.min(SQUARE - 1.001, (y + 0.5) / r - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const y0 = Math.max(0, Math.floor(sy));
      const fx = Math.max(0, sx - x0);
      const fy = Math.max(0, sy - y0);
      for (let c = 0; c < 3; c++) {
        const at = (yy: number, xx: number) => frame[(yy * SQUARE + xx) * 3 + c]!;
        const v =
          at(y0, x0) * (1 - fx) * (1 - fy) +
          at(y0, x0 + 1) * fx * (1 - fy) +
          at(y0 + 1, x0) * (1 - fx) * fy +
          at(y0 + 1, x0 + 1) * fx * fy;
        // BGR planes.
        into[(2 - c) * n + p] = v;
      }
    }
  return into;
}

/** Faces and people in one square frame, as fractions of the picture. */
async function findIn(
  frame: Uint8Array,
  cw: number,
  ch: number,
  want: { faces: boolean; people: boolean },
  buffers: { yunet: Float32Array; yolox: Float32Array },
): Promise<Box[]> {
  const ort = await onnx();
  const boxes: Box[] = [];
  const toBox = (k: Box["k"], b: number[], score: number, scale: number): Box => {
    const x1 = Math.max(0, b[0]! / scale);
    const y1 = Math.max(0, b[1]! / scale);
    const x2 = Math.min(cw, b[2]! / scale);
    const y2 = Math.min(ch, b[3]! / scale);
    return { k, x: (x1 + x2) / 2 / cw, y: (y1 + y2) / 2 / ch, w: (x2 - x1) / cw, h: (y2 - y1) / ch, score };
  };
  if (want.faces) {
    const s = await session("faces");
    const out = (await s.run({
      [s.inputNames[0]!]: new ort.Tensor("float32", yunetInput(frame, buffers.yunet), [1, 3, SQUARE, SQUARE]),
    })) as Record<string, Ort.Tensor>;
    for (const f of decodeYunet(out as never)) boxes.push(toBox("face", f.box, f.score, 1));
  }
  if (want.people) {
    const s = await session("people");
    const out = await s.run({
      [s.inputNames[0]!]: new ort.Tensor("float32", yoloxInput(frame, cw, ch, buffers.yolox), [
        1,
        3,
        YOLO,
        YOLO,
      ]),
    });
    for (const p of decodeYolox(out[s.outputNames[0]!]!.data as Float32Array, YOLO))
      boxes.push(toBox("person", p.box, p.score, YOLO / SQUARE));
  }
  return boxes.filter((b) => b.w > 0 && b.h > 0);
}

const newBuffers = () => ({
  yunet: new Float32Array(3 * SQUARE * SQUARE),
  yolox: new Float32Array(3 * YOLO * YOLO),
});

/** Faces and people on frames sampled at `rate` a second over [from, to) of `video` (tracking). */
export async function detectBoxes(
  video: string,
  from: number,
  to: number,
  rate: number,
  signal?: AbortSignal,
): Promise<{ times: number[]; frames: Box[][] }> {
  const { width, height } = await probe(video);
  if (!width || !height) return { times: [], frames: [] };
  const sq = square(width, height);
  const times: number[] = [];
  const frames: Box[][] = [];
  const buffers = newBuffers();
  const args = [
    "-ss",
    String(from),
    "-t",
    String(Math.max(0.1, to - from)),
    "-i",
    video,
    "-vf",
    `fps=${rate},${sq.filter}`,
  ];
  for await (const frame of rawFrames(args, SQUARE * SQUARE * 3, "rgb24", signal)) {
    frames.push(await findIn(frame, sq.cw, sq.ch, { faces: true, people: true }, buffers));
    times.push(from + (frames.length - 1) / rate);
  }
  return { times, frames };
}

/** The biggest face on a few stills of `video` (at these times), as fractions; for framing. */
export async function facesAt(
  video: string,
  times: readonly number[],
  signal?: AbortSignal,
): Promise<({ x: number; y: number; size: number } | null)[]> {
  const { width, height } = await probe(video);
  if (!width || !height) return times.map(() => null);
  const sq = square(width, height);
  const buffers = newBuffers();
  const out: ({ x: number; y: number; size: number } | null)[] = [];
  for (const t of times) {
    let best: Box | null = null;
    const args = ["-ss", String(t), "-i", video, "-frames:v", "1", "-vf", sq.filter];
    for await (const frame of rawFrames(args, SQUARE * SQUARE * 3, "rgb24", signal))
      for (const b of await findIn(frame, sq.cw, sq.ch, { faces: true, people: false }, buffers))
        if (!best || b.w > best.w) best = b;
    out.push(best ? { x: best.x, y: best.y, size: best.w } : null);
  }
  return out;
}

/**
 * The person's matte for every frame in `frames` (PNGs named %06d.png, `width` x `height`), written
 * under the same names into `mattes`: Robust Video Matting carries what it saw from frame to frame, so
 * edges stay steady instead of flickering. Frames must be in order.
 */
export async function matteFrames(
  frames: string,
  count: number,
  width: number,
  height: number,
  mattes: string,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<void> {
  const ort = await onnx();
  const s = await session("cutouts");
  // It looks at a smaller copy for the overall shape and refines at full size: ~480 px across is its sweet spot.
  const ratio = new ort.Tensor(
    "float32",
    new Float32Array([Math.min(1, 480 / Math.max(width, height))]),
    [1],
  );
  let state: Ort.Tensor[] = [0, 1, 2, 3].map(
    () => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]),
  );
  const n = width * height;
  const src = new Float32Array(3 * n);
  const gray = new Uint8Array(n);
  const writer = await frameWriter(width, height, "gray", ["-start_number", "1", `${mattes}/%06d.png`]);
  let done = 0;
  try {
    for await (const frame of rawFrames(
      ["-framerate", "30", "-i", `${frames}/%06d.png`],
      n * 3,
      "rgb24",
      signal,
    )) {
      for (let p = 0; p < n; p++) {
        src[p] = frame[p * 3]! / 255;
        src[n + p] = frame[p * 3 + 1]! / 255;
        src[2 * n + p] = frame[p * 3 + 2]! / 255;
      }
      const out = await s.run({
        src: new ort.Tensor("float32", src, [1, 3, height, width]),
        r1i: state[0]!,
        r2i: state[1]!,
        r3i: state[2]!,
        r4i: state[3]!,
        downsample_ratio: ratio,
      });
      state = [out.r1o!, out.r2o!, out.r3o!, out.r4o!];
      const pha = out.pha!.data as Float32Array;
      for (let p = 0; p < n; p++) gray[p] = Math.round(Math.min(1, Math.max(0, pha[p]!)) * 255);
      await writer.write(gray);
      onProgress?.(++done / count);
    }
  } finally {
    await writer.close();
  }
}

/**
 * Adds everything in the foreground to the person's mattes (`mattes`, %06d.png), from the background
 * removal model (ISNet) at 1024 px: what they hold, a product, a pet. The person's own matte stays as the
 * open matting model made it; the foreground only adds to it.
 */
export async function addForeground(
  frames: string,
  count: number,
  width: number,
  height: number,
  mattes: string,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<void> {
  const ort = await onnx();
  const s = await session("foreground");
  const S = 1024;
  const n = S * S;
  const src = new Float32Array(3 * n);
  const gray = new Uint8Array(n);
  const fg = path.join(path.dirname(mattes), "foreground");
  await mkdir(fg, { recursive: true });
  const writer = await frameWriter(S, S, "gray", ["-start_number", "1", `${fg}/%06d.png`]);
  let done = 0;
  try {
    for await (const frame of rawFrames(
      ["-framerate", "30", "-i", `${frames}/%06d.png`, "-vf", `scale=${S}:${S}`],
      n * 3,
      "rgb24",
      signal,
    )) {
      // Every other frame (it's slow on a CPU, and what's held moves little in a fifteenth of a second);
      // the one between keeps the last mask. The person's own matte is still made for every frame.
      if (done % 2 === 0) {
        // As rembg feeds it: 0..1, centred on a half.
        for (let p = 0; p < n; p++) {
          src[p] = frame[p * 3]! / 255 - 0.5;
          src[n + p] = frame[p * 3 + 1]! / 255 - 0.5;
          src[2 * n + p] = frame[p * 3 + 2]! / 255 - 0.5;
        }
        const out = await s.run({ input_image: new ort.Tensor("float32", src, [1, 3, S, S]) });
        const pred = out.output_image!.data as Float32Array;
        let lo = Infinity;
        let hi = -Infinity;
        for (let p = 0; p < n; p++) {
          lo = Math.min(lo, pred[p]!);
          hi = Math.max(hi, pred[p]!);
        }
        const span = hi - lo || 1;
        // Firmed up: what it's fairly sure of is solid (no see-through mic), the edges stay soft.
        for (let p = 0; p < n; p++)
          gray[p] = Math.round(Math.min(1, Math.max(0, ((pred[p]! - lo) / span - 0.1) / 0.6)) * 255);
      }
      await writer.write(gray);
      onProgress?.(++done / count);
    }
  } finally {
    await writer.close();
  }
  // The person's matte, lightened by the foreground's (back at the frame's size).
  const merged = path.join(path.dirname(mattes), "merged");
  await mkdir(merged, { recursive: true });
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      `${mattes}/%06d.png`,
      "-i",
      `${fg}/%06d.png`,
      "-filter_complex",
      `[0]format=gray[p];[1]format=gray,scale=${width}:${height}[f];[p][f]blend=all_mode=lighten`,
      `${merged}/%06d.png`,
    ],
    signal ? { signal } : {},
  );
  await rm(mattes, { recursive: true, force: true });
  await rename(merged, mattes);
}

/**
 * Just the people picked by points, where the matte can't tell people apart itself (the open matting
 * model): people are found five times a second over the stretch, each picked one followed from sample to
 * sample (the box that overlaps it most), and the matte kept only inside their box, widened for arms and
 * what they hold, down to the bottom of the frame, with soft edges. Mattes are rewritten in place.
 */
export async function keepOnlyPeople(
  video: string,
  from: number,
  to: number,
  fps: number,
  count: number,
  width: number,
  height: number,
  mattes: string,
  points: readonly { readonly x: number; readonly y: number; readonly at: number }[],
  signal?: AbortSignal,
): Promise<void> {
  const rate = 5;
  const { times, frames } = await detectBoxes(video, from, to, rate, signal);
  if (!times.length) return;
  const people = frames.map((f) => f.filter((b) => b.k === "person"));
  const xyxy = (b: Box) => [b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2];
  // Each point's person, at every sample: picked where the point is, followed both ways by overlap.
  const chosen: (Box | null)[][] = points.map((p) => {
    const at = Math.max(0, Math.min(times.length - 1, Math.round((p.at - from) * rate)));
    const near = (list: Box[]) =>
      list
        .filter((b) => Math.abs(p.x - b.x) <= b.w / 2 && Math.abs(p.y - b.y) <= b.h / 2)
        .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] ??
      list.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] ??
      null;
    const out: (Box | null)[] = times.map(() => null);
    out[at] = near(people[at]!);
    const carry = (i: number, prev: Box | null) => {
      if (!prev) return null;
      const best = people[i]!.map((b) => ({ b, o: iou(xyxy(b), xyxy(prev)) })).sort((a, b) => b.o - a.o)[0];
      // Lost for a moment (turned away, blurred): they're where they were.
      return best && best.o > 0.2 ? best.b : prev;
    };
    for (let i = at + 1; i < times.length; i++) out[i] = carry(i, out[i - 1]!);
    for (let i = at - 1; i >= 0; i--) out[i] = carry(i, out[i + 1]!);
    return out;
  });
  const boxAt = (pick: (Box | null)[], t: number): Box | null => {
    const u = Math.max(0, Math.min(times.length - 1, (t - from) * rate));
    const a = pick[Math.floor(u)];
    const b = pick[Math.ceil(u)];
    if (!a || !b) return a ?? b ?? null;
    const k = u - Math.floor(u);
    const mix = (p: number, q: number) => p + (q - p) * k;
    return { ...a, x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) };
  };
  const n = width * height;
  const keep = new Float32Array(n);
  const out = new Uint8Array(n);
  const kept = path.join(path.dirname(mattes), "people");
  await mkdir(kept, { recursive: true });
  const writer = await frameWriter(width, height, "gray", ["-start_number", "1", `${kept}/%06d.png`]);
  let i = 0;
  try {
    for await (const matte of rawFrames(
      ["-framerate", "30", "-i", `${mattes}/%06d.png`],
      n,
      "gray",
      signal,
    )) {
      keep.fill(0);
      for (const pick of chosen) {
        const b = boxAt(pick, from + i / fps);
        if (!b) continue;
        // Widened for arms and what they hold, and down to the bottom (bodies run off the frame).
        const x1 = (b.x - b.w * 0.75) * width;
        const x2 = (b.x + b.w * 0.75) * width;
        const y1 = (b.y - b.h * 0.65) * height;
        const soft = Math.max(8, b.w * width * 0.12);
        for (let y = 0; y < height; y++) {
          const vy = Math.min(1, Math.max(0, (y - y1) / soft + 1));
          if (vy <= 0) continue;
          for (let x = 0; x < width; x++) {
            const vx = Math.min(1, Math.max(0, Math.min(x - x1, x2 - x) / soft + 1));
            const v = vx * vy;
            if (v > keep[y * width + x]!) keep[y * width + x] = v;
          }
        }
      }
      for (let p = 0; p < n; p++) out[p] = Math.round(matte[p]! * keep[p]!);
      await writer.write(out);
      if (++i >= count) break;
    }
  } finally {
    await writer.close();
  }
  await rm(mattes, { recursive: true, force: true });
  await rename(kept, mattes);
}
