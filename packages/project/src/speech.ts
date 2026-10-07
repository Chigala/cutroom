/**
 * Speech, as seen through the cut. Transcripts are in source time; the edit is a list of source ranges.
 * Everything here maps between the two, so captions, the Transcript tab and the agent's word-level cuts
 * all agree on which words are in the video and when they are said.
 */

import { nextId } from "./history.ts";
import { rampSpeed, sourceOffset } from "./motion.ts";
import type { Op } from "./ops.ts";
import type { Anchor, Collection, ProjectDoc, Scene, TimedWord, WordEdit } from "./schema.ts";
import { audioPlan, round, sceneAt, sourceTime, type Timeline, timelineOf } from "./time.ts";
import { UNHEARD, voicePlan } from "./voiceover.ts";

export const wordRef = (source: string, index: number) => `${source}:${index}`;

export function parseWordRef(ref: string): { source: string; index: number } | null {
  const at = ref.lastIndexOf(":");
  if (at < 1) return null;
  const index = Number(ref.slice(at + 1));
  return Number.isInteger(index) && index >= 0 ? { source: ref.slice(0, at), index } : null;
}

/**
 * Whisper often stamps the first word after a pause a few tenths of a second early (measured: about a
 * quarter of them, by 0.2-0.6s), so captions would show before the word is said. The voice's energy
 * knows when it really comes back: each word after a gap moves to the voice's onset when that is later.
 * Words only ever move later, within 1.2s, and never past a word that was already right, so timings
 * that are right stay right.
 * `levels`: the voice band's loudness in dB, `perSecond` values a second (voiceEnvelope).
 */
export function alignToOnsets(
  words: readonly TimedWord[],
  levels: ArrayLike<number>,
  perSecond = 100,
): TimedWord[] {
  if (!levels.length || !words.length) return [...words];
  const sorted = Array.from(levels).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const loud = sorted[Math.floor(sorted.length * 0.9)]!;
  if (loud - floor < 10) return [...words];
  const voiced = floor + (loud - floor) * 0.35;
  // Voice is on at frame k when it and the next two are above the threshold (clicks don't count).
  const on = (k: number) =>
    (levels[k] ?? -1) >= voiced && (levels[k + 1] ?? -1) >= voiced && (levels[k + 2] ?? -1) >= voiced;
  const out = words.map((w) => ({ ...w }));
  for (let i = 0; i < out.length; i++) {
    const w = out[i]!;
    const prev = out[i - 1];
    if (prev && w.start - prev.end < 0.08) continue;
    const from = Math.round(w.start * perSecond);
    if (on(from)) continue;
    // Where the voice comes back, within 1.2s.
    let onset = -1;
    for (let k = from + 1; k <= from + Math.round(1.2 * perSecond) && k < levels.length; k++)
      if (on(k)) {
        onset = Math.max(w.start, (k - 2) / perSecond);
        break;
      }
    if (onset < 0) continue;
    // Usually the whole start of the phrase is stamped early, not one word: every word stamped before
    // the voice comes back is laid out from there, in order, before the first word that was right.
    let j = i;
    while (j < out.length && out[j]!.start < onset - 0.02) j++;
    if (j === i) continue;
    const limit = out[j]?.start ?? Infinity;
    const room = Math.max(0.04 * (j - i), Math.min(limit - onset, 0.4 * (j - i)));
    for (let m = i; m < j; m++) {
      const start = round(onset + (room * (m - i)) / (j - i));
      out[m] = { ...out[m]!, start };
    }
    for (let m = i; m < j; m++) {
      const nextStart = m + 1 < j ? out[m + 1]!.start : limit;
      out[m] = {
        ...out[m]!,
        end: round(
          Math.max(out[m]!.start + 0.04, Math.min(nextStart, Math.max(out[m]!.end, out[m]!.start + 0.15))),
        ),
      };
    }
    i = j - 1;
  }
  return out;
}

/**
 * The other edge: Whisper often ends the last word before a pause early, before its final consonant or
 * falling tone has faded, and a cut placed there clips the word while its caption is still up. The
 * voice's energy knows when it really fades: each word followed by a gap (or the last word) extends to
 * where the voice drops back to the room, never into the next word and by at most 0.6s. Ends only ever
 * move later. `levels`: the voice band's loudness in dB, `perSecond` values a second (voiceEnvelope).
 */
export function alignEndsToVoice(
  words: readonly TimedWord[],
  levels: ArrayLike<number>,
  perSecond = 100,
): TimedWord[] {
  if (!levels.length || !words.length) return [...words];
  const sorted = Array.from(levels).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const loud = sorted[Math.floor(sorted.length * 0.9)]!;
  if (loud - floor < 10) return [...words];
  // A lower bar than for onsets: a word's tail is quieter than its start, and it's the tail that matters.
  const voiced = floor + (loud - floor) * 0.2;
  const sounding = (k: number) => (levels[k] ?? -Infinity) >= voiced;
  return words.map((w, i) => {
    const next = words[i + 1];
    const room = next ? next.start - w.end : Infinity;
    if (room < 0.08) return w;
    const limit = Math.min(w.end + 0.6, next ? next.start - 0.03 : Infinity);
    let k = Math.round(w.end * perSecond);
    const last = Math.min(levels.length - 1, Math.floor(limit * perSecond));
    // Still sounding at the stamped end: follow it until it has been quiet for 40ms.
    if (!sounding(k) && !sounding(k - 1)) return w;
    let quiet = 0;
    let end = w.end;
    for (; k <= last; k++) {
      if (sounding(k)) {
        quiet = 0;
        end = (k + 1) / perSecond;
      } else if (++quiet >= 4) break;
    }
    return end > w.end + 0.01 ? { ...w, end: round(Math.min(limit, end + 0.02)) } : w;
  });
}

/**
 * Whisper's word edges are often off at the start of a phrase (a first word "at 0.0" while the speaker
 * is still silent). Measured silences are exact, so pull word edges out of them.
 */
export function alignToSilences(
  words: readonly TimedWord[],
  silences: readonly (readonly [number, number])[],
): TimedWord[] {
  if (!silences.length) return [...words];
  return words.map((w) => {
    let { start, end } = w;
    for (const [a, b] of silences) {
      if (b <= start || a >= end) continue;
      if (start >= a - 0.02 && end > b + 0.05) start = b;
      else if (end <= b + 0.02 && start < a - 0.05) end = Math.min(end, a + 0.05);
    }
    return start === w.start && end === w.end
      ? w
      : { ...w, start: round(start), end: round(Math.max(end, start + 0.04)) };
  });
}

