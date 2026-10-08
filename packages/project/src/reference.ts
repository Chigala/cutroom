/**
 * A reference video measured the way an editor would study it before copying its style: how often it
 * cuts and whether that changes over the video, how fast the speaker talks and how the first seconds
 * hook, what kinds of shots it uses and how they move, where the energy is, whether music drives it and
 * the cuts land on the beat, and how its captions are set and timed. Pure: everything comes from what
 * indexing already wrote (the picture's shot changes, the transcript, the shot log, the sounds heard, the
 * words on screen), or from words on screen read again more densely (`text`). What numbers can't show
 * (how things move, the graphics, the colour) the agent watches play over the stretches in `watch`.
 */
import type { Analysis, ProjectDoc } from "./schema.ts";

/** Words seen on screen over a stretch: where, as shares of the frame from its top left. */
export type SeenText = NonNullable<Analysis["text"]>[number];

/**
 * A track of burned-in captions: text on screen that is the words being said, in one place at one size.
 * A video can have more than one (small subtitles at the bottom, big kinetic words over the speaker).
 */
export interface CaptionReport {
  /** Caption pages (lines that come up together). */
  readonly pages: number;
  /** Share of the talking time with one of this track's pages up. */
  readonly coverage: number;
  readonly wordsPerPage: { readonly median: number; readonly max: number };
  readonly linesPerPage: number;
  /** How long a page stays up (s). */
  readonly secondsPerPage: number;
  readonly case: "upper" | "lower" | "mixed";
  /** The middle of the caption block, as a share of the frame's height from the top. */
  readonly y: number;
  /** Where its pages sit, most of them (the 10th to the 90th percentile): apart when they move around. */
  readonly yRange: readonly [number, number];
  /** A line's height, as a share of the frame's height. */
  readonly height: number;
  /** When a page comes up against its first word being said (s): negative is ahead of the voice. */
  readonly lead: number | null;
  /** When each page comes up (s). */
  readonly starts: readonly number[];
}

/** Whether `pattern` is in `text` give or take `errors` letters (a misread "v" for "w"): Sellers' search. */
export function nearlyContains(text: string, pattern: string, errors: number): boolean {
  if (!pattern) return true;
  if (text.includes(pattern)) return true;
  let prev = Array.from({ length: pattern.length + 1 }, (_, i) => i);
  for (const ch of text) {
    const next = [0];
    for (let j = 1; j <= pattern.length; j++)
      next[j] = Math.min(prev[j]! + 1, next[j - 1]! + 1, prev[j - 1]! + (pattern[j - 1] === ch ? 0 : 1));
    if (next[pattern.length]! <= errors) return true;
    prev = next;
  }
  return false;
}

/** Text on screen that isn't what's said: titles, labels, a hook line. */
export interface ScreenText {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly where: "top" | "middle" | "bottom";
}

/**
 * What studying the video found (@vedit/media's studyMotion and studyRhythm): how the frame moves in each
 * shot, what each cut is, and the sound's beats and hits. Plain data, so it can come from anywhere.
 */
export interface ReferenceStudy {
  readonly motion: null | {
    readonly shots: readonly {
      readonly from: number;
      readonly to: number;
      readonly punches: readonly { readonly at: number; readonly size: number }[];
      readonly drift: number;
      readonly pan: { readonly x: number; readonly y: number };
      readonly shake: number;
    }[];
    readonly transitions: readonly { readonly at: number; readonly kind: string }[];
    readonly jumps: readonly { readonly at: number; readonly size: number }[];
  };
  readonly rhythm: null | {
    readonly bpm: number | null;
    readonly pulse: number;
    readonly beats: readonly number[];
    readonly hits: readonly { readonly at: number; readonly strength: number }[];
    readonly voiceless: boolean;
    /** Every 50 ms. */
    readonly loudness: readonly number[];
    readonly effects: readonly { readonly at: number; readonly kind: string; readonly confidence: number }[];
  };
}

/** How the frame moves, and the cuts. */
export interface MotionReport {
  readonly punches: number;
  readonly per10s: number;
  /** A typical punch, as a share of the frame (0.08 is 8%). */
  readonly size: number;
  readonly punchesIn: number;
  /** Share of shots with at least one punch. */
  readonly shotsPunched: number;
  /** Slow pushes in or out over a shot (5% or more). */
  readonly pushes: number;
  readonly pushSize: number;
  readonly pans: number;
  /** Shares of the shots locked off (barely moving) and handheld. */
  readonly locked: number;
  readonly handheld: number;
  readonly transitions: Readonly<Record<string, number>>;
  /** Cuts within a take that change the framing: how many, a typical one, how many tighter. */
  readonly jumps: number;
  readonly jumpSize: number;
  readonly jumpsIn: number;
  /** The share of cuts that are jump zooms. */
  readonly jumpShare: number;
}

