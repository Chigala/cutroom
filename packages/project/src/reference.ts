/**
 * A reference video measured the way an editor would study it before copying its style: how often it
 * cuts and whether that changes over the video, how fast the speaker talks and how the first seconds
 * hook, what kinds of shots it uses and how they move, where the energy is, whether music drives it and
 * the cuts land on the beat. Pure: everything comes from what indexing already wrote (the picture's shot
 * changes, the transcript, the shot log, the sounds heard). What it can't measure (the caption style, the
 * graphics, the colour) the agent sees for itself at the moments listed in `lookAt`.
 */
import type { ProjectDoc } from "./schema.ts";

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
  /** Moments worth looking at for what numbers can't show: captions, graphics, colour, the hook. */
  readonly lookAt: readonly number[];
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

export function measureReference(doc: ProjectDoc, sourceId: string): ReferenceReport | null {
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

  // Moments to look at: the hook, a few different shots, the densest stretch, the end.
  const look = new Set<number>([0.4, Math.min(1.5, duration / 3)]);
  const varied = new Map<string, number>();
  for (const s of segments) if (!varied.has(s.shot)) varied.set(s.shot, round((s.start + s.end) / 2, 1));
  for (const t of [...varied.values()].slice(0, 3)) look.add(t);
  if (cuts.length > 3) {
    let best = 0;
    let at = 0;
    for (const c of cuts) {
      const n = cuts.filter((d) => d >= c && d < c + 3).length;
      if (n > best) {
        best = n;
        at = c;
      }
    }
    look.add(round(at + 0.5, 1));
  }
  const firstSpeech = words.find((w) => w.start > 2);
  if (firstSpeech) look.add(round(firstSpeech.end, 1));
  look.add(round(Math.max(0, duration - 1), 1));

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
    lookAt: [...look]
      .filter((t) => t >= 0 && t <= duration)
      .sort((a, b) => a - b)
      .slice(0, 8),
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
  lines.push(
    `Look at these moments (look with source ${r.source}) for what the numbers can't show: the caption style (font, size, case, colour, words per line, how words appear), text and graphics on screen, zooms and transitions, the colour grade: ${r.lookAt.join(", ")}s.`,
  );
  return lines.join("\n");
}
