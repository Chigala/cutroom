/**
 * What's in a clip's picture where Apple's Vision isn't (see.ts), from open models: the words on screen
 * (PaddleOCR: a detector finds the lines, a reader reads each), where the eye goes (U²-Net, small), and
 * how sharp each frame is (no face quality or look score: those are Apple's).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { run } from "./exec.ts";
import { ensureModel, onnx, session } from "./models.ts";
import type { Box4, FrameSeen } from "./see.ts";
import { rawFrames } from "./vision.ts";

/** RGB frame, `w` x `h`, bilinearly resized to `rw` x `rh`, as planes in `order` with a per-channel transform. */
function planes(
  rgb: Uint8Array,
  w: number,
  h: number,
  rw: number,
  rh: number,
  order: readonly [number, number, number],
  norm: (v: number, c: number) => number,
): Float32Array {
  const out = new Float32Array(3 * rw * rh);
  const n = rw * rh;
  for (let y = 0; y < rh; y++) {
    const sy = Math.min(h - 1.001, Math.max(0, ((y + 0.5) * h) / rh - 0.5));
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(w - 1.001, Math.max(0, ((x + 0.5) * w) / rw - 0.5));
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      for (let k = 0; k < 3; k++) {
        const c = order[k]!;
        const at = (yy: number, xx: number) => rgb[(yy * w + xx) * 3 + c]!;
        const v =
          at(y0, x0) * (1 - fx) * (1 - fy) +
          at(y0, x0 + 1) * fx * (1 - fy) +
          at(y0 + 1, x0) * (1 - fx) * fy +
          at(y0 + 1, x0 + 1) * fx * fy;
        out[k * n + y * rw + x] = norm(v, k);
      }
    }
  }
  return out;
}

const BGR = [2, 1, 0] as const;
const RGB = [0, 1, 2] as const;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The lines of text in a frame, as boxes (pixels): PaddleOCR's detector, then its usual DB post-processing. */
async function findLines(rgb: Uint8Array, w: number, h: number): Promise<[number, number, number, number][]> {
  const ort = await onnx();
  const s = await session("ocrDet");
  const scale = Math.min(1, 960 / Math.max(w, h));
  const rw = Math.max(32, Math.round((w * scale) / 32) * 32);
  const rh = Math.max(32, Math.round((h * scale) / 32) * 32);
  const input = planes(rgb, w, h, rw, rh, BGR, (v, k) => (v / 255 - MEAN[k]!) / STD[k]!);
  const out = await s.run({ x: new ort.Tensor("float32", input, [1, 3, rh, rw]) });
  const prob = out[s.outputNames[0]!]!.data as Float32Array;
  const seen = new Uint8Array(rw * rh);
  const boxes: [number, number, number, number][] = [];
  const stack: number[] = [];
  for (let p = 0; p < rw * rh; p++) {
    if (seen[p] || prob[p]! <= 0.3) continue;
    // One connected stretch of likely text.
    let x1 = rw;
    let y1 = rh;
    let x2 = 0;
    let y2 = 0;
    let sum = 0;
    let count = 0;
    stack.push(p);
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % rw;
      const qy = (q - qx) / rw;
      x1 = Math.min(x1, qx);
      x2 = Math.max(x2, qx);
      y1 = Math.min(y1, qy);
      y2 = Math.max(y2, qy);
      sum += prob[q]!;
      count++;
      for (const r of [q - 1, q + 1, q - rw, q + rw]) {
        if (r < 0 || r >= rw * rh || seen[r] || prob[r]! <= 0.3) continue;
        if ((r === q - 1 && qx === 0) || (r === q + 1 && qx === rw - 1)) continue;
        seen[r] = 1;
        stack.push(r);
      }
    }
    const bw = x2 - x1 + 1;
    const bh = y2 - y1 + 1;
    if (sum / count < 0.6 || bw < 4 || bh < 4) continue;
    // DB's unclip: the shrunk text region grown back by area x 1.5 / perimeter.
    const d = (bw * bh * 1.5) / (2 * (bw + bh));
    boxes.push([
      Math.max(0, (x1 - d) / (rw / w)),
      Math.max(0, (y1 - d) / (rh / h)),
      Math.min(w, (x2 + 1 + d) / (rw / w)),
      Math.min(h, (y2 + 1 + d) / (rh / h)),
    ]);
  }
  return boxes;
}

let dict: string[] | null = null;