export interface SpokenWord {
  readonly ref: string;
  readonly source: string;
  readonly index: number;
  /** As captioned: the correction if there is one. */
  readonly text: string;
  /** As transcribed. */
  readonly heard: string;
  /** Output time. */
  readonly start: number;
  readonly end: number;
  readonly scene: string;
  readonly emphasis: boolean;
  readonly hidden: boolean;
  /** For a voiceover's word: the voiceover it's heard in (scene is then the shot it plays over). */
  readonly voice?: string;
}

/** Index of the first word whose midpoint is at or after `t`. Words are sorted by start. */
function firstWordAfter(words: readonly TimedWord[], t: number): number {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid]!;
    if ((w.start + w.end) / 2 < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const spokenCache = new WeakMap<object, WeakMap<object, WeakMap<object, WeakMap<object, SpokenWord[]>>>>();
/** The voiceovers of a doc without any, as a cache key. */
const NO_VOICES: readonly never[] = [];

/** Every word that plays in the cut, in output order and output time. Memoized on the inputs. */
export function spokenWords(
  doc: Pick<ProjectDoc, "scenes" | "transcripts" | "wordEdits"> & Partial<Pick<ProjectDoc, "voiceovers">>,
): SpokenWord[] {
  const voices = doc.voiceovers ?? NO_VOICES;
  const a = spokenCache.get(doc.scenes) ?? new WeakMap();
  const b = a.get(doc.transcripts) ?? new WeakMap();
  const c = b.get(doc.wordEdits) ?? new WeakMap();
  const hit = c.get(voices);
  if (hit) return hit;

  const tl = timelineOf(doc);
  const transcripts = new Map(doc.transcripts.map((t) => [t.id, t.words]));
  const edits = new Map<string, WordEdit>(doc.wordEdits.map((e) => [e.id, e]));
  let out: SpokenWord[] = [];
  // Words follow the sound, not the picture: a J-cut's words are heard (and captioned) before its shot.
  for (const span of audioPlan(tl)) {
    const p = span.placed;
    const words = transcripts.get(p.scene.source);
    // A ramped shot's own sound is dropped, so nothing in it is heard (or captioned).
    if (!words?.length || p.scene.ramp?.length) continue;
    const speed = p.scene.speed ?? 1;
    const heardFrom = sourceTime(p, span.from);
    const heardTo = sourceTime(p, span.to);
    for (let i = firstWordAfter(words, heardFrom); i < words.length; i++) {
      const w = words[i]!;
      if ((w.start + w.end) / 2 >= heardTo) break;
      const ref = wordRef(p.scene.source, i);
      const edit = edits.get(ref);
      out.push({
        ref,
        source: p.scene.source,
        index: i,
        text: edit?.text ?? w.text.trim(),
        heard: w.text.trim(),
        start: Math.max(span.from, p.start + (w.start - p.scene.in) / speed),
        end: Math.min(span.to, p.start + (w.end - p.scene.in) / speed),
        scene: p.scene.id,
        emphasis: edit?.emphasis ?? false,
        hidden: edit?.hidden ?? false,
      });
    }
  }
  // Voiceovers: their words where they're heard. Under one, the shots' own speech is background (its
  // sound steps back), so its words aren't captioned there: one voice at a time.
  const plan = voicePlan(doc, tl);
  if (plan.length) {
    const under = (t: number) => plan.some((v) => v.item.duck < UNHEARD && t >= v.start && t < v.end);
    out = out.filter((w) => !under((w.start + w.end) / 2));
    for (const v of plan) {
      const words = transcripts.get(v.item.source);
      if (!words?.length) continue;
      const from = v.item.offset;
      const to = from + (v.end - v.start);
      for (let i = firstWordAfter(words, from); i < words.length; i++) {
        const w = words[i]!;
        if ((w.start + w.end) / 2 >= to) break;
        const ref = wordRef(v.item.source, i);
        const edit = edits.get(ref);
        const start = Math.max(v.start, v.start + w.start - from);
        out.push({
          ref,
          source: v.item.source,
          index: i,
          text: edit?.text ?? w.text.trim(),
          heard: w.text.trim(),
          start,
          end: Math.min(v.end, v.start + w.end - from),
          scene: sceneAt(tl, start)?.scene.id ?? "",
          emphasis: edit?.emphasis ?? false,
          hidden: edit?.hidden ?? false,
          voice: v.item.id,
        });
      }
    }
    out.sort((x, y) => x.start - y.start);
  }
  c.set(voices, out);
  b.set(doc.wordEdits, c);
  a.set(doc.transcripts, b);
  spokenCache.set(doc.scenes, a);
  return out;
}

export interface CaptionPage {
  readonly start: number;
  readonly end: number;
  readonly words: readonly SpokenWord[];
}

/** How speech breaks into caption pages: the paging fields of captionStyle. */
export interface PagingOptions {
  readonly maxWords?: number;
  readonly pauseBreak?: number;
  readonly maxPageSeconds?: number;
  readonly sentenceBreak?: boolean;
  readonly minWords?: number;
}

const endsSentence = (w: SpokenWord) => /[.!?]["')\]]?$/.test(w.text);

/**
 * Groups spoken words into caption pages the way an editor would: a few words at a time, breaking at
 * sentence ends and pauses, so each page reads in one glance. Every rule is a captionStyle setting.
 */
export function captionPages(
  words: readonly SpokenWord[],
  options: number | PagingOptions = {},
): CaptionPage[] {
  const o = typeof options === "number" ? { maxWords: options } : options;
  const maxWords = o.maxWords ?? 4;
  const pauseBreak = o.pauseBreak ?? 0.45;
  const maxSeconds = o.maxPageSeconds ?? 2.4;
  const sentenceBreak = o.sentenceBreak ?? true;
  const minWords = o.minWords ?? 1;
  let pages: CaptionPage[] = [];
  let current: SpokenWord[] = [];
  const flush = () => {
    if (current.length) pages.push({ start: current[0]!.start, end: current.at(-1)!.end, words: current });
    current = [];
  };
  for (const w of words) {
    if (w.hidden || !w.text) continue;
    const prev = current.at(-1);
    if (
      prev &&
      ((pauseBreak > 0 && w.start - prev.end > pauseBreak) ||
        current.length >= maxWords ||
        w.end - current[0]!.start > maxSeconds)
    )
      flush();
    current.push(w);
    if (sentenceBreak && endsSentence(w)) flush();
  }
  flush();
  // Scraps ("on the", "crew.") join the page they belong with: the one before if the sentence runs on
  // from it, else the one after if this page doesn't end the sentence. A little over maxWords is fine.
  if (minWords > 1) {
    const room = maxWords + minWords;
    const merged: CaptionPage[] = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]!;
      const prev = merged.at(-1);
      const next = pages[i + 1];
      if (p.words.length < minWords) {
        if (prev && !endsSentence(prev.words.at(-1)!) && prev.words.length + p.words.length <= room) {
          merged[merged.length - 1] = { start: prev.start, end: p.end, words: [...prev.words, ...p.words] };
          continue;
        }
        if (next && !endsSentence(p.words.at(-1)!) && p.words.length + next.words.length <= room) {
          pages[i + 1] = { start: p.start, end: next.end, words: [...p.words, ...next.words] };
          continue;
        }
      }
      merged.push(p);
    }
    pages = merged;
  }
  // Hold each page until the next one starts when the gap is short, so captions don't flicker.
  return pages.map((p, i) => {
    const next = pages[i + 1];
    const end = next && next.start - p.end < 0.35 ? next.start : p.end + 0.15;
    return { ...p, end: Math.max(end, p.start + 0.3) };
  });
}

