/**
 * Footage made from footage, cached per project: a ramped shot (the velocity edit, rendered frame by
 * frame so preview and export match exactly), a slowed one with in-between frames, and a cutout (the person alone, on transparency, from
 * Apple's person segmentation, so graphics can sit behind them and the background can change).
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import {
  CACHE_DIR,
  type ProjectDoc,
  parseDerivedKey,
  type RampPoint,
  rampHash,
  rampMap,
  type Source,
} from "@vedit/project";
import { findBinary, run } from "./exec.ts";
import { LiftUnavailable, liftMattes } from "./lift.ts";
import { useOpenModels } from "./models.ts";
import { renderableAsIs } from "./transcode.ts";
import { addForeground, keepOnlyPeople, matteFrames } from "./vision.ts";

const opts = (signal?: AbortSignal) => (signal ? { signal } : {});

/**
 * Footage [from, to) of `video` as JPEG frames in `dir`, `rate` a second (up to 1080 high). With
 * `interpolate`, the frames the footage doesn't have are made by motion interpolation (ffmpeg's
 * minterpolate: each pixel's motion estimated between real frames and the picture moved along it), in
 * pieces side by side (it's slow: a few frames a second each). Returns the frame file
 * nearest clip second `t`.
 */
async function footageFrames(
  video: string,
  from: number,
  to: number,
  rate: number,
  dir: string,
  { interpolate = false, signal }: { interpolate?: boolean; signal?: AbortSignal } = {},
): Promise<(t: number) => string> {
  const scale = "scale=-2:'min(1080,ih)'";
  const length = Math.max(1 / rate, to - from);
  // Pieces, each with a little footage either side for the motion to be read from.
  // Three at once is quickest: each holds several full frames, and more fight over memory.
  const count = interpolate ? Math.max(1, Math.min(3, cpus().length - 1, Math.ceil(length / 0.4))) : 1;
  const piece = length / count;
  // A few real frames either side is all the motion needs.
  const pad = 0.1;
  const made = await Promise.all(
    Array.from({ length: count }, async (_, j) => {
      const start = from + j * piece;
      const lead = interpolate ? Math.min(pad, start) : 0;
      const filter = interpolate
        ? `${scale},minterpolate=fps=${rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,trim=start=${lead.toFixed(3)}:end=${(lead + piece).toFixed(3)},setpts=PTS-STARTPTS`
        : `fps=${rate},${scale}`;
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-ss",
          (start - lead).toFixed(3),
          "-t",
          (piece + lead + (interpolate ? pad : 0)).toFixed(3),
          "-i",
          video,
          "-vf",
          filter,
          "-q:v",
          "2",
          path.join(dir, `${j}_%06d.jpg`),
        ],
        opts(signal),
      );
      return (await readdir(dir)).filter((f) => f.startsWith(`${j}_`) && f.endsWith(".jpg")).sort();
    }),
  );
  if (!made.some((m) => m.length)) throw new Error("No footage in that stretch");
  return (t) => {
    const j = Math.max(0, Math.min(count - 1, Math.floor((t - from) / piece)));
    // A piece that came out empty (past the clip's end): the last frame there is.
    let k = j;
    while (k > 0 && !made[k]!.length) k--;
    const frames = made[k]!.length ? made[k]! : made.find((m) => m.length)!;
    const i = Math.round((t - (from + k * piece)) * rate);
    return path.join(dir, frames[Math.min(frames.length - 1, Math.max(0, i))]!);
  };
}

/** Frame files, one per output frame at `fps`, encoded into `out`. No sound. */
async function encodeFrames(
  frames: readonly string[],
  out: string,
  dir: string,
  { fps, signal }: { fps: number; signal?: AbortSignal | undefined },
): Promise<string> {
  const lines: string[] = [];
  for (const f of frames) lines.push(`file '${f}'`, `duration ${(1 / fps).toFixed(6)}`);
  // The concat demuxer needs the last file once more to honour its duration.
  lines.push(lines.at(-2)!);
  const list = path.join(dir, "list.txt");
  await writeFile(list, lines.join("\n"));
  await mkdir(path.dirname(out), { recursive: true });
  const part = `${out}.part.mp4`;
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-vf",
      `fps=${fps},format=yuv420p`,
      "-frames:v",
      String(frames.length),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "17",
      "-r",
      String(fps),
      "-an",
      "-movflags",
      "+faststart",
      part,
    ],
    opts(signal),
  );
  await rename(part, out);
  return out;
}

