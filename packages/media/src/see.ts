/**
 * What's in a clip's picture, a frame a second, for the agent and the editor: the words on screen (signs,
 * slides, screens, captions already burned in) and where; where the eye goes (saliency); and how good
 * each moment looks (face capture quality: eyes open, sharp, facing; an overall look score; sharpness).
 * Apple's Vision on macOS (a small tool compiled with the app's tools); open models elsewhere (see-open.ts).
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundledTool, run } from "./exec.ts";
import { compileSwift } from "./hear.ts";
import { useOpenModels } from "./models.ts";
import { seeOpen } from "./see-open.ts";

const SEE_SWIFT = String.raw`
// see <frames dir> <count>
// What's in each frame (%06d.png), one JSON line each: {"i": frame (0-based), "text": [[words, confidence,
// x, y, w, h]], "salient": [[x, y, w, h]], "faces": [[x, y, w, h, quality]], "look": aesthetics -1..1,
// "utility": a screenshot or document rather than a photo}. Boxes are shares of the frame from the top
// left. The look score needs macOS 15; the rest works on any macOS the app runs on.
import Foundation
import ImageIO
import Vision

let args = CommandLine.arguments
guard args.count >= 3, let count = Int(args[2]) else {
  FileHandle.standardError.write("usage: see <frames> <count>\n".data(using: .utf8)!)
  exit(2)
}
let dir = URL(fileURLWithPath: args[1])

/// Vision's boxes have their origin at the bottom left: as shares from the top left.
func box(_ r: CGRect) -> [Double] {
  [r.minX, 1 - r.maxY, r.width, r.height].map { (Double($0) * 10000).rounded() / 10000 }
}
func round3(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }

for i in 0..<count {
  let url = dir.appendingPathComponent(String(format: "%06d.png", i + 1))
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let cg = CGImageSourceCreateImageAtIndex(src, 0, nil)
  else { continue }
  let handler = VNImageRequestHandler(cgImage: cg)
  let text = VNRecognizeTextRequest()
  text.recognitionLevel = .accurate
  text.usesLanguageCorrection = true
  let salient = VNGenerateAttentionBasedSaliencyImageRequest()
  let faces = VNDetectFaceCaptureQualityRequest()
  var requests: [VNRequest] = [text, salient, faces]
  var look: VNRequest? = nil
  // Only an Xcode 16 (Swift 6) SDK has it; built with an older one, there's no look score.
  #if compiler(>=6.0)
  if #available(macOS 15.0, *) {
    let r = VNCalculateImageAestheticsScoresRequest()
    look = r
    requests.append(r)
  }
  #endif
  try? handler.perform(requests)
  var line: [String: Any] = ["i": i]
  line["text"] = (text.results ?? []).compactMap { o -> [Any]? in
    guard let c = o.topCandidates(1).first, !c.string.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    return [c.string, round3(Double(c.confidence))] + box(o.boundingBox)
  }
  line["salient"] = (salient.results?.first?.salientObjects ?? []).map { box($0.boundingBox) }
  line["faces"] = (faces.results ?? []).map { f -> [Double] in box(f.boundingBox) + [round3(Double(f.faceCaptureQuality ?? 0))] }
  #if compiler(>=6.0)
  if #available(macOS 15.0, *), let r = (look as? VNCalculateImageAestheticsScoresRequest)?.results?.first {
    line["look"] = round3(Double(r.overallScore))
    line["utility"] = r.isUtility
  }
  #endif
  if let data = try? JSONSerialization.data(withJSONObject: line), let s = String(data: data, encoding: .utf8) {
    print(s)
    fflush(stdout)
  }
}
`;

/** One sampled frame, as either side reads it. Boxes: shares of the frame from the top left. */
export interface FrameSeen {
  readonly t: number;
  readonly text: readonly { readonly s: string; readonly box: Box4 }[];
  readonly salient: readonly Box4[];
  /** The best face's capture quality, 0..1. */
  readonly face?: number;
  /** The look (aesthetics), -1..1 (macOS 15+). */
  readonly look?: number;
  /** Sharpness, 0..1 (where there's no face quality). */
  readonly sharp?: number;
}
export type Box4 = readonly [x: number, y: number, w: number, h: number];

/** What a clip shows, as its analysis keeps it. */
export interface Seen {
  readonly text: { start: number; end: number; text: string; x: number; y: number; w: number; h: number }[];
  readonly salient: { t: number; x: number; y: number; w: number; h: number }[];
  readonly quality: { t: number; face?: number; look?: number; sharp?: number }[];
}

/** Compiles the seeing tool to `out` (the app's build bundles it). */
export function compileSee(out: string, target?: string): Promise<void> {
  return compileSwift(SEE_SWIFT, "see", out, target);
}

let building: Promise<string | null> | null = null;