/** What lands on the beat and on hits: a share, and what chance alone would give. */
export interface Landing {
  readonly count: number;
  readonly onBeat: number;
  readonly onHit: number;
  /** Null where the voice couldn't be taken out: someone starting to talk reads as a rise too. */
  readonly rise: number | null;
}

/** One kind of effect: how many, and what they land on. */
export interface EffectUse {
  readonly kind: string;
  readonly count: number;
  /** Leading into or landing on a cut. */
  readonly onCuts: number;
  /** On a punch-in or a jump zoom. */
  readonly onZooms: number;
  /** As text comes up (captions, kinetic words, titles). */
  readonly onText: number;
}

export interface RhythmReport {
  readonly bpm: number | null;
  readonly pulse: number;
  /** The share of moments that land within 70 ms of a beat (or a hit) by chance alone. */
  readonly chance: { readonly beat: number; readonly hit: number };
  readonly cuts: Landing;
  readonly punches: Landing;
  /** Strong hits off the beat, per 10 s (effects, accents). */
  readonly offBeatHits: number;
  readonly voiceless: boolean;
  /** Effects heard, the most used first (none when the voice couldn't be taken out to hear them). */
  readonly effects: readonly EffectUse[];
  /** The share of the video near a cut, a zoom or text coming up: what an effect lands on by chance. */
  readonly effectChance: { readonly cuts: number; readonly zooms: number; readonly text: number };
}

/** Near enough to land on something: two frames at 30 fps. */
const ON = 0.07;
/** A hit worth the name: an onset this many standard deviations above its surroundings. */
const STRONG = 4;

const TRANSITION_ONE: Record<string, string> = {
  cut: "hard cut",
  dissolve: "dissolve",
  flash: "flash",
  dip: "dip to black",
  whip: "whip",
};
const TRANSITION_MANY: Record<string, string> = {
  cut: "hard cuts",
  dissolve: "dissolves",
  flash: "flashes",
  dip: "dips to black",
  whip: "whips",
};

/** The frame's movement over the shots, and the kinds of cut. */
export function motionReport(m: NonNullable<ReferenceStudy["motion"]>, duration: number): MotionReport {
  const punches = m.shots.flatMap((s) => s.punches);
  const long = m.shots.filter((s) => s.to - s.from >= 1);
  const pushes = long.filter((s) => Math.abs(s.drift) >= 0.05);
  const transitions: Record<string, number> = {};
  for (const t of m.transitions) transitions[t.kind] = (transitions[t.kind] ?? 0) + 1;
  return {
    punches: punches.length,
    per10s: duration > 0 ? round((punches.length / duration) * 10, 1) : 0,
    size: round(median(punches.map((p) => Math.abs(p.size)))),
    punchesIn: punches.filter((p) => p.size > 0).length,
    shotsPunched: share(m.shots.filter((s) => s.punches.length).length, m.shots.length),
    pushes: pushes.length,
    pushSize: round(median(pushes.map((s) => Math.abs(s.drift)))),
    pans: long.filter((s) => Math.hypot(s.pan.x, s.pan.y) >= 0.08).length,
    locked: share(m.shots.filter((s) => s.shake < 0.0015).length, m.shots.length),
    handheld: share(m.shots.filter((s) => s.shake >= 0.005).length, m.shots.length),
    transitions,
    jumps: (m.jumps ?? []).length,
    jumpSize: round(median((m.jumps ?? []).map((j) => Math.abs(j.size)))),
    jumpsIn: (m.jumps ?? []).filter((j) => j.size > 0).length,
    jumpShare: share((m.jumps ?? []).length, m.transitions.length),
  };
}