/** In-between frames a second for footage slowed to `slowest` to play smoothly at `fps` (at most 240). */
const flowRate = (fps: number, slowest: number) => Math.min(240, Math.max(fps, Math.ceil(fps / slowest)));

/**
 * The shot's footage [from, to) re-timed through its ramp, at `fps`: each output frame shows the
 * source frame the speed curve lands on. Slow stretches use the footage's own frame rate (60 fps
 * footage gives real slow motion, not repeated frames), or with `interpolate`, frames made between
 * them. No sound.
 */
export async function makeRamp(
  video: string,
  shot: { in: number; out: number; ramp: readonly RampPoint[] },
  out: string,
  {
    fps,
    sourceFps = 30,
    interpolate = false,
    signal,
  }: { fps: number; sourceFps?: number; interpolate?: boolean; signal?: AbortSignal },
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-ramp-"));
  try {
    const rate = interpolate
      ? flowRate(fps, Math.min(...shot.ramp.map((r) => r.speed)))
      : Math.max(fps, Math.min(120, Math.round(sourceFps)));
    const frameAt = await footageFrames(video, shot.in, shot.out, rate, dir, {
      interpolate,
      ...(signal && { signal }),
    });
    const map = rampMap(shot);
    const count = Math.max(1, Math.round(map.length * fps));
    // The footage moment at the middle of each output frame.
    const frames = Array.from({ length: count }, (_, k) => frameAt(shot.in + map.sourceAt((k + 0.5) / fps)));
    return await encodeFrames(frames, out, dir, { fps, signal });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Footage [from, to) slowed to `speed` (under 1) with in-between frames made by motion interpolation,
 * at `fps`: second u of the file shows clip second from + u * speed. No sound (the shot's own plays
 * as it is).
 */
export async function makeSlow(
  video: string,
  shot: { from: number; to: number; speed: number },
  out: string,
  { fps, signal }: { fps: number; signal?: AbortSignal },
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-slow-"));
  try {
    const rate = flowRate(fps, shot.speed);
    const frameAt = await footageFrames(video, shot.from, shot.to, rate, dir, {
      interpolate: true,
      ...(signal && { signal }),
    });
    const count = Math.max(1, Math.round(((shot.to - shot.from) / shot.speed) * fps));
    const frames = Array.from({ length: count }, (_, k) => frameAt(shot.from + (k / fps) * shot.speed));
    return await encodeFrames(frames, out, dir, { fps, signal });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Apple's person segmentation over a batch of frames, writing one matte (white = person) per frame.
const MATTE_JS = `
ObjC.import("Foundation");
ObjC.import("Vision");
ObjC.import("CoreImage");
ObjC.import("AppKit");
function run(argv) {
  const out = argv[0];
  const req = $.VNGeneratePersonSegmentationRequest.alloc.init;
  req.qualityLevel = 0; // accurate: hair and fingers hold up
  req.outputPixelFormat = 1278226488; // one 8-bit channel
  let done = 0;
  for (let i = 1; i < argv.length; i++) {
    const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[i]), $());
    handler.performRequestsError($([req]), null);
    const results = req.results;
    const name = ObjC.unwrap($.NSString.stringWithString(argv[i]).lastPathComponent);
    if (!results || results.count === 0) continue;
    const ci = $.CIImage.imageWithCVPixelBuffer(results.objectAtIndex(0).pixelBuffer);
    const rep = $.NSBitmapImageRep.alloc.initWithCIImage(ci);
    rep.representationUsingTypeProperties(4, $()).writeToFileAtomically(out + "/" + name, true);
    done++;
  }
  return String(done);
}
`;

/**
 * The person in `video` over [from, to), alone on transparency (VP9 with alpha), at `fps`. Frames with
 * nobody in them come out empty. macOS only; elsewhere it throws.
 */
/** Apple's person segmentation over every frame, a matte per frame (frames it found nobody in, black). */
async function appleMattes(
  dir: string,
  frames: string,
  mattes: string,
  files: readonly string[],
  signal: AbortSignal | undefined,
  onProgress: ((fraction: number) => void) | undefined,
): Promise<void> {
  const script = path.join(dir, "matte.js");
  await writeFile(script, MATTE_JS);
  // Batches, two at a time: Vision keeps the Neural Engine and GPU busy without starving the app.
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += 60) batches.push(files.slice(i, i + 60));
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++]!;
      await run(
        "/usr/bin/osascript",
        ["-l", "JavaScript", script, mattes, ...b.map((f) => path.join(frames, f))],
        opts(signal),
      );
      done += b.length;
      onProgress?.(0.1 + 0.8 * (done / files.length));
    }
  };
  await Promise.all([worker(), worker()]);
  // Frames Vision found nobody in get an empty matte, so frames and mattes stay in step.
  const made = new Set(await readdir(mattes));
  const missing = files.filter((f) => !made.has(f));
  if (missing.length === files.length) throw new Error("No person found in that stretch");
  for (const f of missing)
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=black:s=64x64",
        "-frames:v",
        "1",
        path.join(mattes, f),
      ],
      opts(signal),
    );
}

