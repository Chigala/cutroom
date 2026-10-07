/**
 * Checks are the test suite for a video: deterministic rules over the project doc, cheap enough to run
 * on every change. The agent runs them before it hands work back, and the panel shows them like CI.
 * A check can carry a fix as plain ops, so "Fix" is just another commit.
 */
import {
  CheckRules,
  castCorrected,
  castCorrection,
  DANGLING_WORDS,
  formatTime,
  frameWindow,
  type Op,
  type ProjectDoc,
  resolveAnchor,
  round,
  spokenWords,
  type Timeline,
  timelineOf,
  toFrame,
  validateGraphic,
} from "@vedit/project";

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  /** What is wrong, in one plain sentence. Absent when passing. */
  readonly detail?: string;
  /** Scene ids involved, for highlighting. */
  readonly scenes?: readonly string[];
  readonly fix?: { readonly label: string; readonly ops: readonly Op[] };
}

interface Rule {
  readonly id: string;
  readonly title: string;
  run(doc: ProjectDoc, tl: Timeline): Omit<CheckResult, "id" | "title">;
}

const pass = { status: "pass" } as const;

/** Where each platform's app UI leaves the picture clear (fractions of the frame). */
const SAFE_ZONES: Record<CheckRules["platform"], { top: number; bottom: number; right: number }> = {
  // Phone UI covers roughly the bottom 17% (caption bar, buttons) and the right 18% (like, share).
  tiktok: { top: 0.08, bottom: 0.78, right: 0.82 },
  reels: { top: 0.1, bottom: 0.8, right: 0.85 },
  shorts: { top: 0.08, bottom: 0.8, right: 0.85 },
  youtube: { top: 0, bottom: 1, right: 1 },
  none: { top: 0, bottom: 1, right: 1 },
};

export const safeZoneFor = (platform: CheckRules["platform"]) => SAFE_ZONES[platform];

/** The project's clear area: its own (checks.json safeZone), or its platform's. */
export const clearArea = (rules: Pick<CheckRules, "platform" | "safeZone">) =>
  rules.safeZone ?? SAFE_ZONES[rules.platform];

/** The TikTok safe zone, the default. */
export const SAFE_ZONE = SAFE_ZONES.tiktok;

/** The rules of the project being checked (checks.json); set by runChecks. */
let R: CheckRules = CheckRules.parse({});

export const MIN_SHOT = 0.4;
export const MAX_SHOT = 4;

