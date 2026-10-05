/**
 * Hearing, on device. Claude can't take audio in, so the editor listens for it and writes down what it
 * heard, the way the visual transcript writes down what's on screen:
 *
 *   sounds     laughter, applause, cheering, a gasp, a crowd, music, a phone, a door... with times, from
 *              Apple's sound classifier (SoundAnalysis, about 300 sounds, ~100x real time)
 *   emphasis   how hard each word is said: louder, higher or drawn out against the words around it
 *   character  a music track's instruments (piano, strings, synth, drums...), for its feel
 *
 * The classifier runs in a small native helper compiled once on the Mac (macOS only; elsewhere hearing
 * is simply absent and everything else works as before).
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundledTool, run } from "./exec.ts";

const HEAR_SWIFT = `
import Foundation
import SoundAnalysis

// hear <audio file> [window seconds] [overlap 0..1]: one JSON line per window, its likeliest sounds.
final class Observer: NSObject, SNResultsObserving {
  func request(_ request: SNRequest, didProduce result: SNResult) {
    guard let r = result as? SNClassificationResult else { return }
    let top = r.classifications.prefix(8).filter { $0.confidence > 0.1 }
      .map { "[\\"\\($0.identifier)\\",\\(String(format: "%.3f", $0.confidence))]" }.joined(separator: ",")
    print("{\\"t\\":\\(String(format: "%.3f", r.timeRange.start.seconds)),\\"d\\":\\(String(format: "%.3f", r.timeRange.duration.seconds)),\\"c\\":[\\(top)]}")
  }
  func request(_ request: SNRequest, didFailWithError error: Error) {
    FileHandle.standardError.write("failed: \\(error)\\n".data(using: .utf8)!)
  }
}
let args = CommandLine.arguments
guard args.count > 1 else { exit(2) }
do {
  let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
  if args.count > 2, let w = Double(args[2]) { request.windowDuration = CMTime(seconds: w, preferredTimescale: 1000) }
  if args.count > 3, let o = Double(args[3]) { request.overlapFactor = o }
  let analyzer = try SNAudioFileAnalyzer(url: URL(fileURLWithPath: args[1]))
  let observer = Observer()
  try analyzer.add(request, withObserver: observer)
  analyzer.analyze()
} catch {
  FileHandle.standardError.write("error: \\(error)\\n".data(using: .utf8)!)
  exit(1)
}
`;

let building: Promise<string | null> | null = null;

/**
 * The sound classifier, compiled into `dir` on first use (a few seconds, once). Null where it can't be
 * built (not macOS, no Swift compiler).
 */
export function ensureHear(dir: string): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  // Built with the app: no compiler needed on this Mac.
  const shipped = bundledTool("hear");
  if (shipped) return Promise.resolve(shipped);
  const bin = path.join(dir, "hear");
  if (existsSync(bin)) return Promise.resolve(bin);
  building ??= build(dir, bin).finally(() => {
    building = null;
  });
  return building;
}

/**
 * Compiles the sound classifier to `out` (the app's build bundles it; `target` builds for another
 * architecture, e.g. "x86_64-apple-macos12"). Throws when it can't.
 */
export async function compileHear(out: string, target?: string): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), "vedit-hear-"));
  try {
    const src = path.join(work, "hear.swift");
    await writeFile(src, HEAR_SWIFT);
    const built = path.join(work, "hear");
    const t = target ? ["-target", target] : [];
    try {
      await run("swiftc", ["-O", ...t, src, "-o", built]);
    } catch {
      // Some Command Line Tools installs ship the Swift bridging module map twice, which breaks every
      // compile; hide the duplicate from the compiler (nothing on disk changes).
      const empty = path.join(work, "empty.modulemap");
      await writeFile(empty, "");
      const overlay = path.join(work, "overlay.yaml");
      await writeFile(
        overlay,
        JSON.stringify({
          version: 0,
          roots: [
            {
              name: "/Library/Developer/CommandLineTools/usr/include/swift",
              type: "directory",
              contents: [{ name: "bridging.modulemap", type: "file", "external-contents": empty }],
            },
          ],
        }),
      );
      await run("swiftc", [
        "-O",
        ...t,
        "-Xcc",
        "-ivfsoverlay",
        "-Xcc",
        overlay,
        "-vfsoverlay",
        overlay,
        src,
        "-o",
        built,
      ]);
    }
    await mkdir(path.dirname(out), { recursive: true });
    await rename(built, out);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function build(dir: string, bin: string): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true });
    await compileHear(bin);
    return bin;
  } catch (err) {
    console.warn("[hear] the sound classifier couldn't be built:", (err as Error).message.split("\n")[0]);
    return null;
  }
}

export interface SoundEvent {
  /** Seconds, the clip's own time. */
  readonly start: number;
  readonly end: number;
  readonly label: string;
  /** 0..1, the strongest window. */
  readonly confidence: number;
}

/**
 * The sounds worth knowing about for editing, by Apple's name: what we call each, how sure the
 * classifier must be, and whether one window (half a second) is enough (short sounds) or it must last.
 */