export interface CutOptions {
  /** Pauses longer than this are cut out. */
  readonly maxGap?: number;
  readonly padBefore?: number;
  readonly padAfter?: number;
  /**
   * A clip's waveform (PEAKS_PER_SECOND values a second, the timeline's): with it, every cut moves to
   * the quietest moment near where the words say it falls, the breath between words. The transcript's
   * word edges are often off by a tenth or two (a next word stamped early, a last word ended early), and
   * a cut placed on them clips the word.
   */
  readonly levels?: (source: string) => Uint8Array | null | undefined;
  /** The pause to leave where one is cut, by what comes before (mix.pauses); unset uses the pads. */
  readonly pauses?: { readonly sentence: number; readonly phrase: number; readonly word: number };
}

/**
 * The quietest moment in [from, to] of a waveform (smoothed over 60ms), in seconds: where to cut
 * between two words. Null without a waveform or when the window is empty.
 */
export function breathBetween(peaks: Uint8Array, from: number, to: number, perSecond = 50): number | null {
  const a = Math.max(1, Math.ceil(from * perSecond));
  const b = Math.min(peaks.length - 2, Math.floor(to * perSecond));
  if (b < a) return null;
  let best = a;
  let low = Infinity;
  for (let k = a; k <= b; k++) {
    const v = peaks[k - 1]! + 2 * peaks[k]! + peaks[k + 1]!;
    // Ties go to the middle of a quiet stretch's run (the first one found is kept unless clearly lower).
    if (v < low - 0.5) {
      low = v;
      best = k;
    }
  }
  return best / perSecond;
}

export interface Keep {
  readonly source: string;
  /** Word index range, inclusive. */
  readonly from: number;
  readonly to: number;
}

export interface CutRange {
  readonly source: string;
  readonly in: number;
  readonly out: number;
  readonly note: string;
}

/**
 * Better timings for words already transcribed (an older, drifting pass), from a fresh, aligned pass of
 * the same audio: words are matched by their text (the longest common sequence), each matched word
 * takes its fresh times, and the rest are spread between the matched words around them. The words
 * themselves, their indexes, fixes and emphasis, stay as they were: only times change.
 */
export function retimeWords(old: readonly TimedWord[], fresh: readonly TimedWord[]): TimedWord[] {
  const key = (w: TimedWord) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const a = old.map(key);
  const b = fresh.map(key);
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [...old];
  // Longest common subsequence, by rows (two rows of lengths, plus the choices to walk back).
  const back = new Uint8Array((n + 1) * (m + 1));
  let prev = new Uint32Array(m + 1);
  let cur = new Uint32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] && a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        back[i * (m + 1) + j] = 1;
      } else if (prev[j]! >= cur[j - 1]!) {
        cur[j] = prev[j]!;
        back[i * (m + 1) + j] = 2;
      } else {
        cur[j] = cur[j - 1]!;
        back[i * (m + 1) + j] = 3;
      }
    }
    [prev, cur] = [cur, prev];
  }
  const match = new Int32Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const d = back[i * (m + 1) + j];
    if (d === 1) {
      match[i - 1] = j - 1;
      i--;
      j--;
    } else if (d === 2) i--;
    else j--;
  }
  const out = old.map((w, i) =>
    match[i]! >= 0 ? { ...w, start: fresh[match[i]!]!.start, end: fresh[match[i]!]!.end } : { ...w },
  );
  // Unmatched words: spread evenly between the matched neighbours' times.
  for (let i = 0; i < n; ) {
    if (match[i]! >= 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && match[j]! < 0) j++;
    const from = i > 0 ? out[i - 1]!.end : Math.min(old[i]!.start, out[j]?.start ?? old[i]!.start);
    const to = j < n ? out[j]!.start : Math.max(from, old[j - 1]!.end);
    const step = (to - from) / (j - i);
    for (let k = i; k < j; k++)
      out[k] = {
        ...out[k]!,
        start: round(from + step * (k - i)),
        end: round(Math.max(from + step * (k - i + 1), from + step * (k - i) + 0.04)),
      };
    i = j;
  }
  return out;
}

/**
 * Shots of `source` moved with their words when the words' times change (a re-timing): each edge keeps
 * the same words inside it, by where those words now are; things anchored to a shot shift with its in
 * point. Edges then still want putting on the breath (cleanCutOps).
 */
export function moveEdgesWithWords(
  doc: ProjectDoc,
  source: string,
  before: readonly TimedWord[],
  after: readonly TimedWord[],
): Op[] {
  const ops: Op[] = [];
  const shift = new Map<string, number>();
  const mid = (w: TimedWord) => (w.start + w.end) / 2;
  for (const sc of doc.scenes) {
    if (sc.source !== source || sc.ramp?.length) continue;
    const first = before.findIndex((w) => mid(w) > sc.in);
    const last = before.findLastIndex((w) => mid(w) < sc.out);
    if (first < 0 || last < first || !after[first] || !after[last]) continue;
    const newIn = round(Math.max(0, sc.in + (after[first]!.start - before[first]!.start)));
    const newOut = round(sc.out + (after[last]!.end - before[last]!.end));
    if (newOut - newIn < 0.2 || (Math.abs(newIn - sc.in) < 0.01 && Math.abs(newOut - sc.out) < 0.01))
      continue;
    ops.push({ op: "update", coll: "scenes", id: sc.id, patch: { in: newIn, out: newOut } });
    shift.set(sc.id, (sc.in - newIn) / (sc.speed ?? 1));
  }
  const colls = [
    "zooms",
    "titles",
    "visuals",
    "effects",
    "sfx",
    "captions",
    "comments",
    "musicCues",
    "musicClips",
    "voiceovers",
  ] as const;
  for (const coll of colls)
    for (const item of doc[coll] as readonly Pinned[]) {
      const patch = shifted(item, shift);
      if (patch) ops.push({ op: "update", coll, id: item.id, patch } as Op);
    }
  return ops;
}

