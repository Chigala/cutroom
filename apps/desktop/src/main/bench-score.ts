/**
 * How good an edit is, as numbers that can be compared run to run: the quality checks, the measured
 * motion (sense.ts), and what the edit is made of. The score is a rough single number for spotting
 * regressions; the parts are what to read.
 */

import type { MotionReport } from "@vedit/agent";
import { runChecks } from "@vedit/checks";
import { type Design, lintGraphic, type ProjectDoc, STARTER_GRAPHICS, timelineOf } from "@vedit/project";

export interface EditScore {
  /** 0..100: 40 for the checks passing, 40 for clean motion, 20 for the basics of a finished short. */
  readonly score: number;
  readonly checks: { readonly passed: number; readonly total: number; readonly failing: readonly string[] };
  readonly motion: {
    readonly issues: number;
    readonly byKind: Readonly<Record<string, number>>;
    readonly entries: number;
    readonly onBeat: number | null;
    readonly faceCovered: number;
  } | null;
  readonly edit: {
    readonly duration: number;
    readonly shots: number;
    readonly visuals: number;
    readonly graphicKinds: number;
    readonly titles: number;
    readonly zooms: number;
    readonly sfx: number;
    readonly music: boolean;
    readonly cover: boolean;
  };
  /** The graphics it placed: craft notes on them (graphic-lint), and how many are starters used as they are. */
  readonly craft: { readonly notes: number; readonly starters: number };
  /** The video's design, to compare across cases: every video should look like itself. */
  readonly design: Design | null;
}

/** How much each kind of motion issue costs the score. */
const WEIGHT: Record<string, number> = {
  face: 2,
  flicker: 2,
  "cut-off": 1.5,
  pop: 1,
  stop: 1,
  stutter: 1,
  "safe-zone": 1,
  "off-beat": 0.5,
};

export function scoreEdit(doc: ProjectDoc, motion: MotionReport | null): EditScore {
  const checks = runChecks(doc);
  const relevant = checks;
  const passed = relevant.filter((c) => c.status === "pass").length;
  const byKind: Record<string, number> = {};
  for (const i of motion?.issues ?? []) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  const cost = Object.entries(byKind).reduce((s, [k, n]) => s + (WEIGHT[k] ?? 1) * n, 0);
  const checkShare = relevant.length ? passed / relevant.length : 1;
  // Clean motion only counts when something moves: an edit with no graphics gets half.
  const motionShare = !motion ? checkShare : motion.metrics.entries ? Math.max(0, 1 - cost / 12) : 0.5;
  // What a finished short has: a hook, captions, graphics at a pace, more than a shot or two, music, a cover.
  const duration = timelineOf(doc).duration;
  const basics = [
    doc.titles.some((t) => t.role === "hook") ||
      doc.visuals.some((v) => v.anchor.at < 1.5 && doc.scenes[0]?.id === v.anchor.scene),
    doc.captionStyle.speech,
    doc.visuals.length >= Math.max(1, Math.floor(duration / 10)),
    doc.scenes.length >= Math.max(3, Math.floor(duration / 6)),
    !!doc.music.source,
    !!doc.cover.text.trim(),
  ];
  const basicShare = basics.filter(Boolean).length / basics.length;
  const used = new Set(doc.visuals.flatMap((v) => (v.content.kind === "graphic" ? [v.content.graphic] : [])));
  const placed = doc.graphics.filter((g) => used.has(g.id));
  return {
    score: Math.round(40 * checkShare + 40 * motionShare + 20 * basicShare),
    checks: {
      passed,
      total: relevant.length,
      failing: relevant.filter((c) => c.status !== "pass").map((c) => c.id),
    },
    motion: motion && {
      issues: motion.issues.length,
      byKind,
      entries: motion.metrics.entries,
      onBeat: motion.metrics.onBeat,
      faceCovered: motion.metrics.faceCovered,
    },
    edit: {
      duration: Math.round(timelineOf(doc).duration * 10) / 10,
      shots: doc.scenes.length,
      visuals: doc.visuals.length,
      graphicKinds: new Set(
        doc.visuals.flatMap((v) => (v.content.kind === "graphic" ? [v.content.graphic] : [])),
      ).size,
      titles: doc.titles.length,
      zooms: doc.zooms.length,
      sfx: doc.sfx.length,
      music: !!doc.music.source,
      cover: !!doc.cover.text.trim(),
    },
    craft: {
      notes: placed.reduce((n, g) => n + lintGraphic(g.html).length, 0),
      starters: placed.filter((g) => STARTER_GRAPHICS.some((s) => s.html === g.html)).length,
    },
    design: doc.design.idea || doc.design.display ? doc.design : null,
  };
}