/** Points on a clip's own picture (shares, from the top left) at moments in its own time. */
export type ClipPoints = readonly { readonly x: number; readonly y: number; readonly at: number }[];

/** What a cutout keeps with the person (a shot's keep): everything in the foreground, or objects at points in the clip. */
export type Keep = "subject" | ClipPoints;

/**
 * Whether this machine can cut people out: Apple's person segmentation on macOS, the open matting model
 * (Robust Video Matting, vision.ts) where ONNX Runtime runs. Where neither does, the video plays and
 * exports without the subject layer, the same as before a cutout is made.
 */
export const cutoutsAvailable = () => process.platform === "darwin" || useOpenModels();

export async function makeCutout(
  video: string,
  from: number,
  to: number,
  out: string,
  {
    fps = 30,
    keep,
    person,
    signal,
    onProgress,
  }: {
    fps?: number;
    /** What stays in front with the person (a shot's keep): everything in the foreground, or objects at points. */
    keep?: Keep | undefined;
    /** Who the cutout is (a shot's person): the people at these points. Unset: everyone. */
    person?: ClipPoints | undefined;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<string> {
  if (!cutoutsAvailable()) throw new Error("Cutouts aren't available on this computer");
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-cutout-"));
  try {
    const frames = path.join(dir, "frames");
    const mattes = path.join(dir, "mattes");
    await mkdir(frames);
    await mkdir(mattes);
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-ss",
        from.toFixed(3),
        "-t",
        (to - from).toFixed(3),
        "-i",
        video,
        "-vf",
        `fps=${fps},scale=-2:'min(1080,ih)'`,
        path.join(frames, "%06d.png"),
      ],
      opts(signal),
    );
    const files = (await readdir(frames)).filter((f) => f.endsWith(".png")).sort();
    if (!files.length) throw new Error("No footage in that stretch");
    onProgress?.(0.1);
    // The frame size the matte stretches to (Vision's mask has its own shape but covers the whole frame).
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        path.join(frames, files[0]!),
      ],
      opts(signal),
    );
    const [w, h] = stdout.trim().split(",").map(Number);
    if (useOpenModels()) {
      // The open matting model, frame after frame (it needs them in order: it carries over what it saw).
      await matteFrames(frames, files.length, w!, h!, mattes, {
        ...(signal && { signal }),
        onProgress: (f) => onProgress?.(0.1 + 0.8 * (keep ? 0.5 : 1) * f),
      });
      // Kept with the person: the foreground the background-removal model sees (points: the same; it
      // can't follow single objects).
      if (keep)
        await addForeground(frames, files.length, w!, h!, mattes, {
          ...(signal && { signal }),
          onProgress: (f) => onProgress?.(0.5 + 0.4 * f),
        });
      // Just the people picked: the matte inside their tracked box (it can't tell people apart itself).
      if (person) await keepOnlyPeople(video, from, to, fps, files.length, w!, h!, mattes, person, signal);
    } else if (keep || person) {
      // Apple's Vision: just the people picked (or everyone), with the foreground or the objects at points.
      const atFrame = (points: ClipPoints) =>
        points.map((p) => ({
          f: Math.max(0, Math.min(files.length - 1, Math.round((p.at - from) * fps))),
          x: p.x,
          y: p.y,
        }));
      try {
        await liftMattes(
          frames,
          mattes,
          {
            count: files.length,
            people: person ? atFrame(person) : "all",
            objects: !keep ? "none" : keep === "subject" ? "all" : atFrame(keep),
          },
          signal,
        );
        onProgress?.(0.9);
      } catch (err) {
        if (!(err instanceof LiftUnavailable)) throw err;
        console.warn(`[cutout] ${err.message}: the person only`);
        await appleMattes(dir, frames, mattes, files, signal, onProgress);
      }
    } else await appleMattes(dir, frames, mattes, files, signal, onProgress);
    await mkdir(path.dirname(out), { recursive: true });
    const part = `${out}.part.webm`;
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-framerate",
        String(fps),
        "-i",
        path.join(frames, "%06d.png"),
        "-framerate",
        String(fps),
        "-i",
        path.join(mattes, "%06d.png"),
        // Smooth the mask a touch over time and space, so edges don't shimmer frame to frame.
        "-filter_complex",
        `[1]format=gray,scale=${w}:${h},tmix=frames=3,gblur=sigma=1.2[m];[0][m]alphamerge,format=yuva420p`,
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-b:v",
        "0",
        "-crf",
        "30",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-row-mt",
        "1",
        "-auto-alt-ref",
        "0",
        part,
      ],
      opts(signal),
    );
    await rename(part, out);
    onProgress?.(1);
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A photo's cutout, held for `to - from` seconds (the same kind of file as a clip's, so a photo shot plays it
 * like one): a few copies of the photo cut out together (the open matting model settles over a few frames),
 * the last one kept. Points on the photo work at any moment.
 */