const EDIT_SOUNDS: Readonly<Record<string, { name: string; min: number; brief?: boolean }>> = {
  laughter: { name: "laughter", min: 0.5, brief: true },
  belly_laugh: { name: "laughter", min: 0.4, brief: true },
  chuckle_chortle: { name: "laughter", min: 0.45, brief: true },
  giggle: { name: "laughter", min: 0.45, brief: true },
  snicker: { name: "laughter", min: 0.5, brief: true },
  applause: { name: "applause", min: 0.4 },
  clapping: { name: "applause", min: 0.5 },
  cheering: { name: "cheering", min: 0.4 },
  crowd: { name: "crowd", min: 0.5 },
  gasp: { name: "gasp", min: 0.6, brief: true },
  sigh: { name: "sigh", min: 0.75, brief: true },
  whispering: { name: "whispering", min: 0.5 },
  shout: { name: "shouting", min: 0.5, brief: true },
  yell: { name: "shouting", min: 0.5, brief: true },
  screaming: { name: "screaming", min: 0.5, brief: true },
  singing: { name: "singing", min: 0.5 },
  rapping: { name: "rapping", min: 0.5 },
  music: { name: "music", min: 0.5 },
  cough: { name: "cough", min: 0.8, brief: true },
  sneeze: { name: "sneeze", min: 0.8, brief: true },
  door_slam: { name: "door slam", min: 0.7, brief: true },
  knock: { name: "knock", min: 0.75, brief: true },
  telephone_bell_ringing: { name: "phone ringing", min: 0.5 },
  ringtone: { name: "phone ringing", min: 0.5 },
  camera: { name: "camera shutter", min: 0.7, brief: true },
  typing: { name: "typing", min: 0.6 },
  typing_computer_keyboard: { name: "typing", min: 0.6 },
  wind_noise_microphone: { name: "wind on the mic", min: 0.5 },
  dog: { name: "dog", min: 0.7, brief: true },
  bark: { name: "dog", min: 0.7, brief: true },
  baby_crying: { name: "baby crying", min: 0.5 },
  silence: { name: "silence", min: 0.85 },
};

const INSTRUMENTS: Readonly<Record<string, string>> = {
  piano: "piano",
  electric_piano: "electric piano",
  organ: "organ",
  hammond_organ: "organ",
  synthesizer: "synth",
  guitar: "guitar",
  acoustic_guitar: "acoustic guitar",
  electric_guitar: "electric guitar",
  bass_guitar: "bass",
  double_bass: "bass",
  drum_kit: "drums",
  drum: "drums",
  snare_drum: "drums",
  bass_drum: "kick drum",
  percussion: "percussion",
  orchestra: "orchestra",
  bowed_string_instrument: "strings",
  violin_fiddle: "strings",
  cello: "strings",
  french_horn: "brass",
  trumpet: "brass",
  trombone: "brass",
  saxophone: "saxophone",
  flute: "flute",
  clarinet: "clarinet",
  harp: "harp",
  choir_singing: "choir",
  singing: "vocals",
  rapping: "rap vocals",
  ukulele: "ukulele",
  banjo: "banjo",
  bell: "bells",
  marimba_xylophone: "mallets",
  vibraphone: "mallets",
};

interface Window {
  readonly t: number;
  readonly d: number;
  readonly c: readonly [string, number][];
}

async function classify(bin: string, file: string, signal?: AbortSignal): Promise<Window[]> {
  const { stdout } = await run(bin, [file, "1.0", "0.5"], signal ? { signal } : {});
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Window);
}