const rules: Rule[] = [
  {
    id: "hook",
    title: "Hook shows in the first seconds",
    run(doc, tl) {
      const hook = doc.titles.find((t) => t.role === "hook");
      if (!hook)
        return { status: "fail", detail: "There is no hook title. Viewers decide in the first second." };
      const start = resolveAnchor(tl, hook.anchor);
      if (start === null) return { status: "fail", detail: "The hook is pinned to a shot that was cut." };
      if (start <= R.hookWithin) return pass;
      const first = tl.scenes[0];
      return {
        status: "warn",
        detail: `The hook appears at ${start.toFixed(1)}s.`,
        ...(first && {
          fix: {
            label: "Move hook to the start",
            ops: [
              {
                op: "update",
                coll: "titles",
                id: hook.id,
                patch: { anchor: { scene: first.scene.id, at: 0 } },
              },
            ],
          },
        }),
      };
    },
  },
  {
    id: "safe-zones",
    title: "Captions clear of platform UI",
    run(doc) {
      const { y } = doc.captionStyle;
      const titles = doc.titles.filter(
        (t) => t.position.y < clearArea(R).top || t.position.y > clearArea(R).bottom,
      );
      if (y > clearArea(R).bottom)
        return {
          status: "warn",
          detail: "Captions sit under the platform's buttons and caption bar.",
          fix: { label: "Raise captions", ops: [{ op: "merge", key: "captionStyle", patch: { y: 0.7 } }] },
        };
      if (titles.length)
        return {
          status: "warn",
          detail: `${titles.length} title${titles.length > 1 ? "s" : ""} outside the safe area.`,
          fix: {
            label: "Move into safe area",
            ops: titles.map((t) => ({
              op: "update" as const,
              coll: "titles" as const,
              id: t.id,
              patch: { position: { ...t.position, y: Math.min(Math.max(t.position.y, 0.1), 0.7) } },
            })),
          },
        };
      return pass;
    },
  },
  {
    id: "beat",
    title: "Cuts land on the beat",
    run(doc, tl) {
      const beats = musicBeats(doc);
      if (!beats.length) return pass;
      const speech = speechSources(doc);
      // Talking-head cuts follow the words, not the music: only check cuts between non-speech shots.
      const off = tl.scenes.slice(1).filter((s, i) => {
        const prev = tl.scenes[i]!;
        if (speech.has(s.scene.source) || speech.has(prev.scene.source)) return false;
        return nearest(beats, s.start).distance > R.beatTolerance;
      });
      if (off.length <= Math.floor(tl.scenes.length / 5)) return pass;
      return {
        status: "warn",
        detail: `${off.length} cuts miss the beat.`,
        scenes: off.map((s) => s.scene.id),
        fix: { label: "Snap cuts to beat", ops: snapToBeat(doc, tl, beats) },
      };
    },
  },
  {
    id: "ducking",
    title: "Music ducks under speech",
    run(doc) {
      if (!doc.music.source || !speechSources(doc).size || doc.music.duckUnderSpeech) return pass;
      return {
        status: "warn",
        detail: "Music plays at full volume over speech.",
        fix: { label: "Duck music", ops: [{ op: "merge", key: "music", patch: { duckUnderSpeech: true } }] },
      };
    },
  },
  {
    id: "words-clear",
    title: "Captions and titles clear of words in the footage",
    run(doc, tl) {
      const found = wordsInFrame(doc, tl);
      if (!found.length) return pass;
      const cs = doc.captionStyle;
      // When captions show: under the words said (speech captions), and the captions placed by hand.
      const shown = [
        ...(cs.speech ? spokenWords(doc).filter((w) => !w.hidden) : []),
        ...doc.captions.flatMap((c) => {
          const start = resolveAnchor(tl, c.anchor);
          return start === null ? [] : [{ start, end: start + c.duration }];
        }),
      ];
      const captioned = (t1: number, t2: number) => shown.some((w) => w.start < t2 && w.end > t1);
      const band = (y: number) => ({
        x: cs.marginLeft,
        y: y - 0.06,
        w: 1 - cs.marginLeft - cs.marginRight,
        h: 0.12,
      });
      const underCaptions = (y: number) =>
        found.filter((f) => captioned(f.from, f.to) && overlaps(f.box, band(y)));
      const hits: { at: number; text: string; scene: string; by: string }[] = underCaptions(cs.y).map(
        (f) => ({
          at: f.from,
          text: f.text,
          scene: f.scene,
          by: "Captions",
        }),
      );
      for (const title of doc.titles) {
        const start = resolveAnchor(tl, title.anchor);
        if (start === null) continue;
        const box = titleBox(title, doc.meta.format.height);
        for (const f of found)
          if (start < f.to && start + title.duration > f.from && overlaps(f.box, box))
            hits.push({ at: Math.max(start, f.from), text: f.text, scene: f.scene, by: "A title" });
      }
      if (!hits.length) return pass;
      hits.sort((a, b) => a.at - b.at);
      // Footage with its own captions burned in: many short lines low in the frame.
      const burned = new Set(
        doc.analyses
          .filter((a) => (a.text ?? []).filter((x) => x.y > 0.45 && x.end - x.start <= 4).length >= 6)
          .map((a) => a.id),
      );
      const scenes = [...new Set(hits.map((h) => h.scene))];
      const onBurned = scenes.some((id) => burned.has(tl.byId.get(id)?.scene.source ?? ""));
      const first = hits[0]!;
      // A height for the captions that clears every word they'd cover, inside the platform's safe area.
      const area = clearArea(R);
      const clear = [0.7, 0.64, 0.58, 0.3, 0.24, 0.18].find(
        (y) => y >= area.top + 0.06 && y <= area.bottom - 0.06 && !underCaptions(y).length,
      );
      const captionHits = hits.some((h) => h.by === "Captions");
      return {
        status: "warn",
        detail: `${first.by} cover${first.by === "Captions" ? "" : "s"} "${first.text}" in the footage at ${formatTime(first.at, true)}${hits.length > 1 ? ` (and ${hits.length - 1} more)` : ""}.${onBurned ? " The footage already has captions burned in: keep yours off it, or hide one set." : ""}`,
        scenes,
        ...(captionHits &&
          clear !== undefined && {
            fix: {
              label: "Move captions clear",
              ops: [{ op: "merge" as const, key: "captionStyle" as const, patch: { y: clear } }],
            },
          }),
      };
    },
  },
  {
    id: "clear-face",
    title: "Shots start and end on a clear face",
    run(doc, tl) {
      const weak: { scene: string; at: number; where: "starts" | "ends" }[] = [];
      for (const p of tl.scenes) {
        const quality = (doc.analyses.find((a) => a.id === p.scene.source)?.quality ?? []).filter(
          (q) => q.face !== undefined,
        );
        if (quality.length < 3) continue;
        const faces = quality.map((q) => q.face!).sort((a, b) => a - b);
        const usual = faces[Math.floor(faces.length / 2)]!;
        const at = (t: number) => {
          const near = quality.reduce((best, q) => (Math.abs(q.t - t) < Math.abs(best.t - t) ? q : best));
          return Math.abs(near.t - t) <= 0.5 && near.face! < usual * 0.6;
        };
        if (at(p.scene.in)) weak.push({ scene: p.scene.id, at: p.start, where: "starts" });
        if (at(p.scene.out)) weak.push({ scene: p.scene.id, at: p.start + p.duration, where: "ends" });
      }
      if (!weak.length) return pass;
      return {
        status: "warn",
        detail: `${weak
          .slice(0, 4)
          .map((w) => `${w.scene} ${w.where} at ${formatTime(w.at, true)}`)
          .join(
            ", ",
          )}${weak.length > 4 ? ` and ${weak.length - 4} more` : ""} on a weak face (eyes closed, blurred or turned away): move the cut a little, without clipping a word.`,
        scenes: [...new Set(weak.map((w) => w.scene))],
      };
    },
  },
  {
    id: "captions",
    title: "Speech is captioned",
    run(doc) {
      if (doc.captionStyle.speech || !spokenWords(doc).length) return pass;
      return {
        status: "warn",
        detail: "People talk but captions are off. Most viewers watch muted.",
        fix: {
          label: "Turn on captions",
          ops: [{ op: "merge", key: "captionStyle", patch: { speech: true } }],
        },
      };
    },
  },
  {
    id: "dead-air",
    title: "No dead air",
    run(doc, tl) {
      const words = spokenWords(doc);
      if (words.length < 5) return pass;
      const gaps: string[] = [];
      for (let i = 1; i < words.length; i++) {
        const a = words[i - 1]!;
        const b = words[i]!;
        if (a.scene === b.scene && b.start - a.end > R.deadAir) gaps.push(formatTime(a.end));
      }
      const head = words[0]!.start;
      if (head > R.deadAir + 0.3 && speechSources(doc).has(tl.scenes[0]?.scene.source ?? ""))
        gaps.unshift("the start");
      if (!gaps.length) return pass;
      return {
        status: "warn",
        detail: `Long pauses at ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""}.`,
      };
    },
  },
  {
    id: "sound-clutter",
    title: "Sound effects breathe",
    run(doc, tl) {
      // Every hit: placed sound effects, and the entry sound of each graphic or cutaway.
      interface Hit {
        readonly t: number;
        readonly name: string;
        readonly kind: "sfx" | "entry";
        readonly id: string;
        readonly volume: number;
      }
      const hits: Hit[] = [];
      for (const s of doc.sfx) {
        const t = resolveAnchor(tl, s.anchor);
        if (t !== null)
          hits.push({
            t,
            name: s.name ?? s.source ?? "clip",
            kind: "sfx",
            id: s.id,
            volume: s.volume ?? 0.6,
          });
      }
      if (doc.mix.entrySounds)
        for (const v of doc.visuals) {
          if (v.sfx === "none") continue;
          const t = resolveAnchor(tl, v.anchor);
          const name =
            v.sfx ?? (v.content.kind === "cutaway" ? "swipe" : v.layout === "overlay" ? "pop" : "whoosh");
          if (t !== null) hits.push({ t, name, kind: "entry", id: v.id, volume: v.sfxVolume ?? 0.7 });
        }
      if (hits.length < 2) return pass;
      // Keep the strongest hits (placed ones over automatic entry sounds, louder first), each at least
      // sfxGap from the others, and no sound more than sfxRepeat times.
      const ranked = [...hits].sort(
        (a, b) => Number(a.kind === "entry") - Number(b.kind === "entry") || b.volume - a.volume || a.t - b.t,
      );
      const kept: Hit[] = [];
      const uses = new Map<string, number>();
      for (const h of ranked) {
        const crowded = kept.some((k) => Math.abs(k.t - h.t) < R.sfxGap);
        const worn = (uses.get(h.name) ?? 0) >= R.sfxRepeat;
        if (crowded || worn) continue;
        kept.push(h);
        uses.set(h.name, (uses.get(h.name) ?? 0) + 1);
      }
      const cut = hits.filter((h) => !kept.includes(h)).sort((a, b) => a.t - b.t);
      if (!cut.length) return pass;
      const ops: Op[] = cut.map((h) =>
        h.kind === "sfx"
          ? { op: "remove" as const, coll: "sfx" as const, id: h.id }
          : { op: "update" as const, coll: "visuals" as const, id: h.id, patch: { sfx: "none" } },
      );
      return {
        status: "warn",
        detail: `${cut.length} sound ${cut.length === 1 ? "effect crowds" : "effects crowd"} the others (at ${cut
          .slice(0, 4)
          .map((h) => formatTime(h.t))
          .join(", ")}${cut.length > 4 ? "..." : ""}): fewer, well-spaced hits sound designed.`,
        fix: { label: `Remove ${cut.length} crowded sound ${cut.length === 1 ? "effect" : "effects"}`, ops },
      };
    },
  },
  {
    id: "headroom",
    title: "Speaker framed high enough",
    run(doc, tl) {
      // Only where the clip fills the frame by its height, so the face sits where it was shot.
      const W = doc.meta.format.width;
      const H = doc.meta.format.height;
      const low = tl.scenes.filter((p) => {
        const src = doc.sources.find((s) => s.id === p.scene.source);
        const face = doc.analyses.find((a) => a.id === p.scene.source)?.face;
        if (!src?.width || !src.height || !face || p.scene.framing) return false;
        return H / src.height >= W / src.width - 1e-6 && face.y > R.faceHeight + 0.08;
      });
      if (!low.length) return pass;
      const ops = low.map((p) => {
        const face = doc.analyses.find((a) => a.id === p.scene.source)!.face!;
        // Push in and crop from the top until the face sits at faceHeight (or the zoom limit).
        const s = Math.min(R.maxReframe, Math.max(1.05, (1 - R.faceHeight) / (1 - face.y)));
        const x = Math.min(1, Math.max(0, (0.5 - face.x * s) / (1 - s)));
        return {
          op: "update" as const,
          coll: "scenes" as const,
          id: p.scene.id,
          patch: { framing: { x: round(x), y: 1, scale: round(s) } },
        };
      });
      return {
        status: "warn",
        detail: `Lots of empty space above the speaker in ${low.length} ${low.length === 1 ? "shot" : "shots"}: the face sits low.`,
        scenes: low.map((p) => p.scene.id),
        fix: { label: "Reframe tighter", ops },
      };
    },
  },
  {
    id: "complete-thoughts",
    title: "Cuts end on a complete thought",
    run(doc, tl) {
      // A shot that ends on "and", "so", "the"... (and isn't simply followed by the rest of the take)
      // sounds cut off however clean the cut.
      const dangling = tl.scenes.filter((p, i) => {
        const next = tl.scenes[i + 1]?.scene;
        const sc = p.scene;
        if (!next || (next.source === sc.source && Math.abs(next.in - sc.out) < 0.06)) return false;
        const words = doc.transcripts.find((t) => t.id === sc.source)?.words ?? [];
        const last = words.findLast((w) => (w.start + w.end) / 2 < sc.out && (w.start + w.end) / 2 > sc.in);
        return !!last && DANGLING_WORDS.has(last.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""));
      });
      if (!dangling.length) return pass;
      return {
        status: "warn",
        detail: `${dangling.length} ${dangling.length === 1 ? "shot ends" : "shots end"} mid-thought, on a word like "and" (${dangling
          .slice(0, 5)
          .map((p) => formatTime(p.start + p.duration, true))
          .join(", ")}). End on the word before, where the phrase completes.`,
        scenes: dangling.map((p) => p.scene.id),
      };
    },
  },
  {
    id: "colour-cast",
    title: "Colour looks natural",
    run(doc, tl) {
      // Footage with a strong measured cast, not corrected by the shot's white balance.
      const warmGrade = ["warm", "kodak-warm", "film"].includes(doc.look.grade);
      const cast = tl.scenes.filter((p) => {
        const pic = doc.analyses.find((a) => a.id === p.scene.source)?.picture;
        if (!pic) return false;
        return (
          Math.abs(pic.warmth) > R.maxCast &&
          !castCorrected(pic.warmth, p.scene.adjust?.warmth, R.castCorrection)
        );
      });
      if (!cast.length) return pass;
      const sources = [...new Set(cast.map((p) => p.scene.source))];
      const warm = cast.some(
        (p) => (doc.analyses.find((a) => a.id === p.scene.source)?.picture?.warmth ?? 0) > 0,
      );
      const ops: Op[] = cast.map((p) => {
        const w = doc.analyses.find((a) => a.id === p.scene.source)!.picture!.warmth;
        const correction = castCorrection(w, R.castCorrection);
        return {
          op: "update" as const,
          coll: "scenes" as const,
          id: p.scene.id,
          patch: {
            adjust: {
              brightness: 1,
              contrast: 1,
              saturation: 1,
              tint: 0,
              blur: 0,
              ...p.scene.adjust,
              warmth: round(correction),
            },
          },
        };
      });
      if (warm && warmGrade) ops.push({ op: "merge", key: "look", patch: { grade: "clean" } });
      return {
        status: "warn",
        detail: `${sources.map((s) => doc.sources.find((x) => x.id === s)?.label ?? s).join(", ")} ${warm ? "looks orange" : "looks blue"}${warm && warmGrade ? `, and the ${doc.look.grade} grade adds to it` : ""}.`,
        scenes: cast.map((p) => p.scene.id),
        fix: { label: "Balance the colour", ops },
      };
    },
  },
  {
    id: "shot-length",
    title: "Shot lengths",
    run(doc, tl) {
      // Someone talking can hold a shot as long as the sentence needs.
      const speech = speechSources(doc);
      const long = tl.scenes.filter((s) => s.duration > R.maxShot + 1e-6 && !speech.has(s.scene.source));
      const short = tl.scenes.filter((s) => s.duration < R.minShot - 1e-6);
      if (!long.length && !short.length) return pass;
      const parts = [
        long.length && `${long.map((s) => s.scene.id).join(", ")} run long`,
        short.length && `${short.map((s) => s.scene.id).join(", ")} flash by`,
      ].filter(Boolean);
      return {
        status: "warn",
        detail: `${parts.join("; ")}.`,
        scenes: [...long, ...short].map((s) => s.scene.id),
        ...(long.length && {
          fix: {
            label: `Trim to ${R.maxShot}s`,
            ops: long
              .filter((s) => !s.scene.ramp?.length)
              .map((s) => ({
                op: "update" as const,
                coll: "scenes" as const,
                id: s.scene.id,
                patch: { out: round(s.scene.in + R.maxShot * (s.scene.speed ?? 1)) },
              })),
          },
        }),
      };
    },
  },
  {
    id: "repeats",
    title: "No similar shots back to back",
    run(doc, tl) {
      // Jump cuts inside one talking take are the style, not a mistake.
      const speech = speechSources(doc);
      const repeats = tl.scenes.slice(1).filter((s, i) => {
        const prev = tl.scenes[i]!.scene;
        return (
          prev.source === s.scene.source &&
          !speech.has(s.scene.source) &&
          Math.abs(prev.out - s.scene.in) < 0.5
        );
      });
      if (!repeats.length) return pass;
      return {
        status: "warn",
        detail: `${repeats.map((s) => s.scene.id).join(", ")} continue the shot before them, so the cut feels like a jump.`,
        scenes: repeats.map((s) => s.scene.id),
      };
    },
  },
  {
    id: "pace",
    title: "Something changes every few seconds",
    run(doc, tl) {
      if (tl.duration < 10) return pass;
      // Moments where the picture changes: a cut to another clip, a jump cut (it reframes), a zoom,
      // a visual, an effect. Long stretches without one feel static on a phone.
      const moments = new Set<number>([0, tl.duration]);
      for (const p of tl.scenes) moments.add(p.start);
      for (const coll of ["zooms", "visuals", "effects"] as const)
        for (const item of doc[coll]) {
          const t = resolveAnchor(tl, item.anchor);
          if (t !== null) moments.add(t);
        }
      const sorted = [...moments].sort((a, b) => a - b);
      const gaps: string[] = [];
      for (let i = 1; i < sorted.length; i++)
        if (sorted[i]! - sorted[i - 1]! > R.pace)
          gaps.push(`${formatTime(sorted[i - 1]!)}-${formatTime(sorted[i]!)}`);
      if (!gaps.length) return pass;
      return {
        status: "warn",
        detail: `Nothing changes on screen for over 8s at ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""}.`,
      };
    },
  },
  {
    id: "visuals",
    title: "Visuals have what they need",
    run(doc) {
      const graphics = new Set(doc.graphics.map((g) => g.id));
      const sources = new Set(doc.sources.map((s) => s.id));
      const broken = doc.visuals.filter((v) =>
        v.content.kind === "graphic" ? !graphics.has(v.content.graphic) : !sources.has(v.content.source),
      );
      const bad = doc.graphics.flatMap((g) => {
        const problem = validateGraphic(g.html);
        return problem ? [`${g.id}.html: ${problem}`] : [];
      });
      if (!broken.length && !bad.length) return pass;
      return {
        status: "fail",
        detail: [
          broken.length && `${broken.map((v) => v.id).join(", ")} use a graphic or clip that doesn't exist`,
          ...bad,
        ]
          .filter(Boolean)
          .join("; "),
        ...(broken.length > 0 &&
          !bad.length && {
            fix: {
              label: "Remove broken visuals",
              ops: broken.map((v) => ({ op: "remove" as const, coll: "visuals" as const, id: v.id })),
            },
          }),
      };
    },
  },
  {
    id: "orphans",
    title: "Everything is pinned to a shot",
    run(doc, tl) {
      const lists = [
        ["zooms", doc.zooms],
        ["captions", doc.captions],
        ["titles", doc.titles],
        ["visuals", doc.visuals],
        ["effects", doc.effects],
        ["sfx", doc.sfx],
        ["musicCues", doc.musicCues],
        ["musicClips", doc.musicClips],
        ["voiceovers", doc.voiceovers],
      ] as const;
      const ops: Op[] = [];
      for (const [coll, items] of lists)
        for (const item of items)
          if (resolveAnchor(tl, item.anchor) === null) ops.push({ op: "remove", coll, id: item.id });
      // A voiceover whose recording was removed from the project says nothing.
      for (const v of doc.voiceovers)
        if (!doc.sources.some((src) => src.id === v.source) && !ops.some((o) => "id" in o && o.id === v.id))
          ops.push({ op: "remove", coll: "voiceovers", id: v.id });
      const missing = doc.scenes.filter((s) => !doc.sources.some((src) => src.id === s.source));
      if (!ops.length && !missing.length) return pass;
      return {
        status: missing.length ? "fail" : "warn",
        detail: missing.length
          ? `${missing.map((s) => s.id).join(", ")} use a clip that is missing.`
          : `${ops.length} item${ops.length > 1 ? "s are" : " is"} pinned to a shot that was cut.`,
        ...(ops.length && !missing.length && { fix: { label: "Remove leftovers", ops } }),
      };
    },
  },
];

