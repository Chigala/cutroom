/**
 * Motion quality, measured on the rendered picture rather than guessed from the files. The video is
 * rendered twice, small: once its graphics and titles alone on transparency, once its footage alone.
 * Faces are tracked in the footage; the graphics' coverage is read frame by frame. From those:
 *
 *   flicker     something shows for a frame and is gone (or the reverse): a glitch, not a move
 *   pop         a graphic appears or vanishes in one frame with nothing moving around it (off a cut)
 *   stop        motion that runs at speed and stops dead, with no ease into its rest
 *   stutter     motion that stalls for a frame partway and carries on
 *   cut-off     a graphic that sits against the frame's edge, clipped, for half a second or more
 *   face        a graphic over the speaker's face
 *   safe-zone   a graphic under the platform's buttons and caption bar
 *   off-beat    a graphic that starts moving off the music's beat
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import type { CompositionProps } from "@vedit/composition";
import { findBinary, trackRange } from "@vedit/media";
import { musicBeats, type ProjectDoc, resolveAnchor, timelineOf } from "@vedit/project";
import { chromiumOptions, remotionBinaries } from "./binaries.ts";
import { type ExportOptions, serveUrl } from "./export.ts";
import { startMediaServer } from "./server.ts";

export type MotionIssueKind =
  | "flicker"
  | "pop"
  | "stop"
  | "stutter"
  | "cut-off"
  | "face"
  | "safe-zone"
  | "off-beat";

export interface MotionIssue {
  readonly kind: MotionIssueKind;
  /** Output seconds. */
  readonly start: number;
  readonly end: number;
  /** What's on screen then (visual and title ids). */
  readonly items: readonly string[];
  readonly detail: string;
}

export interface MotionReport {
  readonly issues: readonly MotionIssue[];
  readonly metrics: {
    /** Graphic movements that start after stillness. */
    readonly entries: number;
    /** Of those, how many start within two frames of a beat (null without a beat map). */
    readonly onBeat: number | null;
    /** Seconds a graphic covers the face. */
    readonly faceCovered: number;
    /** Seconds with any graphic on screen. */
    readonly graphicSeconds: number;
    /** Faces were tracked (macOS). */
    readonly faces: boolean;
  };
  readonly elapsedMs: number;
}

export interface SenseOptions {
  readonly doc: ProjectDoc;
  readonly entry: ExportOptions["entry"];
  readonly resolve: (key: string) => Promise<string | null>;
  /** Scratch space for the two renders. */
  readonly workDir: string;
  /** The platform's clear area (checks.json platform), fractions of the frame. */
  readonly safeZone?: { readonly top: number; readonly bottom: number; readonly right: number };
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number, label: string) => void;
}

/** The analysis grid: the picture's alpha this many cells across. */
const GRID = 72;

// What was measured before, by what it depends on: a whole report by the edit, faces by the footage.
const reports = new Map<string, MotionReport>();
const facesSeen = new Map<string, Awaited<ReturnType<typeof trackRange>>>();
const remember = <T>(cache: Map<string, T>, key: string, value: T) => {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > 6) cache.delete(cache.keys().next().value!);
};
const hash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex");

