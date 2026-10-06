/**
 * How the camera moved over a stretch of footage, frame by frame: what steadying cancels. Pure code,
 * the same everywhere: small grey frames from ffmpeg; in each, patches on a grid are found again in
 * the next frame (coarse to fine, to a fraction of a pixel); and the move that best explains where
 * they went (shift, turn and zoom), with the patches that moved on their own (the person, a passing
 * car) left out, is added to the path.
 */
import { spawn } from "node:child_process";
import type { CameraPath } from "@vedit/project";
import { findBinary, run } from "./exec.ts";

/** Width the motion is read at: plenty for shake, fast to search. */
const W = 320;

type Plane = { data: Float32Array; w: number; h: number };

const half = (p: Plane): Plane => {
  const w = p.w >> 1;
  const h = p.h >> 1;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 2 * y * p.w + 2 * x;
      data[y * w + x] = (p.data[i]! + p.data[i + 1]! + p.data[i + p.w]! + p.data[i + p.w + 1]!) / 4;
    }
  return { data, w, h };
};

/** Mean absolute difference of the block at (x, y) in `a` and at (x + dx, y + dy) in `b`. */
function sad(a: Plane, b: Plane, x: number, y: number, dx: number, dy: number, r: number): number {
  let sum = 0;
  for (let j = -r; j < r; j++) {
    const ra = (y + j) * a.w + x;
    const rb = (y + j + dy) * b.w + x + dx;
    for (let i = -r; i < r; i++) sum += Math.abs(a.data[ra + i]! - b.data[rb + i]!);
  }
  return sum / (4 * r * r);
}

/** How much detail a block has to be found by (flat sky and walls don't). */
function texture(p: Plane, x: number, y: number, r: number): number {
  let sum = 0;
  for (let j = -r; j < r; j++)
    for (let i = -r; i < r - 1; i++) {
      const k = (y + j) * p.w + x + i;
      sum += Math.abs(p.data[k + 1]! - p.data[k]!) + Math.abs(p.data[k + p.w]! - p.data[k]!);
    }
  return sum / (4 * r * r);
}

/** Best whole-pixel shift of a block within ±range around (sx, sy), and its fit. */
function search(
  a: Plane,
  b: Plane,
  x: number,
  y: number,
  r: number,
  sx: number,
  sy: number,
  range: number,
): { dx: number; dy: number; cost: number; costs: Map<string, number> } {
  let best = { dx: sx, dy: sy, cost: Number.POSITIVE_INFINITY };
  const costs = new Map<string, number>();
  for (let dy = sy - range; dy <= sy + range; dy++)
    for (let dx = sx - range; dx <= sx + range; dx++) {
      if (x + dx - r < 0 || y + dy - r < 0 || x + dx + r > b.w || y + dy + r > b.h) continue;
      const c = sad(a, b, x, y, dx, dy, r);
      costs.set(`${dx},${dy}`, c);
      if (c < best.cost) best = { dx, dy, cost: c };
    }
  return { ...best, costs };
}

/** A fraction of a pixel from the fits either side (a parabola through three). */
const subpixel = (l: number | undefined, c: number, r: number | undefined) => {
  if (l === undefined || r === undefined) return 0;
  const d = l - 2 * c + r;
  return d > 1e-6 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d))) : 0;
};

export interface Move {
  /** Shift in pixels of the small frame, turn in radians, zoom as a scale. */
  readonly tx: number;
  readonly ty: number;
  readonly a: number;
  readonly s: number;
}

/**
 * The camera's move from frame `a` to frame `b` (same size): patches found again, then the shift, turn
 * and zoom (about the centre) that fits them best, refitted without the ones that moved on their own.
 */
export function frameMove(a: Plane, b: Plane): Move {
  const ah = half(a);
  const bh = half(b);
  const r = 8;
  const pairs: { u: number; v: number; du: number; dv: number }[] = [];
  const cols = 8;
  const rows = Math.max(4, Math.round((cols * a.h) / a.w));
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < cols; gx++) {
      // Centres inside the frame, clear of the edges by the block and the search.
      const x = Math.round(a.w * (0.1 + (0.8 * (gx + 0.5)) / cols));
      const y = Math.round(a.h * (0.1 + (0.8 * (gy + 0.5)) / rows));
      if (texture(a, x, y, r) < 2) continue;
      // Coarse, on the half-size frames (moves up to 24 pixels here), then fine.
      const coarse = search(ah, bh, x >> 1, y >> 1, r >> 1, 0, 0, 12);
      const fine = search(a, b, x, y, r, coarse.dx * 2, coarse.dy * 2, 2);
      if (!Number.isFinite(fine.cost)) continue;
      const c = fine.costs;
      const du =
        fine.dx + subpixel(c.get(`${fine.dx - 1},${fine.dy}`), fine.cost, c.get(`${fine.dx + 1},${fine.dy}`));
      const dv =
        fine.dy + subpixel(c.get(`${fine.dx},${fine.dy - 1}`), fine.cost, c.get(`${fine.dx},${fine.dy + 1}`));
      pairs.push({ u: x - a.w / 2, v: y - a.h / 2, du, dv });
    }
  return fitMove(pairs);
}