/** One line read: PaddleOCR's reader on the crop, 48 px tall, greedy CTC. */
async function readLine(
  rgb: Uint8Array,
  w: number,
  box: [number, number, number, number],
): Promise<{ s: string; c: number } | null> {
  const ort = await onnx();
  const s = await session("ocrRec");
  dict ??= (await readFile(await ensureModel("ocrDict"), "utf8"))
    .split(/\r?\n/)
    .filter((l, i, a) => l || i < a.length - 1);
  const [x1, y1, x2, y2] = box.map(Math.round) as [number, number, number, number];
  const cw = Math.max(1, x2 - x1);
  const ch = Math.max(1, y2 - y1);
  const crop = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++)
    crop.set(rgb.subarray(((y1 + y) * w + x1) * 3, ((y1 + y) * w + x1 + cw) * 3), y * cw * 3);
  const rw = Math.max(16, Math.min(640, Math.round((48 * cw) / ch)));
  const input = planes(crop, cw, ch, rw, 48, BGR, (v) => (v / 255 - 0.5) / 0.5);
  const out = await s.run({ x: new ort.Tensor("float32", input, [1, 3, 48, rw]) });
  const t = out[s.outputNames[0]!]!;
  const [, steps, classes] = t.dims as [number, number, number];
  const data = t.data as Float32Array;
  let text = "";
  let last = -1;
  let conf = 0;
  let kept = 0;
  for (let i = 0; i < steps; i++) {
    let best = 0;
    for (let c = 1; c < classes; c++) if (data[i * classes + c]! > data[i * classes + best]!) best = c;
    if (best !== 0 && best !== last) {
      // Class 0 is CTC's blank; then the dictionary, then a space.
      text += best - 1 < dict.length ? dict[best - 1] : " ";
      conf += data[i * classes + best]!;
      kept++;
    }
    last = best;
  }
  const c = kept ? conf / kept : 0;
  return text.trim() && c >= 0.5 ? { s: text.trim(), c } : null;
}

/** Where the eye goes: the box around the most salient part (U²-Net, small, at 320 px). */
async function salientBox(rgb: Uint8Array, w: number, h: number): Promise<Box4 | null> {
  const ort = await onnx();
  const s = await session("saliency");
  const input = planes(rgb, w, h, 320, 320, RGB, (v, k) => (v / 255 - MEAN[k]!) / STD[k]!);
  const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor("float32", input, [1, 3, 320, 320]) });
  const map = out[s.outputNames[0]!]!.data as Float32Array;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of map) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const cut = lo + (hi - lo) * 0.5;
  let x1 = 320;
  let y1 = 320;
  let x2 = -1;
  let y2 = -1;
  for (let p = 0; p < map.length; p++) {
    if (map[p]! < cut) continue;
    const x = p % 320;
    const y = (p - x) / 320;
    x1 = Math.min(x1, x);
    x2 = Math.max(x2, x);
    y1 = Math.min(y1, y);
    y2 = Math.max(y2, y);
  }
  if (x2 < 0) return null;
  return [x1 / 320, y1 / 320, (x2 - x1 + 1) / 320, (y2 - y1 + 1) / 320];
}

/** How sharp a frame is, 0..1: the spread of its edges (variance of the Laplacian), soft and sharp apart. */
function sharpness(rgb: Uint8Array, w: number, h: number): number {
  const g = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++)
    g[p] = 0.299 * rgb[p * 3]! + 0.587 * rgb[p * 3 + 1]! + 0.114 * rgb[p * 3 + 2]!;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const p = y * w + x;
      const l = 4 * g[p]! - g[p - 1]! - g[p + 1]! - g[p - w]! - g[p + w]!;
      sum += l;
      sq += l * l;
      n++;
    }
  const v = n ? sq / n - (sum / n) ** 2 : 0;
  return v / (v + 150);
}

export async function seeOpen(
  dir: string,
  count: number,
  rate: number,
  signal?: AbortSignal,
): Promise<FrameSeen[]> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    path.join(dir, "000001.png"),
  ]);
  const [w, h] = stdout.trim().split(",").map(Number) as [number, number];
  if (!w || !h) return [];
  const frames: FrameSeen[] = [];
  let i = 0;
  for await (const rgb of rawFrames(
    ["-framerate", "30", "-i", `${dir}/%06d.png`],
    w * h * 3,
    "rgb24",
    signal,
  )) {
    const text: { s: string; box: Box4 }[] = [];
    for (const b of (await findLines(rgb, w, h)).slice(0, 40)) {
      const read = await readLine(rgb, w, b);
      if (read) text.push({ s: read.s, box: [b[0] / w, b[1] / h, (b[2] - b[0]) / w, (b[3] - b[1]) / h] });
    }
    const salient = await salientBox(rgb, w, h);
    frames.push({ t: i / rate, text, salient: salient ? [salient] : [], sharp: sharpness(rgb, w, h) });
    if (++i >= count) break;
  }
  return frames;
}