export async function makeStillCutout(
  image: string,
  from: number,
  to: number,
  out: string,
  {
    fps = 30,
    keep,
    person,
    signal,
    onProgress,
  }: {
    fps?: number;
    keep?: Keep | undefined;
    person?: ClipPoints | undefined;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-still-"));
  const COPIES = 8;
  const span = COPIES / fps;
  const atStart = (points: ClipPoints) => points.map((p) => ({ ...p, at: 0 }));
  try {
    // The photo as a short lossless clip (odd sizes and alpha are fine in FFV1).
    const clip = path.join(dir, "still.mkv");
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-i",
        image,
        "-frames:v",
        String(COPIES),
        "-c:v",
        "ffv1",
        "-pix_fmt",
        "bgr0",
        clip,
      ],
      opts(signal),
    );
    const cut = path.join(dir, "cut.webm");
    await makeCutout(clip, 0, span, cut, {
      fps,
      ...(keep && { keep: keep === "subject" ? keep : atStart(keep) }),
      ...(person && { person: atStart(person) }),
      ...(signal && { signal }),
      ...(onProgress && { onProgress: (f) => onProgress(0.9 * f) }),
    });
    const last = path.join(dir, "cut.png");
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-c:v",
        "libvpx-vp9",
        "-i",
        cut,
        "-vf",
        `select=eq(n\\,${COPIES - 1})`,
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgba",
        last,
      ],
      opts(signal),
    );
    await mkdir(path.dirname(out), { recursive: true });
    const part = `${out}.part.webm`;
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-t",
        (to - from).toFixed(3),
        "-i",
        last,
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-b:v",
        "0",
        "-crf",
        "24",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-row-mt",
        "1",
        "-auto-alt-ref",
        "0",
        part,
      ],
      opts(signal),
    );
    await rename(part, out);
    onProgress?.(1);
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Where a project's derived footage lives (in its cache: safe to delete, remade when needed). */
export const derivedPaths = (projectDir: string) => ({
  /** `keep`: what it keeps with the person (keepTag; "" for the person alone). */
  cutout: (source: string, from: number, to: number, keep = "") =>
    path.join(
      projectDir,
      CACHE_DIR,
      "cutout",
      `${source}_${from.toFixed(2)}_${to.toFixed(2)}${keep ? `_${keep}` : ""}.webm`,
    ),
  ramp: (source: string, hash: string) => path.join(projectDir, CACHE_DIR, "ramp", `${source}_${hash}.mp4`),
  flow: (source: string, hash: string) => path.join(projectDir, CACHE_DIR, "flow", `${source}_${hash}.mp4`),
  /** A cover's stills from one moment of a clip: its frame, the person cut out, the background blurred. */
  cover: (source: string, t: number, part: string) =>
    path.join(projectDir, CACHE_DIR, "cover", `${source}_${t.toFixed(2)}_${part}.png`),
  blur: (source: string, from: number, to: number, amount: number, keep = "") =>
    path.join(
      projectDir,
      CACHE_DIR,
      "cutout",
      `${source}_${from.toFixed(2)}_${to.toFixed(2)}${keep ? `_${keep}` : ""}_blur${amount}.mp4`,
    ),
});