/** The seeing tool: shipped with the app, else compiled once beside the models. Null off macOS. */
export function ensureSee(): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  const shipped = bundledTool("see");
  if (shipped) return Promise.resolve(shipped);
  const dir = process.env.VEDIT_MODELS
    ? path.join(path.dirname(process.env.VEDIT_MODELS), "tools")
    : path.join(tmpdir(), "cutroom-tools");
  const bin = path.join(dir, "see");
  if (existsSync(bin)) return Promise.resolve(bin);
  building ??= (async () => {
    try {
      await mkdir(dir, { recursive: true });
      await compileSee(bin);
      return bin;
    } catch (err) {
      console.warn("[see] the seeing tool couldn't be built:", (err as Error).message.split("\n")[0]);
      return null;
    } finally {
      building = null;
    }
  })();
  return building;
}

/** Frames a second apart from the clip (up to 720 px tall), in a scratch folder. */
async function sample(video: string, rate: number, signal?: AbortSignal) {
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-see-"));
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      video,
      "-vf",
      `fps=${rate},scale=-2:'min(720,ih)'`,
      path.join(dir, "%06d.png"),
    ],
    signal ? { signal } : {},
  );
  const count = (await readdir(dir)).filter((f) => f.endsWith(".png")).length;
  return { dir, count };
}

/** Reads the clip's picture once a second (`rate`). Null where nothing can (no tool, no models). */
export async function seeClip(
  video: string,
  { rate = 1, signal }: { rate?: number; signal?: AbortSignal } = {},
): Promise<Seen | null> {
  const open = useOpenModels();
  const bin = open ? null : await ensureSee();
  if (!open && !bin) return null;
  const { dir, count } = await sample(video, rate, signal);
  try {
    if (!count) return { text: [], salient: [], quality: [] };
    const frames = open
      ? await seeOpen(dir, count, rate, signal)
      : await seeApple(bin!, dir, count, rate, signal);
    return summarize(frames, rate);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seeApple(
  bin: string,
  dir: string,
  count: number,
  rate: number,
  signal?: AbortSignal,
): Promise<FrameSeen[]> {
  const { stdout } = await run(bin, [dir, String(count)], signal ? { signal } : {});
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => {
      const j = JSON.parse(l) as {
        i: number;
        text: [string, number, number, number, number, number][];
        salient: Box4[];
        faces: [number, number, number, number, number][];
        look?: number;
      };
      const best = Math.max(0, ...j.faces.map((f) => f[4]));
      return {
        t: j.i / rate,
        // What it's fairly sure of.
        text: j.text
          .filter((x) => x[1] >= 0.4)
          .map((x) => ({ s: x[0], box: [x[2], x[3], x[4], x[5]] as Box4 })),
        salient: j.salient,
        ...(j.faces.length && { face: best }),
        ...(j.look !== undefined && { look: j.look }),
      };
    });
}

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** A share of the frame, kept inside it (boxes at the edge come back a touch outside). */
const u = (v: number) => r3(Math.min(1, Math.max(0, v)));
/** A box clipped to the frame. */
const inFrame = ([x, y, w, h]: readonly number[]) => {
  const x1 = u(x!);
  const y1 = u(y!);
  return { x: x1, y: y1, w: r3(u(x! + w!) - x1), h: r3(u(y! + h!) - y1) };
};

/**
 * Frames into what a clip's analysis keeps: each piece of text as one stretch while it stays on screen
 * (missed for one sample at most, a blurred frame), where the eye goes and how good it looks at each sample.
 */
export function summarize(frames: readonly FrameSeen[], rate: number): Seen {
  const step = 1 / rate;
  const runs: Seen["text"] = [];
  const open = new Map<string, Seen["text"][number]>();
  for (const f of frames) {
    for (const x of f.text) {
      const k = key(x.s);
      if (k.length < 2) continue;
      const run = open.get(k);
      if (run && f.t - run.end <= step + 1e-6) run.end = r3(f.t + step);
      else {
        const fresh = {
          start: r3(f.t),
          end: r3(f.t + step),
          text: x.s.trim().slice(0, 200),
          ...inFrame(x.box),
        };
        runs.push(fresh);
        open.set(k, fresh);
      }
    }
  }
  // The box around what draws the eye: all the salient objects together.
  const salient = frames.flatMap((f) => {
    if (!f.salient.length) return [];
    const x1 = Math.min(...f.salient.map((b) => b[0]));
    const y1 = Math.min(...f.salient.map((b) => b[1]));
    const x2 = Math.max(...f.salient.map((b) => b[0] + b[2]));
    const y2 = Math.max(...f.salient.map((b) => b[1] + b[3]));
    return [{ t: r3(f.t), ...inFrame([x1, y1, x2 - x1, y2 - y1]) }];
  });
  const quality = frames.map((f) => ({
    t: r3(f.t),
    ...(f.face !== undefined && { face: u(f.face) }),
    ...(f.look !== undefined && { look: r3(Math.min(1, Math.max(-1, f.look))) }),
    ...(f.sharp !== undefined && { sharp: u(f.sharp) }),
  }));
  return { text: runs.slice(0, 400), salient, quality };
}