/** Shift, turn and zoom about the centre that best carries points (u, v) by (du, dv); robust to strays. */
export function fitMove(pairs: readonly { u: number; v: number; du: number; dv: number }[]): Move {
  // First, only the patches that went about where most went (a person moving is a cluster of strays).
  const middle = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] ?? 0;
  const mdu = middle(pairs.map((p) => p.du));
  const mdv = middle(pairs.map((p) => p.dv));
  const off = pairs.map((p) => Math.hypot(p.du - mdu, p.dv - mdv));
  const spread = middle(off);
  let use = pairs.filter((_, i) => off[i]! <= Math.max(1, 2.5 * spread));
  let move: Move = { tx: 0, ty: 0, a: 0, s: 1 };
  for (let round = 0; round < 3; round++) {
    if (use.length < 4) return round ? move : { tx: 0, ty: 0, a: 0, s: 1 };
    // Closed-form similarity fit: q = [p -q; q p] u + t.
    let mu = 0;
    let mv = 0;
    let mx = 0;
    let my = 0;
    for (const p of use) {
      mu += p.u;
      mv += p.v;
      mx += p.u + p.du;
      my += p.v + p.dv;
    }
    const n = use.length;
    mu /= n;
    mv /= n;
    mx /= n;
    my /= n;
    let dot = 0;
    let cross = 0;
    let norm = 0;
    for (const p of use) {
      const pu = p.u - mu;
      const pv = p.v - mv;
      const qx = p.u + p.du - mx;
      const qy = p.v + p.dv - my;
      dot += pu * qx + pv * qy;
      cross += pu * qy - pv * qx;
      norm += pu * pu + pv * pv;
    }
    const sa = norm > 1e-9 ? dot / norm : 1;
    const sb = norm > 1e-9 ? cross / norm : 0;
    move = {
      tx: mx - (sa * mu - sb * mv),
      ty: my - (sb * mu + sa * mv),
      a: Math.atan2(sb, sa),
      s: Math.hypot(sa, sb) || 1,
    };
    // Leave out what moved on its own: far off the fit (more than 2.5 times the typical miss).
    const miss = use.map((p) => {
      const x = sa * p.u - sb * p.v + move.tx;
      const y = sb * p.u + sa * p.v + move.ty;
      return Math.hypot(p.u + p.du - x, p.v + p.dv - y);
    });
    const typical = [...miss].sort((x, y) => x - y)[Math.floor(miss.length / 2)]!;
    const keep = use.filter((_, i) => miss[i]! <= Math.max(0.5, 2.5 * typical));
    if (keep.length === use.length) break;
    use = keep;
  }
  return move;
}

/**
 * The camera's path over [from, to) of `video`, at its own frame rate (up to 60): where the picture
 * had moved by each frame since the first (sideways and up in shares of the picture, turn, log zoom).
 */
export async function trackCamera(
  video: string,
  from: number,
  to: number,
  {
    fps = 30,
    signal,
    onProgress,
  }: { fps?: number; signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<CameraPath> {
  const rate = Math.max(1, Math.min(60, Math.round(fps)));
  // The small frame's height (scale=W:-2 rounds it to even), from the picture as it's shown (turned).
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:stream_side_data=rotation",
      "-of",
      "json",
      video,
    ],
    signal ? { signal } : {},
  );
  const st = JSON.parse(stdout).streams?.[0] ?? {};
  const turned = Math.abs(Number(st.side_data_list?.[0]?.rotation ?? 0)) % 180 === 90;
  const [sw, sh] = (turned ? [st.height, st.width] : [st.width, st.height]) as [number, number];
  if (!sw || !sh) throw new Error("No picture in that footage");
  const height = Math.max(2, Math.round((W * sh) / sw / 2) * 2);
  const child = spawn(
    await findBinary("ffmpeg"),
    [
      "-v",
      "error",
      "-ss",
      from.toFixed(3),
      "-t",
      (to - from).toFixed(3),
      "-i",
      video,
      "-vf",
      `fps=${rate},scale=${W}:-2,format=gray`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
  child.stderr.resume();
  const size = W * height;
  const total = Math.max(1, Math.round((to - from) * rate));
  const path: CameraPath = { from, to, fps: rate, x: [0], y: [0], a: [0], s: [0] };
  let prev: Plane | null = null;
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= size) {
      const frame: Plane = { data: Float32Array.from(pending.subarray(0, size)), w: W, h: height };
      pending = pending.subarray(size);
      if (prev) {
        const m = frameMove(prev, frame);
        const i = path.x.length - 1;
        path.x.push(round(path.x[i]! + m.tx / W));
        path.y.push(round(path.y[i]! + m.ty / height));
        path.a.push(round(path.a[i]! + m.a));
        path.s.push(round(path.s[i]! + Math.log(m.s)));
        onProgress?.(Math.min(1, path.x.length / total));
      }
      prev = frame;
    }
  }
  const code = await new Promise<number | null>((r) =>
    child.exitCode !== null ? r(child.exitCode) : child.on("close", r),
  );
  if (signal?.aborted) throw new Error("Stopped");
  if (code !== 0 && path.x.length < 2) throw new Error(`Reading the footage failed (${code})`);
  return path;
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;
