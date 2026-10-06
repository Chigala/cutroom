/**
 * Cutouts that pick who and what on macOS 14+ (Apple's Vision): just the people picked by points (person
 * instance masks), and what stays in front with them (subject lifting, the "lift subject" of Photos:
 * everything in the foreground, or the objects at points), followed from frame to frame. For a shot's
 * person and keep. Compiled with the app's tools; in development, on first use.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundledTool, run } from "./exec.ts";
import { compileSwift } from "./hear.ts";

const LIFT_SWIFT = String.raw`
// lift <frames dir> <mattes dir> <spec.json>
// Mattes (%06d.png, white = kept) of the people and what stays in front with them, frame by frame. spec:
//   {"count": frames, "people": "all" | [points], "objects": "none" | "all" | [points]}
// points: [{"f": frame (0-based), "x": 0..1, "y": 0..1}] from the top left. "all" people: everyone, with
// Apple's most careful person edges; points: just those people (person instance masks). Objects: the
// foreground's (subject lifting: the mic they hold, a product), all or the ones at points. What's picked
// by points is followed from frame to frame. Exits 3 before macOS 14 (no instance masks there).
import CoreImage
import Foundation
import ImageIO
import Vision

struct Point: Decodable { let f: Int; let x: Double; let y: Double }
enum Pick: Decodable {
  case all, none, points([Point])
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let s = try? c.decode(String.self) { self = s == "none" ? .none : .all } else { self = .points(try c.decode([Point].self)) }
  }
}
struct Spec: Decodable { let count: Int; let people: Pick; let objects: Pick }

let args = CommandLine.arguments
guard args.count >= 4, let data = FileManager.default.contents(atPath: args[3]),
  let spec = try? JSONDecoder().decode(Spec.self, from: data)
else {
  FileHandle.standardError.write("usage: lift <frames> <mattes> <spec.json>\n".data(using: .utf8)!)
  exit(2)
}
let framesDir = URL(fileURLWithPath: args[1])
let mattesDir = URL(fileURLWithPath: args[2])
guard #available(macOS 14.0, *) else { exit(3) }

let context = CIContext(options: [.workingColorSpace: NSNull()])
let gray = CGColorSpaceCreateDeviceGray()

func image(_ i: Int) -> CGImage? {
  let url = framesDir.appendingPathComponent(String(format: "%06d.png", i + 1))
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

/// An instance mask's labels (0 = nothing), with its size.
struct Labels { let data: [UInt8]; let w: Int; let h: Int }

@available(macOS 14.0, *)
func labels(_ obs: VNInstanceMaskObservation) -> Labels {
  let buf = obs.instanceMask
  CVPixelBufferLockBaseAddress(buf, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
  let w = CVPixelBufferGetWidth(buf), h = CVPixelBufferGetHeight(buf), row = CVPixelBufferGetBytesPerRow(buf)
  let base = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self)
  var out = [UInt8](repeating: 0, count: w * h)
  for y in 0..<h { for x in 0..<w { out[y * w + x] = base[y * row + x] } }
  return Labels(data: out, w: w, h: h)
}

/// One frame's instances: the people (person instance masks) or the foreground's objects.
@available(macOS 14.0, *)
func instances(_ cg: CGImage, people: Bool) -> (VNInstanceMaskObservation, VNImageRequestHandler)? {
  let handler = VNImageRequestHandler(cgImage: cg)
  let req: VNImageBasedRequest = people ? VNGeneratePersonInstanceMaskRequest() : VNGenerateForegroundInstanceMaskRequest()
  try? handler.perform([req])
  guard let obs = (req.results as? [VNInstanceMaskObservation])?.first else { return nil }
  return (obs, handler)
}

func under(_ l: Labels, _ pts: [Point]) -> IndexSet {
  var set = IndexSet()
  for p in pts {
    let x = min(l.w - 1, max(0, Int(p.x * Double(l.w)))), y = min(l.h - 1, max(0, Int(p.y * Double(l.h))))
    let v = Int(l.data[y * l.w + x])
    if v > 0 { set.insert(v) }
  }
  return set
}

/// The instances that carry on the ones picked in the frame before: most of their area lies where those
/// were, or they cover most of it.
func follow(_ l: Labels, _ prev: [Bool]) -> IndexSet {
  guard prev.count == l.data.count else { return IndexSet() }
  var area = [Int: Int](), overlap = [Int: Int]()
  let picked = prev.filter { $0 }.count
  for (k, v) in l.data.enumerated() where v > 0 {
    area[Int(v), default: 0] += 1
    if prev[k] { overlap[Int(v), default: 0] += 1 }
  }
  var set = IndexSet()
  for (v, a) in area {
    let o = overlap[v] ?? 0
    if Double(o) / Double(a) > 0.4 || (picked > 0 && Double(o) / Double(picked) > 0.4) { set.insert(v) }
  }
  return set
}

/// Which instances each frame keeps, for points: picked at their frames, followed both ways from the first.
@available(macOS 14.0, *)
func track(_ pts: [Point], people: Bool) -> [IndexSet] {
  var sets = [IndexSet](repeating: IndexSet(), count: spec.count)
  let at = Dictionary(grouping: pts, by: { min(spec.count - 1, max(0, $0.f)) })
  guard let first = at.keys.min() else { return sets }
  func step(_ i: Int, _ prev: [Bool]?) -> [Bool]? {
    guard let cg = image(i), let (obs, _) = instances(cg, people: people) else { return prev }
    let l = labels(obs)
    let set = at[i].map { under(l, $0) } ?? prev.map { follow(l, $0) } ?? IndexSet()
    sets[i] = set
    return l.data.map { $0 > 0 && set.contains(Int($0)) }
  }
  var prev: [Bool]? = nil
  var atFirst: [Bool]? = nil
  for i in first..<spec.count {
    prev = step(i, prev)
    if i == first { atFirst = prev }
  }
  prev = atFirst
  if first > 0 { for i in stride(from: first - 1, through: 0, by: -1) { prev = step(i, prev) } }
  return sets
}

if #available(macOS 14.0, *) {
  var peopleSets: [IndexSet]? = nil
  if case .points(let pts) = spec.people { peopleSets = track(pts, people: true) }
  var objectSets: [IndexSet]? = nil
  if case .points(let pts) = spec.objects { objectSets = track(pts, people: false) }
  for i in 0..<spec.count {
    guard let cg = image(i) else { continue }
    let w = cg.width, h = cg.height
    let frame = CGRect(x: 0, y: 0, width: w, height: h)
    var out = CIImage(color: .black).cropped(to: frame)
    func add(_ m: CIImage) {
      let scaled = m.transformed(by: CGAffineTransform(scaleX: CGFloat(w) / m.extent.width, y: CGFloat(h) / m.extent.height))
      out = scaled.applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: out])
    }
    // The people: everyone with the careful person edges, or the ones picked.
    if let sets = peopleSets {
      if !sets[i].isEmpty, let (obs, handler) = instances(cg, people: true),
        let buf = try? obs.generateScaledMaskForImage(forInstances: sets[i], from: handler)
      { add(CIImage(cvPixelBuffer: buf)) }
    } else {
      let req = VNGeneratePersonSegmentationRequest()
      req.qualityLevel = .accurate
      req.outputPixelFormat = kCVPixelFormatType_OneComponent8
      try? VNImageRequestHandler(cgImage: cg).perform([req])
      if let p = req.results?.first?.pixelBuffer { add(CIImage(cvPixelBuffer: p)) }
    }
    // What stays in front with them.
    var objects: IndexSet? = nil
    switch spec.objects {
    case .none: break
    case .all: objects = nil
    case .points: objects = objectSets![i]
    }
    if case .none = spec.objects {} else if let (obs, handler) = instances(cg, people: false) {
      let set = objects ?? obs.allInstances
      if !set.isEmpty, let buf = try? obs.generateScaledMaskForImage(forInstances: set, from: handler) { add(CIImage(cvPixelBuffer: buf)) }
    }
    let url = mattesDir.appendingPathComponent(String(format: "%06d.png", i + 1))
    try? context.writePNGRepresentation(of: out.cropped(to: frame), to: url, format: .L8, colorSpace: gray)
    print("progress \(i + 1)/\(spec.count)")
  }
}
`;

/** Compiles the subject lifter to `out` (the app's build bundles it). Throws when it can't. */
export function compileLift(out: string, target?: string): Promise<void> {
  return compileSwift(LIFT_SWIFT, "lift", out, target);
}

