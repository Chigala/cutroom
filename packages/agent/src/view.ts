/**
 * What the model sees of a project: compact, with absolute times precomputed so it never has to add up
 * scene lengths itself, and without file paths (it has no use for them and they leak the user's disk).
 */
import { type CheckResult, runChecks } from "@vedit/checks";
import { describePicture, describeVoice } from "@vedit/media";
import {
  BUNDLED_FONTS,
  captionLookMeta,
  formatTime,
  type ProjectDoc,
  parseGraphic,
  resolveAnchor,
  round,
  spokenWords,
  styleMeta,
  timelineOf,
} from "@vedit/project";

export function projectView(doc: ProjectDoc): string {
  const tl = timelineOf(doc);
  const sources = new Map(doc.sources.map((s) => [s.id, s]));
  const at = (a: { scene: string; at: number }) => {
    const t = resolveAnchor(tl, a);
    return t === null ? "orphaned" : round(t, 2);
  };
  const inCut = new Set(doc.scenes.map((s) => s.source));
  const view = {
    name: doc.meta.name,
    format: doc.meta.format,
    duration: round(tl.duration, 2),
    clips: doc.sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      length: round(s.duration, 2),
      ...(s.width && { size: `${s.width}x${s.height}` }),
      speech: s.speech,
      words: doc.transcripts.find((t) => t.id === s.id)?.words.length ?? 0,
      ...(() => {
        const log = doc.shotLogs.find((l) => l.id === s.id);
        return log
          ? { shots: log.segments.length, highlights: log.segments.filter((x) => x.highlight).length }
          : {};
      })(),
      ...(s.summary && { summary: s.summary }),
      ...(s.origin && { from: `${s.origin.provider} ${s.origin.url}` }),
      ...(s.recipe && { recipe: s.recipe }),
      ...(s.tags.length && { tags: s.tags }),
      status: s.status,
      ...(doc.analyses.find((a) => a.id === s.id)?.face && {
        face: doc.analyses.find((a) => a.id === s.id)?.face,
      }),
      ...(() => {
        // Measured at import: how the voice and picture compare with broadcast standards.
        const a = doc.analyses.find((x) => x.id === s.id);
        // Heard at import: the sounds in it, and a track's instruments.
        const heard = (a?.sounds ?? []).filter((x) => x.label !== "music" && x.label !== "silence");
        const counts = [...new Set(heard.map((x) => x.label))].map(
          (l) =>
            `${l}${heard.filter((x) => x.label === l).length > 1 ? ` x${heard.filter((x) => x.label === l).length}` : ""}`,
        );
        return {
          ...(counts.length && { sounds: counts.join(", ") }),
          ...(a?.instruments?.length && { instruments: a.instruments.map((i) => i.name).join(", ") }),
          ...(a?.voice && { voice: describeVoice(a.voice) }),
          ...(a?.picture && { picture: describePicture(a.picture, doc.checkRules.castCorrection) }),
        };
      })(),
      inCut: inCut.has(s.id),
      ...(() => {
        // Music: its tempo, where it gets going and where it hits (listen hears the rest).
        const a = doc.analyses.find((x) => x.id === s.id);
        return a?.bpm
          ? {
              bpm: a.bpm,
              ...(a.start !== undefined && { getsGoing: round(a.start, 2) }),
              ...(a.drop !== undefined && { hit: round(a.drop, 2) }),
            }
          : {};
      })(),
    })),
    scenes: tl.scenes.map((p) => ({
      id: p.scene.id,
      start: round(p.start, 2),
      duration: round(p.duration, 2),
      source: p.scene.source,
      in: p.scene.in,
      out: p.scene.out,
      ...(p.scene.note && { note: p.scene.note }),
      ...(p.scene.framing && { framing: p.scene.framing }),
      ...(p.scene.volume !== 1 && { volume: p.scene.volume }),
      ...(p.scene.speed !== undefined && p.scene.speed !== 1 && { speed: p.scene.speed }),
      ...(p.scene.ramp?.length && { ramp: p.scene.ramp }),
      ...(p.scene.stabilize && { stabilize: p.scene.stabilize }),
      ...(p.scene.interpolate === false && { interpolate: false }),
      ...(p.scene.camera?.length && { camera: p.scene.camera }),
      ...(p.scene.background && { background: p.scene.background }),
      ...(p.scene.subject && { subject: p.scene.subject }),
      ...(p.scene.audioLead && { audioLead: p.scene.audioLead }),
      ...(p.scene.audioTail && { audioTail: p.scene.audioTail }),
      ...(p.scene.transition && { transition: p.scene.transition }),
      ...(p.scene.adjust && { adjust: p.scene.adjust }),
      ...(p.scene.flip && { flip: true }),
      ...(p.scene.jumpZoom === false && { jumpZoom: false }),
      ...(!sources.has(p.scene.source) && { missing: true }),
    })),
    titles: doc.titles.map((t) => ({ ...t, time: at(t.anchor) })),
    captionStyle: doc.captionStyle,
    manualCaptions: doc.captions.map((c) => ({ ...c, time: at(c.anchor) })),
    wordEdits: doc.wordEdits,
    zooms: doc.zooms.map((z) => ({ ...z, time: at(z.anchor) })),
    visuals: doc.visuals.map((v) => ({ ...v, time: at(v.anchor) })),
    effects: doc.effects.map((e) => ({ ...e, time: at(e.anchor) })),
    graphics: graphicsCatalog(doc),
    captionLooks: doc.captionLooks.map((l) => ({ id: l.id, ...captionLookMeta(l.css) })),
    effectKinds: doc.effectKinds.map((f) => ({ id: f.id, ...styleMeta(f.css) })),
    transitions: doc.transitionKinds.map((f) => ({ id: f.id, ...styleMeta(f.css) })),
    grades: doc.grades.map((f) => ({ id: f.id, ...styleMeta(f.css) })),
    fonts: [
      ...BUNDLED_FONTS.map((f) => ({ family: f.family, weights: f.weights, note: f.note })),
      ...[...new Set(doc.fonts.map((f) => f.family))].map((family) => ({
        family,
        weights: doc.fonts.filter((f) => f.family === family).map((f) => f.weight),
        note: "the project's own (fonts/)",
      })),
    ],
    sfx: doc.sfx.map((s) => ({ ...s, time: at(s.anchor) })),
    music: doc.music,
    musicCues: doc.musicCues.map((c) => ({ ...c, time: at(c.anchor) })),
    look: doc.look,
    mix: doc.mix,
    exportSettings: doc.exportSettings,
    cover: { ...doc.cover, ...(doc.cover.at && { time: at(doc.cover.at) }) },
    checkRules: doc.checkRules,
    musicClips: doc.musicClips.map((m) => ({ ...m, time: at(m.anchor) })),
    comments: doc.comments.map((c) => ({ ...c, time: at(c.anchor) })),
  };
  return JSON.stringify(view);
}