/**
 * The footage to derive from: the clip itself when it plays as it is (plain H.264), else its preview
 * copy (already converted from HDR or an awkward codec, so colours match what's shown).
 */
export async function derivationInput(projectDir: string, source: Source): Promise<string | null> {
  if (!source.path) return null;
  if (await renderableAsIs(source.path)) return source.path;
  const proxy = path.join(projectDir, CACHE_DIR, "proxy", `${source.id}.mp4`);
  return existsSync(proxy) ? proxy : source.path;
}

const making = new Map<string, Promise<string>>();

/** One make per file at a time, however many asks arrive while it runs. */
export function once(file: string, make: () => Promise<string>): Promise<string> {
  let hit = making.get(file);
  if (!hit) {
    hit = make().finally(() => making.delete(file));
    making.set(file, hit);
  }
  return hit;
}

/**
 * A derived media key ("<clip>~cutout~<from>~<to>", "<clip>~ramp~<hash>") to its file: a cutout once
 * it's been made, a ramped shot rendered now if it isn't yet (they take about a second).
 */
export async function resolveDerived(
  projectDir: string,
  doc: Pick<ProjectDoc, "scenes" | "sources">,
  key: string,
  fps: number,
): Promise<string | null> {
  const d = parseDerivedKey(key);
  if (!d) return null;
  const paths = derivedPaths(projectDir);
  if (d.kind === "cover") {
    const src = doc.sources.find((s) => s.id === d.source);
    if (!src) return null;
    // The person alone (and the background without them) needs a cutout.
    if (d.part !== "frame" && !cutoutsAvailable()) return null;
    const file = paths.cover(d.source, d.t, d.part === "blur" ? `blur${d.amount}` : d.part);
    if (existsSync(file)) return file;
    const input = await derivationInput(projectDir, src);
    if (!input) return null;
    return once(file, () => makeCoverStill(input, d.t, d.part, d.amount, file, path.dirname(file)));
  }
  if (d.kind === "cutout") {
    const file = paths.cutout(d.source, d.from, d.to, d.keep);
    return existsSync(file) ? file : null;
  }
  if (d.kind === "bgblur") {
    const file = paths.blur(d.source, d.from, d.to, d.amount, d.keep);
    return existsSync(file) ? file : null;
  }
  // Made in the background (they take a while): served once they exist.
  if (d.kind === "flow") {
    const file = paths.flow(d.source, d.hash);
    return existsSync(file) ? file : null;
  }
  const file = paths.ramp(d.source, d.hash);
  if (existsSync(file)) return file;
  const scene = doc.scenes.find(
    (s) => s.source === d.source && s.ramp?.length && rampHash(s, fps) === d.hash,
  );
  const src = doc.sources.find((s) => s.id === d.source);
  if (!scene?.ramp || !src) return null;
  const input = await derivationInput(projectDir, src);
  if (!input) return null;
  return once(file, () =>
    makeRamp(input, { in: scene.in, out: scene.out, ramp: scene.ramp! }, file, {
      fps,
      sourceFps: src.fps ?? 30,
    }),
  );
}

