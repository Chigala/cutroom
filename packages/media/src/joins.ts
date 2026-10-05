/**
 * How every cut in the dialogue sounds, measured from the audio either side of it the way a dialogue
 * editor listens: does the level jump, does the voice's melody jump (a falling sentence end into a
 * line that starts high, or two halves of one thought at different pitches), does the room's
 * background step, is the pause right for what's being said, and does the cut land mid-sound.
 */
import { readFile } from "node:fs/promises";
import { type ProjectDoc, timelineOf } from "@vedit/project";

export interface JoinReport {
  /** The shot after the cut. */
  readonly scene: string;
  /** Output seconds. */
  readonly time: number;
  /** dB, after minus before (about a second of speech either side of the cut). */
  readonly loudness: number | null;
  /** Semitones, after minus before. */
  readonly melody: number | null;
  /**
   * What this speaker's level and pitch naturally do across their own pauses (median over the clip):
   * a phrase ends lower and quieter than the next begins, so a cut is judged against that, not zero.
   */
  readonly natural: { readonly loudness: number; readonly melody: number } | null;
  /** dB, the room's background after minus before. */
  readonly room: number | null;
  /** Seconds of silence the cut leaves between the words. */
  readonly pause: number;
  readonly sentenceEnd: boolean;
  /** The cut lands while the voice is sounding on either side. */
  readonly inSpeech: boolean;
  /** What a dialogue editor would fix here, in plain words; empty when the join is clean. */
  readonly problems: readonly string[];
}

const RATE = 16000;

/** A 16 kHz mono WAV's samples, as -1..1. */
async function samples(file: string): Promise<Float32Array> {
  const buf = await readFile(file);
  const data = buf.indexOf("data", 12, "ascii");
  const at = data < 0 ? 44 : data + 8;
  const n = Math.floor((buf.length - at) / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(at + i * 2) / 32768;
  return x;
}

const rmsDb = (x: Float32Array, a: number, b: number) => {
  const i0 = Math.max(0, Math.floor(a * RATE));
  const i1 = Math.min(x.length, Math.ceil(b * RATE));
  if (i1 - i0 < 32) return -90;
  let s = 0;
  for (let i = i0; i < i1; i++) s += x[i]! * x[i]!;
  return 10 * Math.log10(s / (i1 - i0) + 1e-12);
};

/** Loudness of a stretch at its peak (90th percentile of 20 ms frames), dB. */
const peakDb = (x: Float32Array, a: number, b: number) => {
  const frames: number[] = [];
  for (let t = a; t + 0.02 <= b; t += 0.01) frames.push(rmsDb(x, t, t + 0.02));
  if (!frames.length) return null;
  frames.sort((p, q) => p - q);
  return frames[Math.floor(frames.length * 0.9)]!;
};

/** The room's background near a stretch: its quietest 20 ms frames (10th percentile), dB. */
const floorDb = (x: Float32Array, a: number, b: number) => {
  const frames: number[] = [];
  for (let t = Math.max(0, a); t + 0.02 <= b; t += 0.02) frames.push(rmsDb(x, t, t + 0.02));
  if (frames.length < 10) return null;
  frames.sort((p, q) => p - q);
  return frames[Math.floor(frames.length * 0.1)]!;
};

/** The voice's pitch over a stretch (median of voiced 40 ms frames, autocorrelation, 70-400 Hz), Hz. */
function pitch(x: Float32Array, a: number, b: number): number | null {
  const out: number[] = [];
  // Worked at 8 kHz (pairs averaged): plenty for a speaking voice.
  for (let t = a; t + 0.04 <= b; t += 0.02) {
    const i0 = Math.floor(t * RATE);
    const n = 320;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = ((x[i0 + 2 * i] ?? 0) + (x[i0 + 2 * i + 1] ?? 0)) / 2;
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += f[i]! * f[i]!;
    if (e0 < 1e-5) continue;
    let best = 0;
    let lag = 0;
    for (let l = 20; l <= 114; l++) {
      let s = 0;
      for (let i = 0; i + l < n; i++) s += f[i]! * f[i + l]!;
      if (s > best) {
        best = s;
        lag = l;
      }
    }
    if (lag && best / e0 > 0.35) out.push(8000 / lag);
  }
  if (out.length < 2) return null;
  out.sort((p, q) => p - q);
  return out[Math.floor(out.length / 2)]!;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)]!;
};

type Word = { readonly text: string; readonly start: number; readonly end: number };