/** What lands on the beat and on hits: the cuts and the punch-ins. */
export function rhythmReport(
  r: NonNullable<ReferenceStudy["rhythm"]>,
  cuts: readonly number[],
  punches: readonly number[],
  duration: number,
  /** Zooms (punch-ins and jump zooms) and when text comes up, with how precisely that's known (s). */
  more: {
    readonly zooms?: readonly number[];
    readonly text?: readonly number[];
    readonly textNear?: number;
  } = {},
): RhythmReport {
  const beats = r.pulse >= 2 ? r.beats : [];
  const strong = r.hits.filter((h) => h.strength >= STRONG).map((h) => h.at);
  const near = (t: number, xs: readonly number[]) => xs.some((x) => Math.abs(x - t) <= ON);
  // A rise into a moment: the half second before it much louder than the half second before that.
  const loud = (a: number, b: number) => {
    const xs = r.loudness.slice(Math.max(0, Math.floor(a / 0.05)), Math.max(0, Math.ceil(b / 0.05)));
    return xs.length ? xs.reduce((n, v) => n + v, 0) / xs.length : 0;
  };
  const rises = (t: number) =>
    t > 1 && loud(t - 0.45, t - 0.05) > 1.8 * Math.max(1e-4, loud(t - 1, t - 0.55));
  const landing = (ts: readonly number[]): Landing => ({
    count: ts.length,
    onBeat: share(ts.filter((t) => near(t, beats)).length, ts.length),
    onHit: share(ts.filter((t) => near(t, strong)).length, ts.length),
    rise: r.voiceless ? share(ts.filter(rises).length, ts.length) : null,
  });
  // A whoosh is spread over its build: near a cut is within a third of a second either side.
  const close = (t: number, xs: readonly number[], by: number) => xs.some((x) => Math.abs(x - t) <= by);
  const kinds = new Map<string, number[]>();
  for (const e of r.effects ?? []) kinds.set(e.kind, [...(kinds.get(e.kind) ?? []), e.at]);
  const effects = [...kinds.entries()]
    .map(([kind, ats]): EffectUse => {
      const by = kind === "whoosh" ? 0.33 : 0.12;
      return {
        kind,
        count: ats.length,
        onCuts: ats.filter((t) => close(t, cuts, by)).length,
        onZooms: ats.filter((t) => close(t, more.zooms ?? punches, by)).length,
        onText: ats.filter((t) => close(t, more.text ?? [], Math.max(by, more.textNear ?? 0.5))).length,
      };
    })
    .sort((a, b) => b.count - a.count);
  // How much of the video is near each kind of moment (the windows' union): where an effect would be
  // anyway. Text comes up so often in some videos that "as text comes up" alone means nothing.
  const covered = (xs: readonly number[], by: number) => {
    const spans = [...xs].sort((a, b) => a - b).map((x) => [Math.max(0, x - by), Math.min(duration, x + by)]);
    let total = 0;
    let end = 0;
    for (const [a, b] of spans) {
      const from = Math.max(a!, end);
      if (b! > from) total += b! - from;
      end = Math.max(end, b!);
    }
    return duration > 0 ? round(Math.min(1, total / duration)) : 0;
  };
  const textBy = Math.max(0.12, more.textNear ?? 0.5);
  const period = beats.length > 1 ? (beats.at(-1)! - beats[0]!) / (beats.length - 1) : 0;
  return {
    bpm: r.bpm ? round(r.bpm, 1) : null,
    pulse: round(r.pulse, 1),
    chance: {
      beat: period > 0 ? round(Math.min(1, (2 * ON) / period)) : 0,
      hit: duration > 0 ? round(Math.min(1, (strong.length * 2 * ON) / duration)) : 0,
    },
    cuts: landing(cuts),
    punches: landing(punches),
    offBeatHits: duration > 0 ? round((strong.filter((t) => !near(t, beats)).length / duration) * 10, 1) : 0,
    voiceless: r.voiceless,
    effects,
    effectChance: {
      cuts: covered(cuts, 0.12),
      zooms: covered(more.zooms ?? punches, 0.12),
      text: covered(more.text ?? [], textBy),
    },
  };
}

/** A stretch to watch play, and why. */
export interface WatchStretch {
  readonly from: number;
  readonly to: number;
  readonly why: string;
}