// --- Cover stills -------------------------------------------------------------------------------------

/**
 * One still of a cover, from `video` at `t`: the frame (PNG), the person cut out of it (PNG with
 * transparency), or the background without them blurred `amount` pixels (of a 1920-pixel frame).
 */
async function makeCoverStill(
  video: string,
  t: number,
  part: "frame" | "cut" | "blur",
  amount: number,
  out: string,
  dir: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const at = t.toFixed(3);
  const part_ = `${out}.part.png`;
  if (part === "frame") {
    await run("ffmpeg", ["-v", "error", "-y", "-ss", at, "-i", video, "-frames:v", "1", part_]);
    await rename(part_, out);
    return out;
  }
  // The person over a fifth of a second from t (segmentation smooths over neighbouring frames).
  const matte = path.join(dir, `${path.basename(out, ".png").replace(/_(cut|blur\d+)$/, "")}_cut.webm`);
  await once(matte, () =>
    existsSync(matte) ? Promise.resolve(matte) : makeCutout(video, t, t + 0.2, matte),
  );
  if (part === "cut") {
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-c:v",
      "libvpx-vp9",
      "-i",
      matte,
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgba",
      part_,
    ]);
    await rename(part_, out);
    return out;
  }
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    video,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number) as [number, number];
  const plate = `${out}.plate.mp4`;
  await makeBlurPlate(video, matte, t, t + 0.2, plate, {
    radius: Math.max(2, (amount * Math.max(w, h)) / 1920),
  });
  await run("ffmpeg", ["-v", "error", "-y", "-i", plate, "-frames:v", "1", part_]);
  await rm(plate, { force: true });
  await rename(part_, out);
  return out;
}

// --- Background blur plates ---------------------------------------------------------------------------

/** Frames of `bytes` each from a process's stdout, one at a time. */
async function* framesOf(child: ChildProcessWithoutNullStreams, bytes: number): AsyncGenerator<Buffer> {
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= bytes) {
      yield pending.subarray(0, bytes);
      pending = pending.subarray(bytes);
    }
  }
}

/** Box blur in place (one pass, both directions), radius r, on a w x h plane. */
function boxBlur(src: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      sum += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      src[y * w + x] = sum / n;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
}

/** Three box passes: close to a Gaussian with sigma about r. */
const gaussian = (p: Float32Array, tmp: Float32Array, w: number, h: number, r: number) => {
  for (let i = 0; i < 3; i++) boxBlur(p, tmp, w, h, Math.max(1, Math.round(r / Math.sqrt(3))));
};

/**
 * The background of [from, to) of `video`, blurred without the person in it: a normalised blur that
 * averages only pixels the cutout says are background, so hair and skin never smear into a dark halo
 * around them, and the person's area fills in from the background around it. `radius` is the blur in
 * source pixels. Worked at half size (it's blurred anyway), then scaled back up. No sound.
 */