/** Level and pitch across a join: about a second of speech before `endA` against a second after `startB`. */
function across(
  xa: Float32Array,
  fromA: number,
  endA: number,
  xb: Float32Array,
  startB: number,
  toB: number,
) {
  const la = peakDb(xa, fromA, endA);
  const lb = peakDb(xb, startB, toB);
  const pa = pitch(xa, fromA, endA);
  const pb = pitch(xb, startB, toB);
  return {
    loudness: la !== null && lb !== null ? round(lb - la) : null,
    melody: pa && pb ? round(12 * Math.log2(pb / pa)) : null,
    la,
    lb,
  };
}

/**
 * How a speaker's level and pitch move across their own pauses in a clip (up to 40 of them, spread
 * through it), by whether the pause ends a sentence. Null without enough pauses to say.
 */
function naturalJoins(x: Float32Array, words: readonly Word[]) {
  const at = (sentence: boolean) => {
    const gaps: number[] = [];
    for (let i = 1; i < words.length; i++) {
      const gap = words[i]!.start - words[i - 1]!.end;
      if (gap >= 0.15 && gap <= 1.5 && /[.!?]["')\]]?$/.test(words[i - 1]!.text) === sentence) gaps.push(i);
    }
    const step = Math.max(1, Math.floor(gaps.length / 40));
    const loud: number[] = [];
    const mel: number[] = [];
    for (let g = 0; g < gaps.length; g += step) {
      const a = words[gaps[g]! - 1]!;
      const b = words[gaps[g]!]!;
      const j = across(x, a.end - 1, a.end, x, b.start, b.start + 1);
      if (j.loudness !== null) loud.push(j.loudness);
      if (j.melody !== null) mel.push(j.melody);
    }
    return loud.length >= 6 && mel.length >= 6 ? { loudness: median(loud), melody: median(mel) } : null;
  };
  const sentence = at(true);
  const other = at(false);
  return { sentence: sentence ?? other, other: other ?? sentence };
}

/**
 * Every cut between two stretches of dialogue (back-to-back stretches of one clip are seamless and
 * skipped). `wav(source)`: that clip's 16 kHz mono speech audio.
 */
export async function measureJoins(
  doc: ProjectDoc,
  wav: (source: string) => Promise<string | null>,
): Promise<JoinReport[]> {
  const tl = timelineOf(doc);
  // What counts as rough: the project's own thresholds (checks.json joins).
  const J = doc.checkRules.joins;
  const cache = new Map<string, Float32Array | null>();
  const audio = async (id: string) => {
    if (!cache.has(id)) {
      const file = await wav(id);
      cache.set(id, file ? await samples(file) : null);
    }
    return cache.get(id)!;
  };
  const mid = (w: { start: number; end: number }) => (w.start + w.end) / 2;
  const naturals = new Map<string, ReturnType<typeof naturalJoins>>();
  const out: JoinReport[] = [];
  for (let i = 1; i < tl.scenes.length; i++) {
    const A = tl.scenes[i - 1]!.scene;
    const B = tl.scenes[i]!.scene;
    if (A.source === B.source && Math.abs(B.in - A.out) < 0.06) continue;
    if (A.ramp?.length || B.ramp?.length) continue;
    const wa = doc.transcripts.find((t) => t.id === A.source)?.words ?? [];
    const wb = doc.transcripts.find((t) => t.id === B.source)?.words ?? [];
    const li = wa.findLastIndex((w) => mid(w) < A.out && mid(w) > A.in);
    const fi = wb.findIndex((w) => mid(w) > B.in && mid(w) < B.out);
    const last = wa[li];
    const first = wb[fi];
    if (!last || !first) continue;
    const xa = await audio(A.source);
    const xb = await audio(B.source);
    if (!xa || !xb) continue;
    // The pause the speaker took after that last word: running sentences together is their rhythm,
    // not a rushed cut.
    const spokenPause = wa[li + 1] ? wa[li + 1]!.start - last.end : Infinity;
    const sentenceEnd = /[.!?]["')\]]?$/.test(last.text);
    // A thought may end without punctuation: where the transcript runs on unpunctuated (some speakers
    // come out that way) or the speaker paused there, a cut isn't known to be mid-thought.
    const unpunctuated = !wa.slice(Math.max(0, li - 20), li).some((w) => /[.!?,;:]["')\]]?$/.test(w.text));
    const phraseEnd =
      sentenceEnd ||
      /[,;:]["')\]]?$/.test(last.text) ||
      unpunctuated ||
      (Number.isFinite(spokenPause) && spokenPause >= doc.mix.pauses.phrase);
    // About a second of speech either side of the cut, as the ear judges a join (a single word's level
    // and pitch swing too much with its stress to compare).
    const tailFrom = Math.max(A.in, last.end - 1.0);
    const headTo = Math.min(B.out, first.start + 1.0);
    const {
      loudness: raw,
      melody,
      la,
      lb,
    } = across(xa, tailFrom, Math.min(last.end, A.out), xb, Math.max(first.start, B.in), headTo);
    // As heard: each shot's volume applies.
    const loudness =
      raw === null || A.volume <= 0 || B.volume <= 0
        ? null
        : round(raw + 20 * Math.log10(B.volume / A.volume));
    if (!naturals.has(A.source)) naturals.set(A.source, naturalJoins(xa, wa));
    const natural = (sentenceEnd ? naturals.get(A.source)?.sentence : naturals.get(A.source)?.other) ?? null;
    // Beyond what the speaker does across their own pauses.
    const loudBy = loudness === null ? null : round(loudness - (natural?.loudness ?? 0));
    const melodyBy = melody === null ? null : round(melody - (natural?.melody ?? 0));
    // The room either side, only between different recordings (one recording is one room; the room
    // tone bed covers any drift): its quietest moments over several seconds.
    const fa = A.source !== B.source ? floorDb(xa, A.out - 6, A.out) : null;
    const fb = A.source !== B.source ? floorDb(xb, B.in, B.in + 6) : null;
    const room = fa !== null && fb !== null ? round(fb - fa) : null;
    const pause = round(Math.max(0, A.out - last.end) + Math.max(0, first.start - B.in), 2);
    // Sounding at the cut: within 12 dB of the words' level on either side, right at the edge.
    const edgeA = rmsDb(xa, A.out - 0.03, A.out);
    const edgeB = rmsDb(xb, B.in, B.in + 0.03);
    const inSpeech = (la !== null && edgeA > la - 9) || (lb !== null && edgeB > lb - 9);
    const problems: string[] = [];
    // A cut in sound that already blends (a crossfade of mix.speechFade or more) is handled.
    if (inSpeech && (B.crossfade ?? doc.mix.cutFade) < Math.max(0.08, doc.mix.speechFade))
      problems.push(
        "the cut lands while the voice is sounding (lengthen the crossfade, or move it to a pause)",
      );
    const usual = natural
      ? ` (across their own pauses it's ${natural.loudness > 0 ? "+" : ""}${natural.loudness} dB, ${natural.melody > 0 ? "+" : ""}${natural.melody} semitones)`
      : "";
    if (loudBy !== null && Math.abs(loudBy) > J.loudness)
      problems.push(
        `the level jumps ${loudness! > 0 ? "up" : "down"} ${Math.abs(loudness!)} dB${usual}: even it with the shot's volume`,
      );
    // Mid-thought, the melody should carry on as the speaker's does; after a sentence a bigger reset
    // upward is natural, a drop isn't.
    if (melodyBy !== null && (phraseEnd ? melodyBy < -(J.melody + 1) : Math.abs(melodyBy) > J.melody))
      problems.push(
        `the voice's pitch jumps ${melody! > 0 ? "up" : "down"} ${Math.abs(melody!)} semitones${phraseEnd ? "" : " mid-thought"}${usual} (it sounds stitched: join takes said in the same breath, or end on the complete sentence)`,
      );
    if (room !== null && Math.abs(room) > J.room)
      problems.push(
        `the room's background steps ${room > 0 ? "up" : "down"} ${Math.abs(room)} dB (room tone covers this at export)`,
      );
    if (sentenceEnd && pause + 0.05 < Math.min(J.rushed, spokenPause))
      problems.push(`only ${pause}s of pause after a sentence: it sounds rushed`);
    if (!phraseEnd && pause > J.drag) problems.push(`${pause}s of silence mid-thought: it drags`);
    out.push({
      scene: B.id,
      time: round(tl.scenes[i]!.start, 2),
      loudness,
      melody,
      natural,
      room,
      pause,
      sentenceEnd,
      inSpeech,
      problems,
    });
  }
  return out;
}

/**
 * A stretch of the room's own quiet (no speech) to lay under the voice: the longest silence in the
 * clip, at least `min` seconds once trimmed off its edges. Null when there's none.
 */
export function roomToneStretch(
  silences: readonly (readonly [number, number])[],
  min = 0.8,
): { start: number; duration: number } | null {
  const best = [...silences]
    .map(([a, b]) => [a + 0.1, b - 0.1] as const)
    .sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
  if (!best || best[1] - best[0] < min) return null;
  return { start: round(best[0], 3), duration: round(Math.min(4, best[1] - best[0]), 3) };
}