export async function senseMotion(o: SenseOptions): Promise<MotionReport> {
  const started = Date.now();
  const { doc } = o;
  const { fps, width, height } = doc.meta.format;
  const tl = timelineOf(doc);
  // Nothing changed since the last measure: the same answer, at once.
  const { transcripts: _t, shotLogs: _s, comments: _c, ...edit } = doc;
  const reportKey = hash([edit, o.safeZone]);
  const known = reports.get(reportKey);
  if (known) return { ...known, elapsedMs: 0 };
  // Only graphics changed: the footage (and so the faces in it) is as it was.
  const footageKey = hash([
    doc.meta.format,
    doc.scenes,
    doc.zooms,
    doc.effects,
    doc.look,
    doc.grades,
    doc.visuals.filter((v) => v.content.kind === "cutaway" || v.layout !== "overlay"),
    doc.analyses.map((a) => [a.id, a.face, a.tracks?.length, a.cutouts]),
    doc.sources.map((x) => [x.id, x.path]),
  ]);
  const seenFaces = facesSeen.get(footageKey);
  await mkdir(o.workDir, { recursive: true });
  const overlay = path.join(o.workDir, "overlay.mov");
  const footage = path.join(o.workDir, "footage.mp4");
  const server = await startMediaServer(o.resolve);
  const cancel = makeCancelSignal();
  const onAbort = () => cancel.cancel();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  // Small renders: a quarter of the size is plenty to see where things are and how they move.
  const scale = Math.max(0.15, Math.min(0.5, 360 / Math.max(width, height)));
  try {
    const url = await serveUrl(o.entry);
    const render = async (layers: "overlay" | "footage", out: string, from: number, share: number) => {
      const inputProps: CompositionProps = {
        doc,
        mediaBase: server.base,
        quality: "preview",
        muteSources: true,
        audio: false,
        layers,
      };
      const composition = await selectComposition({
        serveUrl: url,
        id: "Video",
        inputProps,
        ...remotionBinaries(),
      });
      await renderMedia({
        ...remotionBinaries(),
        composition,
        serveUrl: url,
        inputProps,
        outputLocation: out,
        scale,
        muted: true,
        cancelSignal: cancel.cancelSignal,
        chromiumOptions: chromiumOptions(),
        concurrency: 4,
        ...(layers === "overlay"
          ? {
              codec: "prores" as const,
              proResProfile: "4444" as const,
              imageFormat: "png" as const,
              pixelFormat: "yuva444p10le" as const,
            }
          : { codec: "h264" as const, crf: 28 }),
        onProgress: ({ progress }) =>
          o.onProgress?.(
            from + progress * share,
            layers === "overlay" ? "Rendering the graphics" : "Rendering the footage",
          ),
      });
    };
    await render("overlay", overlay, 0, seenFaces ? 0.85 : 0.45);
    if (!seenFaces) await render("footage", footage, 0.45, 0.35);
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
    await server.close();
  }

  o.onProgress?.(0.82, "Finding faces");
  const faces =
    seenFaces ??
    (await trackRange(footage, 0, tl.duration, {
      rate: 10,
      ...(o.signal && { signal: o.signal }),
    }).catch(() => []));
  remember(facesSeen, footageKey, faces);
  o.onProgress?.(0.9, "Measuring motion");
  const gw = GRID;
  const gh = Math.max(2, Math.round((GRID * height) / width / 2) * 2);
  const frames = await alphaFrames(overlay, gw, gh, o.signal);
  await rm(o.workDir, { recursive: true, force: true });

  // --- Measures --------------------------------------------------------------------------------------
  const n = frames.length;
  const cells = gw * gh;
  const cov = frames.map((f) => f.reduce((a, b) => a + b, 0) / cells);
  const diffs = new Float32Array(n);
  const diff = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= n || b >= n) return 0;
    const x = frames[a]!;
    const y = frames[b]!;
    let s = 0;
    for (let i = 0; i < cells; i++) s += Math.abs(x[i]! - y[i]!);
    return s / cells;
  };
  for (let f = 1; f < n; f++) diffs[f] = diff(f - 1, f);
  const t = (f: number) => Math.round((f / fps) * 100) / 100;
  // Cuts, and camera effects (a whip, a flash) that work as cuts.
  const cuts = new Set([
    ...tl.scenes.map((p) => Math.round(p.start * fps)),
    ...doc.effects.flatMap((e) => {
      const s = resolveAnchor(tl, e.anchor);
      if (s === null) return [];
      const a = Math.round(s * fps);
      return Array.from({ length: Math.round(e.duration * fps) + 1 }, (_, i) => a + i);
    }),
  ]);
  const nearCut = (f: number) => [-1, 0, 1].some((d) => cuts.has(f + d));

  // What's on screen at a frame: visual (graphic) and title ids.
  const placed = [...doc.visuals.filter((v) => v.content.kind === "graphic"), ...doc.titles].flatMap(
    (item) => {
      const s = resolveAnchor(tl, item.anchor);
      return s === null
        ? []
        : [{ id: item.id, from: Math.round(s * fps), to: Math.round((s + item.duration) * fps) }];
    },
  );
  const itemsAt = (a: number, b = a) =>
    placed.filter((p) => p.from <= b + 1 && p.to >= a - 1).map((p) => p.id);

  const raw: { kind: MotionIssueKind; f: number; g?: number; detail: string }[] = [];
  // What counts as a problem: the project's own thresholds (checks.json motion).
  const M = doc.checkRules.motion;
  const STILL = M.still;
  for (let f = 1; f < n - 1; f++) {
    const d1 = diffs[f]!;
    const d2 = diffs[f + 1]!;
    // Flicker: this frame differs from both neighbours, which match each other.
    if (d1 > M.flicker && d2 > M.flicker && diff(f - 1, f + 1) < 0.3 * Math.min(d1, d2))
      raw.push({ kind: "flicker", f, detail: "shows for a single frame (a glitch, not a move)" });
    // Pop: a big change in one frame, still before and after, away from a cut.
    else if (d1 > M.pop && (diffs[f - 1] ?? 0) < STILL && d2 < STILL * 2 && !nearCut(f)) {
      const on = cov[f]! > cov[f - 1]!;
      raw.push({
        kind: "pop",
        f,
        detail: on
          ? "appears in a single frame with no motion in (no ease, no fade)"
          : "vanishes in a single frame, not on a cut",
      });
    }
  }
  // Moves: runs of frames where the graphics change, after stillness.
  const beats = musicBeats(doc, tl.duration).map((b) => Math.round(b * fps));
  let entries = 0;
  let onBeat = 0;
  for (let f = 1; f < n; f++) {
    if (diffs[f]! <= STILL || diffs[f - 1]! > STILL) continue;
    let end = f;
    while (end + 1 < n && diffs[end + 1]! > STILL) end++;
    const run = Array.from(diffs.slice(f, end + 1));
    const peak = Math.max(...run);
    // An entry: something appears where nothing was.
    const appears = cov[f - 1]! < 0.003 && cov[f]! > cov[f - 1]!;
    if (appears) entries++;
    if (appears && beats.length) {
      const off = Math.min(...beats.map((b) => Math.abs(b - f)));
      if (off <= M.onBeat) onBeat++;
      else if (off >= M.offBeat && peak > 0.006 && !nearCut(f))
        raw.push({ kind: "off-beat", f, detail: `starts ${off} frames off the beat` });
    }
    if (run.length >= 4 && peak > 0.005 && !nearCut(end)) {
      // Stops dead: still moving near full speed on its last frame. Gone after it: cut off mid-animation.
      const gone = cov[end]! < 0.003;
      if (run.at(-1)! > M.stop * peak)
        raw.push({
          kind: gone ? "pop" : "stop",
          f: end,
          detail: gone
            ? "vanishes mid-animation, in a single frame (its exit is cut off)"
            : "moves at speed then stops dead, with no ease into its rest",
        });
      // Stutters: a frame partway that nearly stops between two that move.
      for (let i = 1; i < run.length - 1; i++)
        if (
          run[i]! < M.stutter * Math.min(run[i - 1]!, run[i + 1]!) &&
          Math.min(run[i - 1]!, run[i + 1]!) > 0.004
        ) {
          raw.push({ kind: "stutter", f: f + i, detail: "stalls for a frame mid-move" });
          break;
        }
    }
    f = end;
  }
  // Held conditions: clipped at an edge, over the face, in the platform's zones.
  const held = (kind: MotionIssueKind, test: (f: number) => string | null, minFrames: number) => {
    let from = -1;
    let what = "";
    for (let f = 0; f <= n; f++) {
      const hit = f < n ? test(f) : null;
      if (hit && from < 0) {
        from = f;
        what = hit;
      } else if (!hit && from >= 0) {
        if (f - from >= minFrames) raw.push({ kind, f: from, g: f - 1, detail: what });
        from = -1;
      }
    }
  };
  const mean = (a: Float32Array, x0: number, y0: number, x1: number, y1: number) => {
    const xa = Math.max(0, Math.floor(x0 * gw));
    const xb = Math.min(gw, Math.ceil(x1 * gw));
    const ya = Math.max(0, Math.floor(y0 * gh));
    const yb = Math.min(gh, Math.ceil(y1 * gh));
    let s = 0;
    let k = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++, k++) s += a[y * gw + x]!;
    return k ? s / k : 0;
  };
  held(
    "cut-off",
    (f) => {
      if (cov[f]! > 0.5) return null;
      const a = frames[f]!;
      // Solid, uneven content in the outermost cells (letters, a shape running off), not a soft scrim or
      // a bar laid evenly along the edge.
      const clipped = (cells: number[]) => {
        const m = cells.reduce((x, y) => x + y, 0) / cells.length;
        const sd = Math.sqrt(cells.reduce((x, y) => x + (y - m) ** 2, 0) / cells.length);
        return m > 0.08 && Math.max(...cells) > 0.8 && sd > 0.25;
      };
      const col = (x: number) => Array.from({ length: gh }, (_, y) => a[y * gw + x]!);
      const row = Array.from(a.subarray(0, gw));
      const side = clipped(col(0)) ? "left" : clipped(col(gw - 1)) ? "right" : clipped(row) ? "top" : null;
      return side ? `runs off the ${side} edge of the frame, clipped` : null;
    },
    Math.round(fps * M.hold),
  );
  const faceTracks = faces.filter((x) => x.kind === "face");
  let faceFrames = 0;
  held(
    "face",
    (f) => {
      const s = f / fps;
      const box = faceTracks
        .filter((x) => x.start <= s && x.end >= s)
        .map((x) => x.points.reduce((best, p) => (Math.abs(p.t - s) < Math.abs(best.t - s) ? p : best)))
        .sort((a, b) => b.w - a.w)[0];
      if (!box || box.w < 0.06) return null;
      // The face proper: eyes to mouth, not the hair.
      const over = mean(
        frames[f]!,
        box.x - box.w * 0.35,
        box.y - box.h * 0.3,
        box.x + box.w * 0.35,
        box.y + box.h * 0.4,
      );
      if (over < M.face) return null;
      faceFrames++;
      return "covers the speaker's face";
    },
    Math.round((fps * M.hold) / 2),
  );
  const zone = o.safeZone;
  if (zone && (zone.right < 1 || zone.bottom < 1))
    held(
      "safe-zone",
      (f) => {
        const a = frames[f]!;
        const right = zone.right < 1 ? mean(a, zone.right + 0.02, 0.3, 1, zone.bottom) : 0;
        const bottom = zone.bottom < 1 ? mean(a, 0, zone.bottom + 0.03, zone.right, 1) : 0;
        return right > 0.25
          ? "sits under the platform's like and share buttons"
          : bottom > 0.25
            ? "sits under the platform's caption bar"
            : null;
      },
      Math.round(fps * M.hold),
    );

  // Same kind within a third of a second: one issue.
  raw.sort((a, b) => a.f - b.f);
  // Kinds the project turned off (checks.json off: "motion:pop", ...).
  const off = new Set(doc.checkRules.off);
  const issues: MotionIssue[] = [];
  for (const r of raw) {
    if (off.has(`motion:${r.kind}`)) continue;
    const last = issues.at(-1);
    const start = t(r.f);
    const end = t(r.g ?? r.f);
    if (last && last.kind === r.kind && start - last.end < 0.34) {
      issues[issues.length - 1] = { ...last, end: Math.max(last.end, end) };
      continue;
    }
    issues.push({ kind: r.kind, start, end, items: itemsAt(r.f, r.g ?? r.f), detail: r.detail });
  }
  o.onProgress?.(1, "Done");
  const report: MotionReport = {
    issues,
    metrics: {
      entries,
      onBeat: beats.length ? onBeat : null,
      faceCovered: Math.round((faceFrames / fps) * 10) / 10,
      graphicSeconds: Math.round((cov.filter((c) => c > 0.002).length / fps) * 10) / 10,
      faces: faceTracks.length > 0,
    },
    elapsedMs: Date.now() - started,
  };
  remember(reports, reportKey, report);
  return report;
}

/** The alpha of every frame of a video with transparency, `w` x `h`, as 0..1. */
async function alphaFrames(
  file: string,
  w: number,
  h: number,
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  const ffmpeg = await findBinary("ffmpeg");
  const child = spawn(ffmpeg, [
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    `alphaextract,scale=${w}:${h}:flags=area`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "-",
  ]);
  signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
  child.stderr.resume();
  const size = w * h;
  const out: Float32Array[] = [];
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= size) {
      const f = new Float32Array(size);
      for (let i = 0; i < size; i++) f[i] = pending[i]! / 255;
      out.push(f);
      pending = pending.subarray(size);
    }
  }
  return out;
}