export async function makeBlurPlate(
  video: string,
  cutout: string,
  from: number,
  to: number,
  out: string,
  { radius, fps = 30, signal }: { radius: number; fps?: number; signal?: AbortSignal },
): Promise<string> {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      cutout,
    ],
    opts(signal),
  );
  const [fw, fh] = stdout.trim().split(",").map(Number) as [number, number];
  const w = Math.max(2, Math.round(fw / 4) * 2);
  const h = Math.max(2, Math.round(fh / 4) * 2);
  const ffmpeg = await findBinary("ffmpeg");
  const spawnIt = (args: string[]) => {
    const child = spawn(ffmpeg, args, { stdio: ["pipe", "pipe", "pipe"] });
    signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
    child.stderr.resume();
    return child;
  };
  const picture = spawnIt([
    "-v",
    "error",
    "-ss",
    from.toFixed(3),
    "-t",
    (to - from).toFixed(3),
    "-i",
    video,
    "-vf",
    `fps=${fps},scale=${w}:${h}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
  // The cutout's alpha is the person; libvpx decodes VP9's alpha (the native decoder drops it).
  const matte = spawnIt([
    "-v",
    "error",
    "-c:v",
    "libvpx-vp9",
    "-i",
    cutout,
    "-vf",
    `alphaextract,scale=${w}:${h}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "-",
  ]);
  await mkdir(path.dirname(out), { recursive: true });
  const part = `${out}.part.mp4`;
  const encode = spawnIt([
    "-v",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${w}x${h}`,
    "-r",
    String(fps),
    "-i",
    "-",
    "-vf",
    `scale=${fw}:${fh}:flags=bicubic,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    part,
  ]);
  const done = new Promise<void>((resolve, reject) => {
    encode.on("error", reject);
    encode.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Encoding the plate failed (${code})`)),
    );
  });
  const size = w * h;
  const r = Math.max(1, radius / 2);
  const weight = new Float32Array(size);
  const tmp = new Float32Array(size);
  const base = [new Float32Array(size), new Float32Array(size), new Float32Array(size)];
  const planes = [new Float32Array(size), new Float32Array(size), new Float32Array(size)];
  const den = new Float32Array(size);
  const filled = new Uint8Array(size);
  const result = Buffer.alloc(size * 3);
  const mattes = framesOf(matte, size);
  for await (const frame of framesOf(picture, size * 3)) {
    const m = (await mattes.next()).value as Buffer | undefined;
    // Background weight: 0 on the person and a few pixels past their edge (hair's soft fringe), 1 beyond.
    for (let i = 0; i < size; i++) weight[i] = m ? m[i]! / 255 : 0;
    boxBlur(weight, tmp, w, h, 2);
    for (let i = 0; i < size; i++) weight[i] = weight[i]! < 0.02 ? 1 : Math.max(0, 1 - weight[i]! / 0.08);
    for (let c = 0; c < 3; c++) {
      const b = base[c]!;
      for (let i = 0; i < size; i++) b[i] = (frame[i * 3 + c]! / 255) * weight[i]!;
    }
    // The blur asked for; where the person covers more than it reaches, wider and wider until every
    // pixel has background to average. The person never shows through their own background.
    filled.fill(0);
    let left = size;
    for (let reach = r, first = true; left > 0 && reach < 4 * Math.max(w, h); reach *= 4, first = false) {
      den.set(weight);
      gaussian(den, tmp, w, h, reach);
      for (let c = 0; c < 3; c++) {
        planes[c]!.set(base[c]!);
        gaussian(planes[c]!, tmp, w, h, reach);
      }
      const enough = first ? 0.05 : 1e-3;
      for (let i = 0; i < size; i++) {
        if (filled[i] || den[i]! <= enough) continue;
        for (let c = 0; c < 3; c++)
          result[i * 3 + c] = Math.max(0, Math.min(255, Math.round((planes[c]![i]! / den[i]!) * 255)));
        filled[i] = 1;
        left--;
      }
    }
    if (left > 0) {
      // Still some (the person fills the frame): the background's average colour, or the frame itself
      // when there's no background at all.
      let total = 0;
      const sum = [0, 0, 0];
      for (let i = 0; i < size; i++) {
        total += weight[i]!;
        for (let c = 0; c < 3; c++) sum[c]! += base[c]![i]!;
      }
      for (let i = 0; i < size; i++) {
        if (filled[i]) continue;
        for (let c = 0; c < 3; c++)
          result[i * 3 + c] = total > 1 ? Math.round((sum[c]! / total) * 255) : frame[i * 3 + c]!;
      }
    }
    if (!encode.stdin.write(result)) await new Promise((r2) => encode.stdin.once("drain", r2));
  }
  encode.stdin.end();
  await done;
  await rename(part, out);
  return out;
}