/** Re-times every shot so each cut lands on the nearest beat, never running past the end of its clip. */
/** Beat times of the music, in output time. Empty without a track or its beat analysis. */
export function musicBeats(doc: ProjectDoc): number[] {
  const id = doc.music.source;
  if (!id) return [];
  const beats = doc.analyses.find((a) => a.id === id)?.beats ?? [];
  return beats.map((b) => b - doc.music.offset).filter((b) => b >= 0);
}

const speechSources = (doc: ProjectDoc) => new Set(doc.sources.filter((s) => s.speech).map((s) => s.id));

function nearest(sorted: readonly number[], t: number): { time: number; distance: number } {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [sorted[lo - 1], sorted[lo]].filter((x): x is number => x !== undefined);
  const best = candidates.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), candidates[0] ?? t);
  return { time: best, distance: Math.abs(best - t) };
}

/** Re-times non-speech shots so each cut lands on the nearest beat, never past the end of its clip. */
function snapToBeat(doc: ProjectDoc, tl: Timeline, beats: readonly number[]): Op[] {
  const speech = speechSources(doc);
  const ops: Op[] = [];
  let t = 0;
  for (const s of tl.scenes) {
    if (speech.has(s.scene.source)) {
      t += s.duration;
      continue;
    }
    const src = doc.sources.find((x) => x.id === s.scene.source);
    const room = src && src.kind !== "solid" && src.kind !== "image" ? src.duration - s.scene.in : Infinity;
    const target = nearest(beats, t + s.duration).time;
    const duration = Math.min(room, Math.max(R.minShot, target - t));
    if (Math.abs(duration - s.duration) > 0.001 && !s.scene.ramp?.length)
      ops.push({
        op: "update",
        coll: "scenes",
        id: s.scene.id,
        patch: { out: round(s.scene.in + duration * (s.scene.speed ?? 1)) },
      });
    t += duration;
  }
  return ops;
}