let building: Promise<string | null> | null = null;

/** The subject lifter: shipped with the app, else compiled once beside the models. Null off macOS. */
export function ensureLift(): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  const shipped = bundledTool("lift");
  if (shipped) return Promise.resolve(shipped);
  const dir = process.env.VEDIT_MODELS
    ? path.join(path.dirname(process.env.VEDIT_MODELS), "tools")
    : path.join(tmpdir(), "cutroom-tools");
  const bin = path.join(dir, "lift");
  if (existsSync(bin)) return Promise.resolve(bin);
  building ??= (async () => {
    try {
      await mkdir(dir, { recursive: true });
      await compileLift(bin);
      return bin;
    } catch (err) {
      console.warn("[lift] the subject lifter couldn't be built:", (err as Error).message.split("\n")[0]);
      return null;
    } finally {
      building = null;
    }
  })();
  return building;
}

/** Subject lifting isn't on this Mac (before macOS 14): the cutout keeps the person only. */
export class LiftUnavailable extends Error {
  override name = "LiftUnavailable";
}

/** Points on the frames being cut out: frame (0-based) and shares of the picture from the top left. */
export type FramePoint = { readonly f: number; readonly x: number; readonly y: number };

/**
 * Mattes of the people and what's kept with them, for `count` frames (%06d.png) in `frames`, into
 * `mattes`: people "all" (everyone) or points; objects "none", "all" (the foreground) or points.
 */
export async function liftMattes(
  frames: string,
  mattes: string,
  spec: {
    readonly count: number;
    readonly people: "all" | readonly FramePoint[];
    readonly objects: "none" | "all" | readonly FramePoint[];
  },
  signal?: AbortSignal,
): Promise<void> {
  const bin = await ensureLift();
  if (!bin) throw new LiftUnavailable("Picking who and what isn't available on this Mac");
  const file = path.join(path.dirname(mattes), "lift.json");
  await writeFile(file, JSON.stringify(spec));
  try {
    await run(bin, [frames, mattes, file], signal ? { signal } : {});
  } catch (err) {
    // Exit 3: before macOS 14.
    if (/exited with 3\b/.test((err as Error).message)) throw new LiftUnavailable("Needs macOS 14");
    throw err;
  }
}