/**
 * A clip's transcript the way an editor reads it: a word index before every word (what rough_cut and
 * edit_words take), pauses marked, and words that are not in the current cut wrapped in ~tildes~.
 */
/** How hard a word must be said to be marked as emphasised. */
const STRESSED = 0.85;

export function transcriptView(doc: ProjectDoc, sourceId: string, from = 0, to = Infinity): string {
  const t = doc.transcripts.find((x) => x.id === sourceId);
  if (!t) return `${sourceId}: no transcript (not indexed yet, or no speech).`;
  const inCut = new Set(
    spokenWords(doc)
      .filter((w) => w.source === sourceId)
      .map((w) => w.index),
  );
  const edits = new Map(doc.wordEdits.map((e) => [e.id, e]));
  const lines: string[] = [];
  let line = "";
  const last = Math.min(t.words.length - 1, to);
  for (let i = Math.max(0, from); i <= last; i++) {
    const w = t.words[i]!;
    const prev = t.words[i - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (gap >= 0.6 && line) {
      lines.push(`${line.trim()} ⏸${gap.toFixed(1)}s`);
      line = "";
    }
    const fix = edits.get(`${sourceId}:${i}`)?.text;
    // ↑: said hard (louder, higher or drawn out than the words around it).
    const text = `${fix ? `${w.text}→${fix}` : w.text}${(w.stress ?? 0) >= STRESSED ? "↑" : ""}`;
    line += ` [${i}]${inCut.has(i) ? text : `~${text}~`}`;
  }
  if (line) lines.push(line.trim());
  const head = `${sourceId} (${t.words.length} words, ${round(t.words.at(-1)?.end ?? 0, 1)}s; [i]=word index, ⏸=pause, ~word~=not in the cut${t.words.some((w) => w.stress !== undefined) ? ", word↑=said with emphasis (heard: louder, higher or drawn out)" : ""})`;
  return `${head}\n${lines.join("\n")}`;
}

/**
 * The visual transcript of a clip, one line per segment in source time:
 *   0:42.0-0:48.5 wide · tilt · E5 ★ ignition, huge flame, smoke rolls across the pad [launch, rocket]
 * Plus the loud stretches with no speech (crowds, applause, engines).
 */
export function shotsView(doc: ProjectDoc, sourceId: string, from = 0, to = Infinity): string {
  const log = doc.shotLogs.find((x) => x.id === sourceId);
  const seen = pictureView(doc, sourceId, from, to);
  if (!log) return `${sourceId}: no shot log (not indexed yet, or not a video).${seen ? `\n${seen}` : ""}`;
  const t = (s: number) => formatTime(s, true);
  const lines = log.segments
    .filter((s) => s.end > from && s.start < to)
    .map(
      (s) =>
        `${t(s.start)}-${t(s.end)} ${s.shot} · ${s.camera} · E${s.energy}${s.highlight ? " ★" : ""}${s.quality.length ? ` (${s.quality.join(", ")})` : ""} ${s.what}${s.tags.length ? ` [${s.tags.join(", ")}]` : ""}`,
    );
  const loud = log.loud.filter(([a, b]) => b > from && a < to).map(([a, b]) => `${t(a)}-${t(b)}`);
  return `${sourceId} (${log.segments.length} shots; E=energy 1-5, ★=highlight)\n${lines.join("\n")}${loud.length ? `\nLoud, no speech (crowd, applause, engines, music): ${loud.join(", ")}` : ""}${seen ? `\n${seen}` : ""}`;
}

/**
 * What the clip's picture was read to hold, in source time: the words on screen (and where), the
 * best-looking moments, and moments the face is weak (a blink, blurred, turned away). Empty when the
 * clip wasn't read (see.ts).
 */
export function pictureView(doc: ProjectDoc, sourceId: string, from = 0, to = Infinity): string {
  const a = doc.analyses.find((x) => x.id === sourceId);
  if (!a) return "";
  const t = (s: number) => formatTime(s, true);
  const where = (y: number, h: number) => {
    const mid = y + h / 2;
    return mid < 0.33 ? "top" : mid > 0.66 ? "bottom" : "middle";
  };
  const parts: string[] = [];
  const text = (a.text ?? []).filter((x) => x.end > from && x.start < to);
  if (text.length) {
    // Many short lines low in the frame, changing every second or two: captions already burned in.
    const low = text.filter((x) => x.y > 0.45 && x.end - x.start <= 4);
    const burned = low.length >= 6;
    parts.push(
      `On screen (words in the picture, ${text.length}): ${text
        .slice(0, 30)
        .map((x) => `${t(x.start)}-${t(x.end)} "${x.text}" (${where(x.y, x.h)})`)
        .join(
          "; ",
        )}${text.length > 30 ? "; ..." : ""}${burned ? "\nThis footage looks like it already has captions burned in: don't add captions over them (crop or cover them, or skip captions here)." : ""}`,
    );
  }
  const quality = (a.quality ?? []).filter((q) => q.t >= from && q.t < to);
  if (quality.length >= 3) {
    const score = (q: (typeof quality)[number]) => (q.look ?? 0) + (q.face ?? q.sharp ?? 0);
    const best = [...quality]
      .sort((p, q) => score(q) - score(p))
      .slice(0, 5)
      .map(
        (q) =>
          `${t(q.t)}${q.look !== undefined ? ` look ${q.look.toFixed(2)}` : ""}${q.face !== undefined ? ` face ${q.face.toFixed(2)}` : ""}`,
      );
    parts.push(`Best-looking moments (covers, takes): ${best.join("; ")}`);
    const faces = quality.filter((q) => q.face !== undefined).map((q) => q.face!);
    if (faces.length >= 3) {
      const typical = [...faces].sort((p, q) => p - q)[Math.floor(faces.length / 2)]!;
      const weak = quality.filter((q) => q.face !== undefined && q.face < typical * 0.6);
      if (weak.length)
        parts.push(
          `Weak face moments (a blink, blur or a turn: don't cut or pick a cover there): ${weak
            .slice(0, 15)
            .map((q) => t(q.t))
            .join(", ")}`,
        );
    }
  }
  return parts.join("\n");
}

/** What each graphic is for and which values it takes, without its HTML. */
export function graphicsCatalog(doc: ProjectDoc) {
  return doc.graphics.map((g) => {
    try {
      const { meta } = parseGraphic(g.html);
      return {
        id: g.id,
        name: meta.name,
        description: meta.description,
        duration: meta.duration,
        params: Object.fromEntries(
          Object.entries(meta.params).map(([k, p]) => [
            k,
            {
              type: p.type,
              ...(p.description && { description: p.description }),
              ...(p.options && { options: p.options }),
              default: p.default,
            },
          ]),
        ),
      };
    } catch (err) {
      return { id: g.id, error: (err as Error).message };
    }
  });
}

export function checksView(results: readonly CheckResult[]): string {
  if (!results.length) return "No checks ran: the timeline is empty.";
  return results
    .map(
      (r) =>
        `${r.status.toUpperCase()} ${r.id}: ${r.title}${r.detail ? ` (${r.detail})` : ""}${r.fix ? ` [fix available: ${r.fix.label}]` : ""}`,
    )
    .join("\n");
}

export function checkStep(doc: ProjectDoc): { text: string; warn: boolean; results: CheckResult[] } {
  const results = runChecks(doc);
  const passed = results.filter((r) => r.status === "pass").length;
  const failing = results.length - passed;
  return {
    results,
    warn: failing > 0,
    text: `Ran checks: ${passed} passed${failing ? `, ${failing} ${failing === 1 ? "warning" : "warnings"}` : ""}`,
  };
}

/** Footage search over labels, tags, summaries and every word said. Returns times you can cut to. */
export function searchFootage(doc: ProjectDoc, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (text: string) => terms.reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0);
  const clips = doc.sources
    .map((s) => ({
      id: s.id,
      label: s.label,
      summary: s.summary,
      tags: s.tags,
      length: s.duration,
      score: score(`${s.label} ${s.summary} ${s.tags.join(" ")}`),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  const said: { source: string; word: number; time: number; text: string }[] = [];
  const phrase = terms.join(" ");
  for (const t of doc.transcripts) {
    const words = t.words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""));
    for (let i = 0; i < words.length && said.length < 25; i++) {
      const window = words.slice(i, i + terms.length).join(" ");
      if (window === phrase || (terms.length === 1 && words[i]!.includes(terms[0]!))) {
        const ctx = t.words
          .slice(Math.max(0, i - 6), i + terms.length + 6)
          .map((w) => w.text)
          .join(" ");
        said.push({ source: t.id, word: i, time: round(t.words[i]!.start, 2), text: ctx });
      }
    }
  }
  const scenes = doc.scenes
    .map((s) => ({ id: s.id, note: s.note, source: s.source, score: score(s.note) }))
    .filter((s) => s.score > 0)
    .slice(0, 15);
  // What the picture shows: shot descriptions and tags, best matches first, highlights and energy
  // breaking ties.
  const shown = doc.shotLogs
    .flatMap((log) =>
      log.segments.map((s) => ({
        source: log.id,
        start: s.start,
        end: s.end,
        what: s.what,
        energy: s.energy,
        ...(s.highlight && { highlight: true }),
        score: score(`${s.what} ${s.tags.join(" ")} ${s.shot}`) + (s.highlight ? 0.5 : 0) + s.energy / 10,
      })),
    )
    .filter((s) => s.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map(({ score: _, ...s }) => s);
  // What was heard: laughter, applause, a gasp... ("laugh" finds laughter).
  const heard = doc.analyses
    .flatMap((a) => (a.sounds ?? []).map((s) => ({ source: a.id, ...s })))
    .filter((s) => terms.some((t) => s.label.includes(t) || t.includes(s.label.split(" ")[0]!.slice(0, 5))))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 25);
  // Words seen on screen: a sign, a slide, a product's name.
  const onScreen = doc.analyses
    .flatMap((a) => (a.text ?? []).map((x) => ({ source: a.id, start: x.start, end: x.end, text: x.text })))
    .filter((x) => score(x.text) > 0)
    .sort((p, q) => score(q.text) - score(p.text))
    .slice(0, 25);
  return { clips, said, shown, heard, scenes, ...(onScreen.length && { onScreen }) };
}