export interface ReferenceReport {
  readonly source: string;
  readonly label: string;
  readonly duration: number;
  readonly shots: {
    readonly count: number;
    /** Cuts per 10 seconds, over the whole video and in each third (does it speed up?). */
    readonly per10s: number;
    readonly per10sByThird: readonly [number, number, number];
    readonly median: number;
    readonly shortest: number;
    readonly longest: number;
    /** When the first cut comes. */
    readonly firstCut: number | null;
  };
  readonly speech: {
    readonly wordsPerMinute: number;
    /** Share of the video with someone talking. */
    readonly share: number;
    readonly firstWordAt: number;
    /** What's said in the first 3 seconds: the hook. */
    readonly hook: string;
    readonly longestPause: number;
    /** Words said hard (stress ≥ 0.85), as a share. */
    readonly emphatic: number;
  } | null;
  readonly picture: {
    readonly shotTypes: Readonly<Record<string, number>>;
    readonly camera: Readonly<Record<string, number>>;
    /** Mean energy (1-5) in each third. */
    readonly energyByThird: readonly [number, number, number];
    readonly highlights: number;
    /** Share of the time on screen recordings or graphics rather than camera footage. */
    readonly screens: number;
    readonly tags: readonly string[];
    readonly face: { readonly x: number; readonly y: number; readonly size: number } | null;
  } | null;
  readonly sound: {
    readonly music: number;
    readonly heard: Readonly<Record<string, number>>;
    readonly loudness: number | null;
    readonly bpm: number | null;
    /** Share of cuts within 2 frames of a beat, when beats were found. */
    readonly cutsOnBeat: number | null;
  };
  /** Its caption tracks, the most used first (none when nothing on screen is what's said). */
  readonly captions: readonly CaptionReport[];
  readonly onScreen: readonly ScreenText[];
  /** How often the words on screen were read (per second): their times are this precise. */
  readonly textRate: number;
  /** Stretches worth watching play for what numbers can't show: motion, graphics, transitions, colour. */
  readonly watch: readonly WatchStretch[];
  /** From studying it (when it was): the frame's movement and the cuts, and the rhythm. */
  readonly motion: MotionReport | null;
  readonly rhythm: RhythmReport | null;
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Which of the words on screen are captions (what's being said around then: a word caught mid-animation,
 * "entin" of "wanting", or run together, "toupgrade", counts), grouped into tracks by place and size, each
 * measured (words and lines a page, case, place, size, timing against the voice); and the rest, titles.
 */
export function captionsOf(
  seen: readonly SeenText[],
  words: readonly { readonly text: string; readonly start: number; readonly end: number }[],
): { captions: CaptionReport[]; onScreen: ScreenText[] } {
  const spoken = words.map((w) => ({ key: norm(w.text), start: w.start, end: w.end })).filter((w) => w.key);
  const lines = seen.map((t) => {
    const tokens = t.text.split(/\s+/).map(norm).filter(Boolean);
    const near = spoken.filter((w) => w.start >= t.start - 2 && w.start <= t.end + 1.5);
    // Said around then, spaces aside: the line is inside what was said.
    const run = near.map((w) => w.key).join("");
    const key = tokens.join("");
    const said = near.filter((w) => key.includes(w.key) || (w.key.length >= 3 && w.key.includes(key)));
    // A letter in four may be misread ("been v" for "been w"), and a short word can't afford any.
    const errors = key.length < 5 ? 0 : Math.floor(key.length / 4);
    const caption =
      key.length >= 2 &&
      (nearlyContains(run, key, errors) || said.length / Math.max(1, tokens.length) >= 0.6);
    return { t, tokens, said, caption };
  });
  const onScreen: ScreenText[] = [];
  for (const l of lines) {
    if (l.caption || !l.tokens.length) continue;
    if (onScreen.some((o) => norm(o.text) === norm(l.t.text))) continue;
    const mid = l.t.y + l.t.h / 2;
    onScreen.push({
      text: l.t.text,
      start: round(l.t.start, 1),
      end: round(l.t.end, 1),
      where: mid < 0.33 ? "top" : mid < 0.66 ? "middle" : "bottom",
    });
  }
  // Tracks. Subtitles stay put: the densest cluster at one place and size is a fixed track while it
  // holds a good share of the captions. Then what's left by size alone: kinetic words move about, and
  // grow as they come in.
  const caps = lines.filter((l) => l.caption).sort((a, b) => a.t.start - b.t.start);
  const mid = (l: (typeof caps)[number]) => l.t.y + l.t.h / 2;
  const alike = (a: number, b: number, by: number) => Math.max(a, b) / Math.min(a, b) < by;
  const tracks: { lines: typeof caps }[] = [];
  let rest = caps;
  const densest = (near: (a: (typeof caps)[number], b: (typeof caps)[number]) => boolean) => {
    let best: typeof caps = [];
    for (const seed of rest) {
      const group = rest.filter((l) => near(seed, l));
      if (group.length > best.length) best = group;
    }
    return best;
  };
  for (;;) {
    const fixed = densest((a, b) => Math.abs(mid(a) - mid(b)) < 0.06 && alike(a.t.h, b.t.h, 1.5));
    if (fixed.length < Math.max(3, caps.length * 0.15)) break;
    tracks.push({ lines: fixed });
    rest = rest.filter((l) => !fixed.includes(l));
  }
  for (;;) {
    const moving = densest((a, b) => alike(a.t.h, b.t.h, 1.5));
    if (moving.length < Math.max(3, caps.length * 0.05)) break;
    tracks.push({ lines: moving });
    rest = rest.filter((l) => !moving.includes(l));
  }
  const talking = spoken.reduce((n, w) => n + (w.end - w.start), 0);
  const captions = tracks
    .filter((k) => k.lines.length >= Math.max(3, caps.length * 0.05))
    .sort((a, b) => b.lines.length - a.lines.length)
    .slice(0, 3)
    .flatMap((k) => {
      const report = trackOf(k.lines, talking);
      return report ? [report] : [];
    });
  return { captions, onScreen: onScreen.slice(0, 10) };
}

/** One track's pages, set and timed. */
function trackOf(
  lines: readonly { t: SeenText; tokens: string[]; said: { start: number }[] }[],
  talking: number,
): CaptionReport | null {
  // Pages: lines that come up together.
  const pages: (typeof lines)[number][][] = [];
  for (const l of lines) {
    const page = pages.at(-1);
    if (page && Math.abs(l.t.start - page[0]!.t.start) <= 0.15) page.push(l);
    else pages.push([l]);
  }
  if (pages.length < 3) return null;
  const letters = lines.map((l) => l.t.text.replace(/[^\p{L}]/gu, "")).join("");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  const lower = letters.replace(/[^\p{Ll}]/gu, "").length;
  const leads = pages.flatMap((p) => {
    const first = p.flatMap((l) => l.said).sort((a, b) => a.start - b.start)[0];
    return first ? [p[0]!.t.start - first.start] : [];
  });
  const shown = pages.reduce((n, p) => n + Math.max(...p.map((l) => l.t.end)) - p[0]!.t.start, 0);
  const wordsPer = pages.map((p) => p.reduce((n, l) => n + l.tokens.length, 0));
  const mids = pages
    .map((p) => {
      const top = Math.min(...p.map((l) => l.t.y));
      const bottom = Math.max(...p.map((l) => l.t.y + l.t.h));
      return (top + bottom) / 2;
    })
    .sort((a, b) => a - b);
  const at = (q: number) => mids[Math.min(mids.length - 1, Math.floor(q * mids.length))]!;
  return {
    pages: pages.length,
    coverage: talking > 0 ? round(Math.min(1, shown / talking)) : 0,
    wordsPerPage: { median: median(wordsPer), max: Math.max(...wordsPer) },
    linesPerPage: median(pages.map((p) => p.length)),
    secondsPerPage: round(median(pages.map((p) => Math.max(...p.map((l) => l.t.end)) - p[0]!.t.start))),
    case: lower === 0 && upper > 0 ? "upper" : upper < letters.length * 0.05 ? "lower" : "mixed",
    y: round(median(mids)),
    yRange: [round(at(0.1)), round(at(0.9))],
    height: round(median(lines.map((l) => l.t.h)), 3),
    lead: leads.length ? round(median(leads)) : null,
    starts: pages.map((p) => round(p[0]!.t.start)),
  };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs: readonly number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const share = (part: number, whole: number) => (whole > 0 ? round(part / whole) : 0);

function tally(items: readonly { key: string; weight: number }[]): Record<string, number> {
  const total = items.reduce((n, i) => n + i.weight, 0);
  const out: Record<string, number> = {};
  for (const i of items) out[i.key] = (out[i.key] ?? 0) + i.weight;
  return Object.fromEntries(
    Object.entries(out)
      .map(([k, v]) => [k, share(v, total)] as const)
      .sort((a, b) => b[1] - a[1]),
  );
}

export function measureReference(
  doc: ProjectDoc,
  sourceId: string,
  /** Words on screen read again, densely (`rate` a second), instead of indexing's once a second. */
  read?: { readonly text: readonly SeenText[]; readonly rate: number },
  /** Its motion and rhythm, studied. */
  study?: ReferenceStudy,
): ReferenceReport | null {
  const source = doc.sources.find((s) => s.id === sourceId);
  if (source?.kind !== "video") return null;
  const duration = source.duration;
  const analysis = doc.analyses.find((a) => a.id === sourceId);
  const thirds = [0, duration / 3, (2 * duration) / 3, duration] as const;
  const third = (t: number) => Math.min(2, Math.floor((t / duration) * 3)) as 0 | 1 | 2;

  // Shots: the picture's changes, deduplicated within a few frames.
  const cuts = (analysis?.shots ?? [])
    .filter((t) => t > 0.05 && t < duration - 0.05)
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t - all[i - 1]! > 0.08);
  const bounds = [0, ...cuts, duration];
  const lengths = bounds.slice(1).map((t, i) => t - bounds[i]!);
  const per = (n: number, secs: number) => (secs > 0 ? round((n / secs) * 10, 1) : 0);
  const byThird = [0, 1, 2].map((k) =>
    per(cuts.filter((t) => third(t) === k).length, thirds[k + 1]! - thirds[k]!),
  ) as [number, number, number];

  // Speech.
  const words = doc.transcripts.find((t) => t.id === sourceId)?.words ?? [];
  let speech: ReferenceReport["speech"] = null;
  if (words.length >= 5) {
    // Talking time: words joined across gaps under 0.6s.
    let talking = 0;
    let runStart = words[0]!.start;
    let runEnd = words[0]!.end;
    let longestPause = 0;
    for (const w of words.slice(1)) {
      const gap = w.start - runEnd;
      longestPause = Math.max(longestPause, gap);
      if (gap < 0.6) runEnd = Math.max(runEnd, w.end);
      else {
        talking += runEnd - runStart;
        runStart = w.start;
        runEnd = w.end;
      }
    }
    talking += runEnd - runStart;
    speech = {
      wordsPerMinute: talking > 0 ? Math.round((words.length / talking) * 60) : 0,
      share: share(talking, duration),
      firstWordAt: round(words[0]!.start),
      hook: words
        .filter((w) => w.start < 3)
        .map((w) => w.text.trim())
        .join(" "),
      longestPause: round(longestPause),
      emphatic: share(words.filter((w) => (w.stress ?? 0) >= 0.85).length, words.length),
    };
  }

  // Picture, from the shot log.
  const segments = doc.shotLogs.find((l) => l.id === sourceId)?.segments ?? [];
  let picture: ReferenceReport["picture"] = null;
  if (segments.length) {
    const len = (s: { start: number; end: number }) => Math.max(0, s.end - s.start);
    const energy = [0, 1, 2].map((k) => {
      const inThird = segments.filter((s) => third((s.start + s.end) / 2) === k);
      const time = inThird.reduce((n, s) => n + len(s), 0);
      return time > 0 ? round(inThird.reduce((n, s) => n + s.energy * len(s), 0) / time, 1) : 0;
    }) as [number, number, number];
    const tagCount = new Map<string, number>();
    for (const s of segments) for (const t of s.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    picture = {
      shotTypes: tally(segments.map((s) => ({ key: s.shot, weight: len(s) }))),
      camera: tally(segments.map((s) => ({ key: s.camera, weight: len(s) }))),
      energyByThird: energy,
      highlights: segments.filter((s) => s.highlight).length,
      screens: share(
        segments.filter((s) => s.shot === "screen" || s.shot === "graphic").reduce((n, s) => n + len(s), 0),
        duration,
      ),
      tags: [...tagCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([t]) => t),
      face: analysis?.face ?? null,
    };
  }

  // Sound.
  const heard = new Map<string, number>();
  let musicTime = 0;
  for (const s of analysis?.sounds ?? []) {
    if (s.label === "music") musicTime += s.end - s.start;
    else if (s.label !== "silence") heard.set(s.label, (heard.get(s.label) ?? 0) + 1);
  }
  const beats = analysis?.beats ?? [];
  const onBeat =
    beats.length > 4 && cuts.length
      ? share(cuts.filter((c) => beats.some((b) => Math.abs(b - c) <= 2 / 30)).length, cuts.length)
      : null;

  // Captions and titles, from the words on screen.
  // Text read every 1/rate seconds is first seen up to that long after it came up: half of it, on average.
  const rate = read?.rate ?? 1;
  const text = (read?.text ?? analysis?.text ?? []).map((t) => ({
    ...t,
    start: Math.max(0, t.start - 0.5 / rate),
  }));
  const { captions, onScreen } = captionsOf(text, words);

  // Stretches to watch play: the hook, the busiest cutting, the first captions, the end.
  const watch: WatchStretch[] = [{ from: 0, to: round(Math.min(4, duration), 1), why: "the hook" }];
  if (cuts.length > 3) {
    let best = 0;
    let at = 0;
    for (const c of cuts) {
      const n = cuts.filter((d) => d >= c && d < c + 4).length;
      if (n > best) {
        best = n;
        at = c;
      }
    }
    if (at > 3)
      watch.push({
        from: round(Math.max(0, at - 0.5), 1),
        to: round(Math.min(duration, at + 3.5), 1),
        why: `the busiest cutting (${best} cuts in 4s)`,
      });
  }
  const firstCaption = (read?.text ?? analysis?.text ?? []).find((t) =>
    t.text
      .split(/\s+/)
      .some((k) => words.some((w) => norm(w.text) === norm(k) && Math.abs(w.start - t.start) < 1.5)),
  );
  if (firstCaption && firstCaption.start > 4)
    watch.push({
      from: round(firstCaption.start, 1),
      to: round(Math.min(duration, firstCaption.start + 3), 1),
      why: "captions coming in",
    });
  if (duration > 8)
    watch.push({ from: round(Math.max(0, duration - 3), 1), to: round(duration, 1), why: "the ending" });

  return {
    source: sourceId,
    label: source.label,
    duration: round(duration, 1),
    shots: {
      count: lengths.length,
      per10s: per(cuts.length, duration),
      per10sByThird: byThird,
      median: round(median(lengths)),
      shortest: round(Math.min(...lengths)),
      longest: round(Math.max(...lengths)),
      firstCut: cuts[0] !== undefined ? round(cuts[0]) : null,
    },
    speech,
    picture,
    sound: {
      music: share(musicTime, duration),
      heard: Object.fromEntries([...heard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
      loudness: analysis?.loudness ?? null,
      bpm: analysis?.bpm ? Math.round(analysis.bpm) : null,
      cutsOnBeat: onBeat,
    },
    captions,
    onScreen,
    textRate: read?.rate ?? 1,
    watch,
    motion: study?.motion ? motionReport(study.motion, duration) : null,
    rhythm: study?.rhythm
      ? rhythmReport(
          study.rhythm,
          cuts,
          study.motion?.shots.flatMap((s) => s.punches.map((p) => p.at)) ?? [],
          duration,
          {
            zooms: [
              ...(study.motion?.shots.flatMap((s) => s.punches.map((p) => p.at)) ?? []),
              ...(study.motion?.jumps.map((j) => j.at) ?? []),
            ],
            // Every caption track's pages and the other text coming up (captions: the voice's own, mostly).
            text: [...captions.flatMap((c) => c.starts), ...onScreen.map((o) => o.start)],
            textNear: 0.5 / rate,
          },
        )
      : null,
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const top = (r: Readonly<Record<string, number>>, n = 4) =>
  Object.entries(r)
    .slice(0, n)
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(", ");

function paceWord(median: number): string {
  if (median < 1) return "very fast: a cut on almost every beat of speech";
  if (median < 2) return "fast: a new shot every phrase";
  if (median < 4) return "steady: a new shot every sentence or two";
  return "slow: shots are held and allowed to breathe";
}

/** The report as an editor's notes, for the agent. */
export function referenceText(r: ReferenceReport): string {
  const lines = [`${r.label} (${r.source}), ${r.duration}s.`];
  const s = r.shots;
  lines.push(
    `Cutting: ${s.count} shots, ${s.per10s} cuts per 10s (by third: ${s.per10sByThird.join(" / ")}), median shot ${s.median}s (${s.shortest}-${s.longest}s), first cut at ${s.firstCut ?? "none"}s. Pace: ${paceWord(s.median)}.${
      s.per10sByThird[2] > s.per10sByThird[0] * 1.3
        ? " It speeds up toward the end."
        : s.per10sByThird[0] > s.per10sByThird[2] * 1.3
          ? " It opens fastest, then settles."
          : ""
    }`,
  );
  if (r.speech) {
    const sp = r.speech;
    lines.push(
      `Speech: ${sp.wordsPerMinute} words a minute (${sp.wordsPerMinute > 170 ? "fast, tightly cut" : sp.wordsPerMinute < 130 ? "relaxed" : "natural"}), talking ${pct(sp.share)} of the time, first word at ${sp.firstWordAt}s, longest pause ${sp.longestPause}s, ${pct(sp.emphatic)} of words hit hard. The first 3 seconds say: "${sp.hook}".`,
    );
  } else lines.push("Speech: little or none: the picture and the music carry it.");
  if (r.picture) {
    const p = r.picture;
    lines.push(
      `Picture: shots ${top(p.shotTypes)}; camera ${top(p.camera)}; energy by third ${p.energyByThird.join(" / ")} (1 calm to 5 explosive); ${p.highlights} standout moments; ${pct(p.screens)} screen recordings or graphics.${p.face ? ` The face sits at x ${p.face.x.toFixed(2)}, y ${p.face.y.toFixed(2)}, ${pct(p.face.size)} of the width.` : ""} Shows: ${p.tags.join(", ")}.`,
    );
  }
  const so = r.sound;
  const heard = Object.entries(so.heard)
    .map(([k, n]) => `${k} ×${n}`)
    .join(", ");
  lines.push(
    `Sound: music under ${pct(so.music)} of it${so.bpm ? ` (${so.bpm} bpm)` : ""}${so.cutsOnBeat !== null ? `, ${pct(so.cutsOnBeat)} of cuts on the beat` : ""}${so.loudness !== null ? `, ${so.loudness.toFixed(1)} LUFS` : ""}${heard ? `; heard ${heard}` : ""}.`,
  );
  const precision = `±${round(1 / r.textRate, 2)}s`;
  if (r.captions.length) {
    const many = r.captions.length > 1;
    lines.push(
      `Captions (read off the screen ${r.textRate} times a second: times ${precision})${many ? `, in ${r.captions.length} tracks at once` : ""}:`,
    );
    for (const [i, c] of r.captions.entries()) {
      // A line's box is about a cap height in capitals, more with lower case (ascenders and descenders).
      const size = Math.round((c.height * 1920) / (c.case === "upper" ? 0.75 : 1));
      lines.push(
        `${many ? `${i + 1}. ` : ""}${c.pages} pages covering ${pct(c.coverage)} of the talking; ${c.wordsPerPage.median} words a page (up to ${c.wordsPerPage.max}), ${c.linesPerPage} line${c.linesPerPage === 1 ? "" : "s"}, each up ${c.secondsPerPage}s; ${c.case === "upper" ? "ALL CAPS" : c.case === "lower" ? "all lower case" : "mixed case"}; ${c.yRange[1] - c.yRange[0] > 0.15 ? `moving around: mostly between ${pct(c.yRange[0])} and ${pct(c.yRange[1])} down the frame` : `centred ${pct(c.y)} down the frame`}; a line ${pct(c.height)} of the frame's height (about size ${size} in a 1920-tall frame)${c.lead !== null ? `; a page comes up ${Math.abs(c.lead) < 0.05 ? "as its first word is said" : c.lead < 0 ? `${Math.abs(c.lead)}s ahead of its first word` : `${c.lead}s after its first word`}` : ""}.`,
      );
    }
    lines.push(
      `${many ? "One track is captionStyle; another is a graphic or a second caption look. " : ""}How words appear (pop, slide, a word lit), the font and the colours: watch them.`,
    );
  } else lines.push("Captions: none burned in (or too few to read).");
  const m = r.motion;
  if (m) {
    const kinds = Object.entries(m.transitions)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${(n === 1 ? TRANSITION_ONE : TRANSITION_MANY)[k] ?? k}`)
      .join(", ");
    const jumps = m.jumps
      ? ` ${m.jumps} jump zoom${m.jumps === 1 ? "" : "s"} (cuts within a take, reframed: ${pct(m.jumpShare)} of cuts, typically ${pct(m.jumpSize)}; ${m.jumpsIn} tighter, ${m.jumps - m.jumpsIn} looser).`
      : "";
    lines.push(
      `Motion: ${m.punches ? `${m.punches} punch-ins (${m.per10s} per 10s, typically ${pct(m.size)}; ${m.punchesIn} in, ${m.punches - m.punchesIn} out) in ${pct(m.shotsPunched)} of shots` : "no punch-ins"}; ${m.pushes ? `${m.pushes} slow push${m.pushes === 1 ? "" : "es"} (about ${pct(m.pushSize)} over a shot)` : "no slow pushes"}; ${m.pans} pan${m.pans === 1 ? "" : "s"}; ${pct(m.locked)} of shots locked off, ${pct(m.handheld)} handheld.${kinds ? ` Transitions: ${kinds}.` : ""}${jumps}`,
    );
  }
  const rh = r.rhythm;
  if (rh) {
    const land = (what: string, l: Landing) =>
      l.count
        ? `${what} (${l.count}): ${pct(l.onBeat)} on the beat (by chance ${pct(rh.chance.beat)}), ${pct(l.onHit)} on a hit (by chance ${pct(rh.chance.hit)})${l.rise !== null ? `, ${pct(l.rise)} with a rise into them` : ""}`
        : "";
    lines.push(
      `Rhythm: ${rh.bpm ? `${rh.bpm} bpm, ${rh.pulse >= 4 ? "a clear beat" : rh.pulse >= 2 ? "a soft beat" : "no beat to speak of"} (pulse ${rh.pulse})` : "no steady beat"}. ${[land("Cuts", rh.cuts), land("Punch-ins", rh.punches)].filter(Boolean).join(". ")}. ${rh.offBeatHits} strong hits per 10s off the beat (effects, accents)${rh.voiceless ? "" : ", from the whole mix: some may be the voice"}. Well above chance is a habit worth copying; near it is coincidence.`,
    );
    if (rh.effects.length) {
      const named: Record<string, string> = {
        whoosh: "whooshes",
        impact: "impacts",
        pop: "pops",
        boing: "boings",
        click: "clicks",
        ding: "dings",
        "camera shutter": "camera shutters",
        "cash register": "cash registers",
        "whip crack": "whip cracks",
        zing: "zings",
        beep: "beeps",
      };
      const lands = (e: EffectUse) =>
        [
          e.onCuts ? `${e.onCuts} on cuts` : "",
          e.onZooms ? `${e.onZooms} on zooms` : "",
          e.onText ? `${e.onText} as text comes up` : "",
        ]
          .filter(Boolean)
          .join(", ");
      lines.push(
        `Effects (heard in the sound without the voice): ${rh.effects
          .map(
            (e) =>
              `${e.count} ${e.count === 1 ? e.kind : (named[e.kind] ?? e.kind)}${lands(e) ? ` (${lands(e)})` : ""}`,
          )
          .join(
            "; ",
          )}. By chance alone an effect lands on a cut ${pct(rh.effectChance.cuts)} of the time, on a zoom ${pct(rh.effectChance.zooms)}, as text comes up ${pct(rh.effectChance.text)}. The starter pack and find_sound have each kind.`,
      );
    } else if (rh.voiceless) lines.push("Effects: none heard.");
    else lines.push("Effects: not heard (the voice couldn't be taken out to listen under it).");
  }
  if (r.onScreen.length)
    lines.push(
      `Other text on screen: ${r.onScreen
        .map((o) => `"${o.text}" ${o.start}-${o.end}s (${o.where})`)
        .join("; ")}.`,
    );
  lines.push(
    `Watch it play (watch with source ${r.source}), for what numbers can't show (how captions and graphics move, zooms and punch-ins, transitions, the colour): ${r.watch
      .map((w) => `${w.from}-${w.to}s (${w.why})`)
      .join("; ")}; then the whole of it at 1-2 frames a second.`,
  );
  return lines.join("\n");
}