/** What a clip's sound is, over time: the editing-relevant sounds heard, and (for music) its instruments. */
export async function hearSounds(
  bin: string,
  file: string,
  signal?: AbortSignal,
): Promise<{ sounds: SoundEvent[]; instruments: { name: string; share: number }[] }> {
  const windows = await classify(bin, file, signal);
  // Sounds: each label's qualifying windows, joined across short gaps into events.
  const open = new Map<
    string,
    { start: number; end: number; confidence: number; windows: number; brief: boolean }
  >();
  const sounds: SoundEvent[] = [];
  const close = (name: string) => {
    const e = open.get(name)!;
    open.delete(name);
    if (e.windows >= 2 || e.brief)
      sounds.push({
        start: round(e.start),
        end: round(e.end),
        label: name,
        confidence: round(e.confidence),
      });
  };
  for (const w of windows) {
    const here = new Map<string, number>();
    for (const [id, c] of w.c) {
      const s = EDIT_SOUNDS[id];
      if (s && c >= s.min) here.set(s.name, Math.max(here.get(s.name) ?? 0, c));
    }
    for (const name of [...open.keys()]) if (!here.has(name) && w.t - open.get(name)!.end > 0.6) close(name);
    for (const [name, c] of here) {
      const e = open.get(name);
      const brief = Object.values(EDIT_SOUNDS).some((s) => s.name === name && s.brief);
      if (e) {
        e.end = w.t + w.d;
        e.confidence = Math.max(e.confidence, c);
        e.windows++;
      } else open.set(name, { start: w.t, end: w.t + w.d, confidence: c, windows: 1, brief });
    }
  }
  for (const name of [...open.keys()]) close(name);
  sounds.sort((a, b) => a.start - b.start);
  // Instruments: how much of the track each is heard in.
  const counts = new Map<string, number>();
  for (const w of windows) {
    const here = new Set<string>();
    for (const [id, c] of w.c) if (INSTRUMENTS[id] && c >= 0.25) here.add(INSTRUMENTS[id]!);
    for (const n of here) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const instruments = [...counts]
    .map(([name, n]) => ({ name, share: round(n / Math.max(1, windows.length)) }))
    .filter((i) => i.share >= 0.08)
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);
  return { sounds, instruments };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * How hard each word is said, 0..1: louder, higher-pitched or drawn out compared with the words around
 * it (the speaker's own baseline, so a quiet speaker's emphasis still shows). From the 16 kHz mono
 * speech wav indexing makes. Words are [start, end] in the clip's time.
 */
export async function wordStress(
  wav: string,
  words: readonly { start: number; end: number; text: string }[],
): Promise<number[]> {
  const buf = await readFile(wav);
  // 16-bit samples at 16 kHz after the WAV's "data" chunk header; worked at 8 kHz (pairs averaged).
  const data = buf.indexOf("data", 12, "ascii");
  const at = data < 0 ? 44 : data + 8;
  const n = Math.floor((buf.length - at) / 4);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (buf.readInt16LE(at + i * 4) + buf.readInt16LE(at + 2 + i * 4)) / 65536;
  const rate = 8000;
  const pct = (v: number[], q: number) => {
    if (!v.length) return 0;
    const sorted = [...v].sort((p, r) => p - r);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  };
  const feats = words.map((w) => {
    const a = Math.max(0, Math.floor(w.start * rate));
    const b = Math.min(n, Math.ceil(w.end * rate));
    if (b - a < 160) return { loud: -60, pitch: 0, stretch: 0 };
    // Loudness at the word's peak (20 ms frames, the 90th percentile): its quiet edges don't count.
    const frames: number[] = [];
    for (let f = a; f + 160 <= b; f += 80) {
      let e = 0;
      for (let i = f; i < f + 160; i++) e += x[i]! * x[i]!;
      frames.push(10 * Math.log10(e / 160 + 1e-9));
    }
    const loud = pct(frames, 0.9);
    // Pitch: autocorrelation over 40 ms frames, 70-400 Hz; its high point (where an accent lands).
    const pitches: number[] = [];
    for (let f = a; f + 320 <= b; f += 160) {
      let best = 0;
      let lag = 0;
      let e0 = 0;
      for (let i = 0; i < 320; i++) e0 += x[f + i]! * x[f + i]!;
      if (e0 < 1e-6) continue;
      for (let l = 20; l <= 114; l++) {
        let s = 0;
        for (let i = 0; i + l < 320; i++) s += x[f + i]! * x[f + i + l]!;
        if (s > best) {
          best = s;
          lag = l;
        }
      }
      if (lag && best / e0 > 0.3) pitches.push(rate / lag);
    }
    const pitch = pitches.length ? pct(pitches, 0.8) : 0;
    const letters = Math.max(1, w.text.replace(/[^\p{L}\p{N}]/gu, "").length);
    return { loud, pitch, stretch: (w.end - w.start) / letters };
  });
  // Against the words around it (about a dozen either side): the speaker's own baseline.
  const z = (key: "loud" | "pitch" | "stretch", i: number) => {
    const ok = (v: number) => v > (key === "loud" ? -59 : 0);
    const win = feats
      .slice(Math.max(0, i - 12), i + 13)
      .map((f) => f[key])
      .filter(ok);
    if (win.length < 4 || !ok(feats[i]![key])) return 0;
    const m = win.reduce((p, q) => p + q, 0) / win.length;
    const sd = Math.sqrt(win.reduce((p, q) => p + (q - m) ** 2, 0) / win.length) || 1;
    return (feats[i]![key] - m) / sd;
  };
  const raw = feats.map((_, i) => 0.5 * z("loud", i) + 0.35 * z("pitch", i) + 0.2 * z("stretch", i));
  // Ranked within the clip, among the words that carry meaning: 0.9 and up is its top tenth. Small
  // function words are never emphasis, however they're said.
  const content = raw.filter((_, i) => !FUNCTION_WORDS.has(clean(words[i]!.text)));
  const sorted = [...content].sort((p, q) => p - q);
  return raw.map((r, i) => {
    if (FUNCTION_WORDS.has(clean(words[i]!.text)) || !sorted.length)
      return round(Math.min(0.4, rankOf(sorted, r)));
    return round(rankOf(sorted, r));
  });
}

const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
/** Share of `sorted` below `v`. */
const rankOf = (sorted: readonly number[], v: number) => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length ? lo / sorted.length : 0;
};
const FUNCTION_WORDS = new Set(
  "a an the and or but if so of to in on at by for from with as is are was were be been am it its it's this that these those i i'm i'd i've you you're your he she we they them his her our their my me us who what which when where how not do does did have has had will would can could should just then than there here up out about into over also very really like um uh".split(
    " ",
  ),
);