/** Words a thought doesn't end on: a shot that ends on one sounds cut off, however clean the cut. */
export const DANGLING_WORDS = new Set(
  "and but so or because the a an to of with that which who when if then like as for at in on into from".split(
    " ",
  ),
);

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

export interface CutIssue {
  readonly scene: string;
  readonly edge: "in" | "out";
  /** Output seconds. */
  readonly time: number;
  readonly kind: "no-breath" | "dangling";
  /** What's wrong, and what would be better, in words the agent can act on (with word indexes). */
  readonly detail: string;
}

/**
 * Cuts a careful editor would redo: ones that land in continuous speech with no breath to hide in
 * (a crossfade softens them, but a word boundary with a pause is better), and shots that end on a word
 * a thought doesn't end on ("...an AI agency and |"). Each comes with the nearest better place to cut:
 * a word boundary with a real pause, from the waveform. Edges between back-to-back stretches of the
 * same clip are seamless and never reported.
 */
export function cutReport(
  doc: ProjectDoc,
  levels: (source: string) => Uint8Array | null | undefined,
  perSecond = 50,
): CutIssue[] {
  const tl = timelineOf(doc);
  const issues: CutIssue[] = [];
  const mid = (w: { start: number; end: number }) => (w.start + w.end) / 2;
  tl.scenes.forEach((p, i) => {
    const sc = p.scene;
    const words = doc.transcripts.find((t) => t.id === sc.source)?.words ?? [];
    if (!words.length || sc.ramp?.length) return;
    const peaks = levels(sc.source);
    const next = tl.scenes[i + 1]?.scene;
    const prev = tl.scenes[i - 1]?.scene;
    const seamlessOut = !!next && next.source === sc.source && Math.abs(next.in - sc.out) < 0.06;
    const seamlessIn = !!prev && prev.source === sc.source && Math.abs(prev.out - sc.in) < 0.06;
    // The speaker's level in this shot: the median of its loud half, for "is this a breath or a word".
    const voiced = peaks
      ? Array.from(peaks.subarray(Math.floor(sc.in * perSecond), Math.ceil(sc.out * perSecond)))
          .sort((x, y) => x - y)
          .slice(-Math.max(1, Math.floor((sc.out - sc.in) * perSecond * 0.5)))
      : [];
    const level = voiced.length ? voiced[Math.floor(voiced.length / 2)]! : 0;
    const quietAt = (t: number) => {
      if (!peaks || !level) return true;
      let low = Infinity;
      for (let k = Math.round((t - 0.04) * perSecond); k <= Math.round((t + 0.04) * perSecond); k++)
        low = Math.min(low, peaks[k] ?? 0);
      return low <= level * 0.45;
    };
    // Better places nearby: where a phrase completes (punctuation), or else a real pause, and never on a
    // word a thought doesn't end on. Phrase ends first, then nearness.
    const phraseEnd = (w: { text: string }) => /[.!?,;:]["')\]]?$/.test(w.text);
    const pauses = (from: number, to: number, around: number) =>
      words
        .map((w, k) => ({ w, k, nextW: words[k + 1] }))
        .filter(({ k }) => k >= from && k <= to)
        .filter(
          ({ w, nextW }) =>
            phraseEnd(w) || !nextW || nextW.start - w.end >= 0.1 || quietAt((w.end + nextW.start) / 2),
        )
        .filter(({ w }) => !DANGLING_WORDS.has(bare(w.text)))
        .sort(
          (x, y) =>
            (phraseEnd(x.w) ? 0 : 1) - (phraseEnd(y.w) ? 0 : 1) ||
            Math.abs(x.k - around) - Math.abs(y.k - around),
        );
    if (!seamlessOut && next) {
      const lastIn = words.findLastIndex((w) => mid(w) < sc.out);
      const last = words[lastIn];
      const time = Math.round((p.start + p.duration) * 100) / 100;
      // Later (keeping more of the take) is always fine; earlier only drops words a thought doesn't need.
      const near = pauses(Math.max(0, lastIn - 4), lastIn + 4, lastIn).filter(
        ({ k }) =>
          k >= lastIn || words.slice(k + 1, lastIn + 1).every((w) => DANGLING_WORDS.has(bare(w.text))),
      )[0];
      const better = near
        ? ` Better: end after "${near.w.text}" [${near.k}] (${near.k < lastIn ? `${lastIn - near.k} words earlier` : near.k > lastIn ? `${near.k - lastIn} words later` : "here"}), where he pauses.`
        : "";
      if (last && DANGLING_WORDS.has(bare(last.text)))
        issues.push({
          scene: sc.id,
          edge: "out",
          time,
          kind: "dangling",
          detail: `ends on "${last.text}" [${lastIn}], mid-thought.${better}`,
        });
      // In continuous speech, unless the thought is complete there (the cut's crossfade covers that).
      else if (!quietAt(sc.out) && !(last && phraseEnd(last)))
        issues.push({
          scene: sc.id,
          edge: "out",
          time,
          kind: "no-breath",
          detail: `cuts out in continuous speech after "${last?.text ?? ""}" [${lastIn}], with no breath to hide the cut.${better}`,
        });
    }
    const firstIn = words.findIndex((w) => mid(w) > sc.in);
    const beforeFirst = words[firstIn - 1];
    if (!seamlessIn && prev && !quietAt(sc.in) && !(beforeFirst && phraseEnd(beforeFirst))) {
      // Earlier (keeping more) is always fine; later only skips words a thought doesn't need.
      const near = pauses(Math.max(0, firstIn - 5), firstIn + 3, firstIn - 1)
        .filter(({ k }) => k + 1 < words.length)
        .filter(
          ({ k }) =>
            k + 1 <= firstIn || words.slice(firstIn, k + 1).every((w) => DANGLING_WORDS.has(bare(w.text))),
        )[0];
      issues.push({
        scene: sc.id,
        edge: "in",
        time: Math.round(p.start * 100) / 100,
        kind: "no-breath",
        detail: `cuts in mid-speech before "${words[firstIn]?.text ?? ""}" [${firstIn}].${near ? ` Better: start at "${words[near.k + 1]!.text}" [${near.k + 1}], after a pause.` : ""}`,
      });
    }
  });
  return issues;
}

/**
 * Every shot's edges moved onto the breath: the in point to the quietest moment just before its first
 * word, the out point to the quietest moment just after its last, from the clip's waveform. Things
 * anchored to a shot (zooms, graphics, titles, effects, sound effects, captions, comments) shift with
 * its new in point so they stay on the same words. Ramped shots and shots without a waveform are left
 * alone. Returns the ops, and how many edges moved.
 */
export function cleanCutOps(
  doc: ProjectDoc,
  levels: (source: string) => Uint8Array | null | undefined,
): { ops: Op[]; moved: number; blended: number } {
  const ops: Op[] = [];
  let moved = 0;
  let blended = 0;
  const shift = new Map<string, number>();
  const edges = new Map<string, { in: number; out: number }>();
  const { pauses } = doc.mix;
  const sentence = (w: { text: string } | undefined) => Boolean(w && /[.!?]["')\]]?$/.test(w.text));
  // The scene before each one in the cut (its last word decides how long a pause the join wants).
  const order = timelineOf(doc).scenes.map((p) => p.scene);
  const prevOf = new Map(order.slice(1).map((sc, i) => [sc.id, order[i]!]));
  for (const scene of doc.scenes) {
    const peaks = levels(scene.source);
    if (!peaks?.length || scene.ramp?.length) continue;
    const words = doc.transcripts.find((t) => t.id === scene.source)?.words ?? [];
    const src = doc.sources.find((x) => x.id === scene.source);
    const duration = src?.duration ?? scene.out + 1;
    // The words just inside each edge (by their middles, so moving an edge onto the breath never changes
    // which word it belongs to: running this again changes nothing), and their neighbours outside.
    const mid = (w: { start: number; end: number }) => (w.start + w.end) / 2;
    const firstIn = words.findIndex((w) => mid(w) > scene.in);
    const lastIn = words.findLastIndex((w) => mid(w) < scene.out);
    let newIn = scene.in;
    let newOut = scene.out;
    if (firstIn >= 0) {
      const first = words[firstIn]!;
      const before = words[firstIn - 1];
      // Never back past the middle of the word before: half of it would leak in (and the next pass
      // would count it as inside the shot).
      const lo = Math.max(
        0,
        first.start - 0.4,
        before ? Math.max(mid(before) + 0.05, Math.min(before.end - 0.1, first.start - 0.05)) : 0,
      );
      // From the words alone (not the current edge), so the answer is the same every time.
      const at = breathBetween(peaks, lo, first.start + 0.05);
      if (at !== null) newIn = Math.max(0, at - 0.02);
      // Coming out of a sentence, the next line starts after a beat (its share of the sentence pause).
      const prev = prevOf.get(scene.id);
      const prevWords = prev && doc.transcripts.find((t) => t.id === prev.source)?.words;
      const prevLast = prevWords?.findLast((w) => mid(w) < prev!.out && mid(w) > prev!.in);
      if (at !== null && sentence(prevLast))
        newIn = Math.min(newIn, quietUntil(peaks, at, Math.max(lo, first.start - pauses.sentence * 0.4)));
    }
    if (lastIn >= 0) {
      const last = words[lastIn]!;
      const after = words[lastIn + 1];
      // Never on past the middle of the word after, for the same reason.
      const hi = Math.min(
        duration,
        last.end + 0.45,
        after
          ? Math.min((after.start + after.end) / 2 - 0.05, Math.max(after.start + 0.1, last.end + 0.05))
          : Infinity,
      );
      const at = breathBetween(peaks, last.end - 0.06, hi);
      if (at !== null) newOut = Math.min(duration, at + 0.02);
      // After a sentence, let the pause breathe (its share of mix.pauses.sentence) while the room stays quiet.
      if (at !== null && sentence(last))
        newOut = Math.max(newOut, quietUntil(peaks, at, Math.min(hi, last.end + pauses.sentence * 0.6)));
    }
    newIn = round(newIn);
    newOut = round(newOut);
    edges.set(scene.id, { in: newIn, out: newOut });
    if (newOut - newIn < 0.2 || (Math.abs(newIn - scene.in) < 0.015 && Math.abs(newOut - scene.out) < 0.015))
      continue;
    moved += (Math.abs(newIn - scene.in) >= 0.015 ? 1 : 0) + (Math.abs(newOut - scene.out) >= 0.015 ? 1 : 0);
    ops.push({ op: "update", coll: "scenes", id: scene.id, patch: { in: newIn, out: newOut } });
    shift.set(scene.id, (scene.in - newIn) / (scene.speed ?? 1));
  }
  // A join that still lands in sound on either side (no breath to cut on) blends over mix.speechFade
  // instead of chopping. A crossfade already set on the shot is the editor's call and stays.
  if (doc.mix.speechFade > doc.mix.cutFade)
    for (const scene of order) {
      const prev = prevOf.get(scene.id);
      if (!prev || scene.crossfade !== undefined || scene.ramp?.length || prev.ramp?.length) continue;
      const a = edges.get(prev.id) ?? prev;
      const b = edges.get(scene.id) ?? scene;
      if (prev.source === scene.source && Math.abs(b.in - a.out) < 0.06) continue;
      const pa = levels(prev.source);
      const pb = levels(scene.source);
      if (
        !(pa?.length && sounding(pa, a.out - 0.06, a.out)) &&
        !(pb?.length && sounding(pb, b.in, b.in + 0.06))
      )
        continue;
      blended++;
      const at = ops.findIndex((o) => o.op === "update" && o.id === scene.id);
      const patch = { crossfade: doc.mix.speechFade };
      if (at >= 0) {
        const o = ops[at] as Extract<Op, { op: "update" }>;
        ops[at] = { ...o, patch: { ...o.patch, ...patch } } as Op;
      } else ops.push({ op: "update", coll: "scenes", id: scene.id, patch });
    }
  // Keep anchored things on the same words: an earlier in point means the words come later in the shot.
  const colls = [
    "zooms",
    "titles",
    "visuals",
    "effects",
    "sfx",
    "captions",
    "comments",
    "musicCues",
    "musicClips",
    "voiceovers",
  ] as const;
  for (const coll of colls)
    for (const item of doc[coll] as readonly Pinned[]) {
      const patch = shifted(item, shift);
      if (patch) ops.push({ op: "update", coll, id: item.id, patch } as Op);
    }
  return { ops, moved, blended };
}

/** How far from `from` toward `to` (either direction) the waveform stays as quiet as at `from`. */
function quietUntil(peaks: Uint8Array, from: number, to: number, perSecond = 50): number {
  const k0 = Math.round(from * perSecond);
  const base = peaks[k0] ?? 0;
  // No breath here (the voice runs on): nothing quiet to stretch.
  if (base >= speakingLevel(peaks) * 0.5) return from;
  // A little above the breath's own level: the room's hiss wobbles, a syllable doesn't hide in it.
  const limit = Math.max(base * 1.5, base + 12);
  const step = to >= from ? 1 : -1;
  let k = k0;
  while ((to - (k + step) / perSecond) * step >= 0 && (peaks[k + step] ?? 255) <= limit) k += step;
  return k / perSecond;
}

const speaking = new WeakMap<Uint8Array, number>();
/** A clip's speaking level: the 80th percentile of its waveform (sampled). */
function speakingLevel(peaks: Uint8Array): number {
  let level = speaking.get(peaks);
  if (level === undefined) {
    const sample: number[] = [];
    for (let k = 0; k < peaks.length; k += 7) sample.push(peaks[k]!);
    sample.sort((p, q) => p - q);
    level = sample[Math.floor(sample.length * 0.8)] ?? 0;
    speaking.set(peaks, level);
  }
  return level;
}

/**
 * The voice is sounding through [a, b] (only the waveform's values wholly inside it: a value straddling
 * the cut is partly sound that isn't heard): it sits near the clip's speaking level.
 */
function sounding(peaks: Uint8Array, a: number, b: number, perSecond = 50): boolean {
  let hi = 0;
  for (let k = Math.ceil(a * perSecond - 1e-6); k < Math.floor(b * perSecond + 1e-6); k++)
    hi = Math.max(hi, peaks[k] ?? 0);
  // Within about 12 dB of speaking (a quarter of its amplitude: half on the waveform's square-root scale).
  const level = speakingLevel(peaks);
  return level > 0 && hi >= level * 0.5;
}

/**
 * Source ranges for the words to keep: each keep becomes one or more shots, split wherever the speaker
 * pauses longer than `maxGap` so dead air never makes it in. Padding keeps breaths and consonants intact.
 */
export function rangesFromKeeps(
  doc: Pick<ProjectDoc, "transcripts" | "sources">,
  keeps: readonly Keep[],
  { maxGap = 0.4, padBefore = 0.08, padAfter = 0.14, levels, pauses }: CutOptions = {},
): CutRange[] {
  const transcripts = new Map(doc.transcripts.map((t) => [t.id, t.words]));
  const durations = new Map(doc.sources.map((s) => [s.id, s.duration]));
  const out: CutRange[] = [];
  for (const keep of keeps) {
    const words = transcripts.get(keep.source);
    if (!words?.length) throw new Error(`no transcript for ${keep.source}`);
    const from = Math.max(0, Math.min(keep.from, keep.to));
    const to = Math.min(words.length - 1, Math.max(keep.from, keep.to));
    const duration = durations.get(keep.source) ?? words.at(-1)!.end;
    let run: TimedWord[] = [];
    const runs: TimedWord[][] = [];
    for (let i = from; i <= to; i++) {
      const w = words[i]!;
      const prev = run.at(-1);
      if (prev && w.start - prev.end > maxGap) {
        runs.push(run);
        run = [];
      }
      run.push(w);
    }
    if (run.length) runs.push(run);
    // The pause a cut leaves, by what comes before it (mix.pauses): about 60% after the last word, 40%
    // before the next, so the joined speech breathes like the speaker did.
    const pauseAfter = (w: TimedWord | undefined) =>
      !pauses || !w
        ? null
        : /[.!?]["')\]]?$/.test(w.text)
          ? pauses.sentence
          : /[,;:]["')\]]?$/.test(w.text)
            ? pauses.phrase
            : pauses.word;
    runs.forEach((r, n) => {
      const before = n === 0 ? words[from - 1] : runs[n - 1]!.at(-1);
      const after = n === runs.length - 1 ? words[to + 1] : runs[n + 1]![0];
      const tail = pauseAfter(r.at(-1)) ?? padAfter / 0.6;
      const lead = pauseAfter(before) ?? padBefore / 0.4;
      const padOut = pauses ? tail * 0.6 : padAfter;
      const padIn = pauses ? lead * 0.4 : padBefore;
      // Pad, but never into a neighbouring word: that is how half-syllables leak into a cut.
      let start = Math.max(0, r[0]!.start - padIn, before ? Math.min(before.end, r[0]!.start) : 0);
      let end = Math.min(
        duration,
        r.at(-1)!.end + padOut,
        after ? Math.max(after.start, r.at(-1)!.end) : Infinity,
      );
      // On the breath: the quietest moment around each edge, from the waveform. Out: from just before
      // the last word's stamped end to well past it (the next word's stamped start is often early);
      // in: from well before the first word to just after its stamped start.
      const peaks = levels?.(keep.source);
      if (peaks?.length) {
        const last = r.at(-1)!;
        const outAt = breathBetween(
          peaks,
          last.end - 0.06,
          // Into the next word's stamped start by at most 0.1s: past that is its sound, not a breath.
          Math.min(
            duration,
            // Within the pause the cut should leave (plus a little), so the rhythm stays natural.
            last.end + (pauses ? Math.max(0.12, padOut + 0.08) : 0.45),
            after
              ? Math.min((after.start + after.end) / 2 - 0.05, Math.max(after.start + 0.1, last.end + 0.05))
              : Infinity,
          ),
        );
        if (outAt !== null) end = Math.min(duration, outAt + 0.02);
        const first = r[0]!;
        const inAt = breathBetween(
          peaks,
          Math.max(
            0,
            first.start - (pauses ? Math.max(0.12, padIn + 0.08) : 0.4),
            before
              ? Math.max(
                  (before.start + before.end) / 2 + 0.05,
                  Math.min(before.end - 0.1, first.start - 0.05),
                )
              : 0,
          ),
          first.start + 0.05,
        );
        if (inAt !== null) start = Math.max(0, inAt - 0.02);
      }
      // Speech shots carry no note: the story card shows what is said, live, with fixes applied.
      if (end - start > 0.05) out.push({ source: keep.source, in: round(start), out: round(end), note: "" });
    });
  }
  return out;
}

/** Ops that replace the whole timeline with shots built from ranges. Clears items pinned to old shots. */
export function replaceTimelineOps(doc: ProjectDoc, ranges: readonly CutRange[]): Op[] {
  const ops: Op[] = [];
  const anchored = [
    "zooms",
    "captions",
    "titles",
    "visuals",
    "effects",
    "sfx",
    "musicCues",
    "musicClips",
    "voiceovers",
    "comments",
  ] as const;
  for (const coll of anchored)
    for (const item of doc[coll]) if (coll !== "comments") ops.push({ op: "remove", coll, id: item.id });
  for (const s of doc.scenes) ops.push({ op: "remove", coll: "scenes", id: s.id });
  // The music taken out of a clip's sound is about the clip, not a shot: the new shots keep it (when
  // the old ones agreed on it).
  const ownMusic = new Map<string, number | undefined>();
  for (const s of doc.scenes)
    ownMusic.set(
      s.source,
      ownMusic.has(s.source) && ownMusic.get(s.source) !== s.ownMusic ? undefined : s.ownMusic,
    );
  const taken: { id: string }[] = [];
  for (const r of ranges) {
    const id = nextId("sc", taken);
    taken.push({ id });
    const kept = ownMusic.get(r.source);
    ops.push({
      op: "insert",
      coll: "scenes",
      item: {
        id,
        source: r.source,
        in: r.in,
        out: r.out,
        note: r.note,
        volume: 1,
        ...(kept !== undefined && { ownMusic: kept }),
      },
    });
  }
  // Comments survive a recut: pin them to the first shot, they still make sense as notes.
  const first = taken[0]?.id;
  for (const c of doc.comments)
    if (first)
      ops.push({ op: "update", coll: "comments", id: c.id, patch: { anchor: { scene: first, at: 0 } } });
  return ops;
}

const ANCHORED: readonly Collection[] = [
  "zooms",
  "captions",
  "titles",
  "visuals",
  "effects",
  "sfx",
  "musicCues",
  "musicClips",
  "voiceovers",
  "comments",
];

/** Something pinned to a shot: by its anchor, and (an overlay that lasts a stretch) its end. */
type Pinned = { id: string; anchor: Anchor; until?: Anchor | "end" | undefined };

/** The patch that keeps an item's moments where they were on shots whose footage shifted, or null. */
function shifted(item: Pinned, shift: ReadonlyMap<string, number>): Record<string, unknown> | null {
  const move = (a: Anchor) => {
    const d = shift.get(a.scene);
    return d ? { scene: a.scene, at: round(Math.max(0, a.at + d)) } : null;
  };
  const anchor = move(item.anchor);
  const until = item.until && item.until !== "end" ? move(item.until) : null;
  return anchor || until ? { ...(anchor && { anchor }), ...(until && { until }) } : null;
}

/** Overlays whose stretch ends in a shot (their until), wherever they start. */
function endingIn(doc: ProjectDoc, sceneId: string) {
  return (["titles", "visuals"] as const).flatMap((coll) =>
    (doc[coll] as readonly Pinned[])
      .filter((item) => item.until && item.until !== "end" && item.until.scene === sceneId)
      .map((item) => ({ coll, item, until: item.until as Anchor })),
  );
}

function anchoredIn(doc: ProjectDoc, sceneId: string) {
  return ANCHORED.flatMap((coll) =>
    (doc[coll] as readonly { id: string; anchor: { scene: string; at: number } }[])
      .filter((item) => item.anchor.scene === sceneId)
      .map((item) => ({ coll, item })),
  );
}

/** Splits a shot at `offset` seconds into it. Items after the split move to the new second half. */
export function splitSceneOps(doc: ProjectDoc, sceneId: string, offset: number): Op[] {
  const tl = timelineOf(doc);
  const placed = tl.byId.get(sceneId);
  if (!placed || offset <= 0.05 || offset >= placed.duration - 0.05) return [];
  const { scene } = placed;
  const id = nextId("sc", doc.scenes);
  // offset is output time; at a speed other than 1 (or through a ramp), that's more or less footage.
  const rel = sourceOffset(scene, offset);
  const cut = round(scene.in + rel);
  const ramps = scene.ramp?.length ? splitRamp(scene.ramp, rel) : null;
  const ops: Op[] = [
    { op: "update", coll: "scenes", id: scene.id, patch: { out: cut, ...(ramps && { ramp: ramps[0] }) } },
    {
      op: "insert",
      coll: "scenes",
      index: placed.index + 1,
      item: { ...scene, id, in: cut, ...(ramps && { ramp: ramps[1] }) },
    },
  ];
  for (const { coll, item } of anchoredIn(doc, sceneId))
    if (item.anchor.at >= offset)
      ops.push({
        op: "update",
        coll,
        id: item.id,
        patch: { anchor: { scene: id, at: round(item.anchor.at - offset) } },
      });
  // A stretch that ends after the split ends in the second half.
  for (const { coll, item, until } of endingIn(doc, sceneId))
    if (until.at >= offset)
      ops.push({
        op: "update",
        coll,
        id: item.id,
        patch: { until: { scene: id, at: round(until.at - offset) } },
      });
  return ops;
}

/**
 * New in/out for a shot. Moving the start shifts everything pinned to it, so a zoom stays on the same
 * moment of footage instead of sliding along with the edit.
 */
export function trimSceneOps(doc: ProjectDoc, sceneId: string, nextIn: number, nextOut: number): Op[] {
  const scene = doc.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const src = doc.sources.find((s) => s.id === scene.source);
  const max = src && (src.kind === "video" || src.kind === "audio") ? src.duration : Infinity;
  const a = round(Math.max(0, Math.min(nextIn, nextOut - 0.1)));
  const b = round(Math.min(max, Math.max(nextOut, a + 0.1)));
  if (a === scene.in && b === scene.out) return [];
  const ops: Op[] = [{ op: "update", coll: "scenes", id: sceneId, patch: { in: a, out: b } }];
  const shift = a - scene.in;
  if (shift !== 0)
    for (const { coll, item } of anchoredIn(doc, sceneId))
      ops.push({
        op: "update",
        coll,
        id: item.id,
        patch: { anchor: { scene: sceneId, at: round(Math.max(0, item.anchor.at - shift)) } },
      });
  if (shift !== 0)
    for (const { coll, item, until } of endingIn(doc, sceneId))
      ops.push({
        op: "update",
        coll,
        id: item.id,
        patch: { until: { scene: sceneId, at: round(Math.max(0, until.at - shift)) } },
      });
  return ops;
}

/**
 * Cuts words out of the video (the Transcript tab's delete). Each affected shot is shortened or split
 * so the removed words never play; shots left with nothing are removed.
 */
export function cutWordsOps(doc: ProjectDoc, refs: ReadonlySet<string>): Op[] {
  const words = spokenWords(doc);
  const tl = timelineOf(doc);
  const byScene = new Map<string, SpokenWord[]>();
  // A voiceover's words aren't the shots' (it's trimmed on its own, by its offset and duration).
  for (const w of words) if (!w.voice) byScene.set(w.scene, [...(byScene.get(w.scene) ?? []), w]);
  const transcripts = new Map(doc.transcripts.map((t) => [t.id, t.words]));
  const ops: Op[] = [];
  const taken: { id: string }[] = [...doc.scenes];
  let inserted = 0;

  for (const placed of tl.scenes) {
    const scene = placed.scene;
    const inScene = byScene.get(scene.id) ?? [];
    if (!inScene.some((w) => refs.has(w.ref))) continue;
    const src = transcripts.get(scene.source)!;
    const spans: { in: number; out: number }[] = [];
    let spanStart: number | null = scene.in;
    let lastKept: TimedWord | null = null;
    for (const w of inScene) {
      const tw = src[w.index]!;
      if (refs.has(w.ref)) {
        if (spanStart !== null && lastKept)
          spans.push({ in: spanStart, out: Math.min(tw.start, lastKept.end + 0.1) });
        spanStart = null;
        lastKept = null;
        continue;
      }
      if (spanStart === null) {
        const prev = src[w.index - 1];
        spanStart = Math.max(prev ? prev.end : 0, tw.start - 0.06);
      }
      lastKept = tw;
    }
    if (spanStart !== null && lastKept) spans.push({ in: spanStart, out: scene.out });
    const valid = spans
      .filter((s) => s.out - s.in > 0.08)
      .map((s) => ({ in: round(s.in), out: round(s.out) }));
    if (!valid.length) {
      ops.push({ op: "remove", coll: "scenes", id: scene.id });
      inserted--;
      continue;
    }
    const ids = [scene.id];
    ops.push({ op: "update", coll: "scenes", id: scene.id, patch: { in: valid[0]!.in, out: valid[0]!.out } });
    valid.slice(1).forEach((span, k) => {
      const id = nextId("sc", taken);
      taken.push({ id });
      ids.push(id);
      ops.push({
        op: "insert",
        coll: "scenes",
        index: placed.index + inserted + k + 1,
        item: { ...scene, id, in: span.in, out: span.out } satisfies Scene,
      });
    });
    // Everything pinned to this shot follows its moment of footage into whichever piece now holds it
    // (or the start of the next piece, if that moment was cut).
    for (const { coll, item } of anchoredIn(doc, scene.id)) {
      const speed = scene.speed ?? 1;
      const t = scene.in + item.anchor.at * speed;
      let j = valid.findIndex((span) => t < span.out);
      if (j < 0) j = valid.length - 1;
      const span = valid[j]!;
      const at = round(Math.min(Math.max(0, t - span.in), span.out - span.in) / speed);
      if (ids[j] !== scene.id || at !== item.anchor.at)
        ops.push({ op: "update", coll, id: item.id, patch: { anchor: { scene: ids[j]!, at } } });
    }
    inserted += valid.length - 1;
  }
  return ops;
}

/** Output-time span covered by a set of spoken words, for seeking and selection. */
export function spanOfWords(words: readonly SpokenWord[]): { start: number; end: number } | null {
  if (!words.length) return null;
  return { start: Math.min(...words.map((w) => w.start)), end: Math.max(...words.map((w) => w.end)) };
}

export type { Timeline };

/** A speed ramp split at footage second `at`: each piece keeps the speeds it had, meeting at the cut. */
function splitRamp(
  ramp: readonly { at: number; speed: number }[],
  at: number,
): [{ at: number; speed: number }[], { at: number; speed: number }[]] {
  const speed = round(rampSpeed(ramp, at));
  const a = [...ramp.filter((p) => p.at < at), { at: round(at), speed }];
  const b = [{ at: 0, speed }, ...ramp.filter((p) => p.at > at).map((p) => ({ ...p, at: round(p.at - at) }))];
  // A ramp needs two points; a piece with one speed throughout holds it.
  const pad = (r: { at: number; speed: number }[]) =>
    r.length >= 2 ? r : [r[0]!, { ...r[0]!, at: r[0]!.at + 0.01 }];
  return [pad(a), pad(b)];
}

/**
 * Puts `words` in place of a clip's words said between `from` and `to` (seconds in the clip; a word is in
 * the stretch when its middle is): a second transcription of a stretch the first one missed. Fixes and
 * emphasis on the words outside it stay on them (the words after move to their new indices); those on
 * the words replaced go. Returns the ops and where the new words sit.
 */
export function replaceWordsOps(
  doc: Pick<ProjectDoc, "transcripts" | "wordEdits" | "sources">,
  source: string,
  from: number,
  to: number,
  words: readonly TimedWord[],
): { ops: Op[]; first: number; replaced: number } {
  const t = doc.transcripts.find((x) => x.id === source);
  const old = t?.words ?? [];
  const mid = (w: TimedWord) => (w.start + w.end) / 2;
  let first = 0;
  while (first < old.length && mid(old[first]!) < from) first++;
  let end = first;
  while (end < old.length && mid(old[end]!) <= to) end++;
  const replaced = end - first;
  const next = [...old.slice(0, first), ...[...words].sort((a, b) => a.start - b.start), ...old.slice(end)];
  const ops: Op[] = t
    ? [{ op: "update", coll: "transcripts", id: source, patch: { words: next } }]
    : [{ op: "insert", coll: "transcripts", item: { id: source, language: "en", words: next } }];
  // Fixes and emphasis are addressed by index: the replaced words' go, the later words' move.
  const shift = words.length - replaced;
  const moved: WordEdit[] = [];
  for (const e of doc.wordEdits) {
    const ref = parseWordRef(e.id);
    if (!ref || ref.source !== source || ref.index < first) continue;
    ops.push({ op: "remove", coll: "wordEdits", id: e.id });
    if (ref.index >= first + replaced) moved.push({ ...e, id: wordRef(source, ref.index + shift) });
  }
  for (const e of moved) ops.push({ op: "insert", coll: "wordEdits", item: e });
  const src = doc.sources.find((s) => s.id === source);
  if (src && !src.speech && next.length)
    ops.push({ op: "update", coll: "sources", id: source, patch: { speech: true } });
  return { ops, first, replaced };
}