export const CHECK_IDS = rules.map((r) => r.id);

/** Runs every check. Pure and fast (well under a millisecond for a typical short). */
type Area = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

const overlaps = (a: Area, b: Area) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where a title's text sits in the frame, near enough: from its position, size, width and alignment. */
function titleBox(title: ProjectDoc["titles"][number], height: number): Area {
  const w = title.width ?? 0.84;
  const x =
    title.align === "center"
      ? title.position.x - w / 2
      : title.align === "right"
        ? title.position.x - w
        : title.position.x;
  return { x, y: title.position.y, w, h: (title.size / height) * 2.4 };
}

/**
 * The words seen in the footage (the clips' on-screen text, see.ts) as they land in the video: when, in
 * output time, and where in the frame (cropped to the shot's framing; words cropped away don't count).
 */
function wordsInFrame(doc: ProjectDoc, tl: Timeline) {
  const out: { scene: string; from: number; to: number; text: string; box: Area }[] = [];
  for (const p of tl.scenes) {
    if (p.scene.ramp?.length) continue;
    const text = doc.analyses.find((a) => a.id === p.scene.source)?.text ?? [];
    if (!text.length) continue;
    const win = frameWindow(doc, p.scene);
    if (!win) continue;
    const speed = p.scene.speed ?? 1;
    for (const r of text) {
      if (r.end <= p.scene.in || r.start >= p.scene.out) continue;
      const box = toFrame(win, r);
      if (!box) continue;
      out.push({
        scene: p.scene.id,
        from: p.start + (Math.max(r.start, p.scene.in) - p.scene.in) / speed,
        to: p.start + (Math.min(r.end, p.scene.out) - p.scene.in) / speed,
        text: r.text,
        box,
      });
    }
  }
  return out;
}

export function runChecks(doc: ProjectDoc): CheckResult[] {
  const tl = timelineOf(doc);
  if (!tl.scenes.length) return [];
  R = doc.checkRules;
  const off = new Set(R.off);
  return rules.filter((r) => !off.has(r.id)).map((r) => ({ id: r.id, title: r.title, ...r.run(doc, tl) }));
}

export function checksSummary(results: readonly CheckResult[]): { passed: number; total: number } {
  return { passed: results.filter((r) => r.status === "pass").length, total: results.length };
}
