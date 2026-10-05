/**
 * Export: the folder becomes an MP4. Four stages, each cancellable and reporting progress:
 *
 * 1. Masters: full-HD SDR copies of the clips the cut uses (cached, so re-exports skip this).
 * 2. Voice: every kept stretch of dialogue cut straight from the masters, cleaned and levelled.
 * 3. Picture: Remotion renders the composition (clips muted; music and effects included, already ducked).
 * 4. Mix: voice under picture, limited, written to exports/.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import {
  type HeadlessBrowser,
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import type { CompositionProps, CoverProps } from "@vedit/composition";
import {
  addRoomTone,
  buildVoiceTrack,
  CancelledError,
  cleanVoice,
  derivationInput,
  derivedPaths,
  makeCutout,
  makeMaster,
  masterVoice,
  muxFinal,
  renderableAsIs,
  resolveDerived,
  sfxFile,
  type VoiceSegment,
  voiceMatchEq,
  voiceProfile,
} from "@vedit/media";
import {
  audioPlan,
  CACHE_DIR,
  cutoutCovering,
  EXPORTS_DIR,
  FONTS_DIR,
  type ProjectDoc,
  SFX_NAMES,
  type SfxName,
  type Shape,
  type Source,
  scenesNeedingCutout,
  shapeOf,
  shapeSize,
  sourceTime,
  timelineOf,
} from "@vedit/project";
import { readyBrowser, remotionBinaries } from "./binaries.ts";
import { startMediaServer } from "./server.ts";

export interface ExportProgress {
  readonly stage: "masters" | "voice" | "picture" | "mix" | "done";
  readonly label: string;
  /** Overall, 0..1. */
  readonly fraction: number;
}

export interface ExportOptions {
  readonly doc: ProjectDoc;
  readonly projectDir: string;
  /** Remotion entry point (dev) or an already bundled site directory (packaged app). */
  readonly entry:
    | { readonly kind: "source"; readonly path: string; readonly outDir: string }
    | { readonly kind: "bundle"; readonly dir: string };
  /** App-level cache for synthesized sound effects and the headless browser. */
  readonly cacheDir: string;
  /** Where the voice cleaner installs on first use; without it the voice isn't neurally cleaned. */
  readonly cleanerDir?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: ExportProgress) => void;
}

let bundling: Promise<string> | null = null;

/** Bundles the Remotion entry once per process (webpack takes a few seconds). */
export function serveUrl(entry: ExportOptions["entry"]): Promise<string> {
  if (entry.kind === "bundle") return Promise.resolve(entry.dir);
  // Webpack only in development: the packaged app renders from its prebuilt bundle and ships no bundler.
  bundling ??= import("@remotion/bundler")
    .then(({ bundle }) => bundle({ entryPoint: entry.path, outDir: entry.outDir, enableCaching: true }))
    .catch((err: unknown) => {
      bundling = null;
      throw err;
    });
  return bundling;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "video";
/** Local time, as the person exporting reads it: 20261003-1529. */
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

let tabs: number | null = null;
/**
 * Browser tabs to render with. Measured on an M3 Pro (5 performance + 6 efficiency cores): 4 tabs
 * render 50% faster than 10, because each tab's frames compete with the encoder and efficiency cores
 * slow the whole pipeline. So: the performance cores less one (for the encoder), else half the cores.
 */
function renderTabs(): number {
  if (tabs !== null) return tabs;
  let perf = 0;
  if (process.platform === "darwin")
    try {
      perf = Number(execFileSync("sysctl", ["-n", "hw.perflevel0.physicalcpu"]).toString().trim()) || 0;
    } catch {}
  tabs = Math.min(8, Math.max(2, perf ? perf - 1 : Math.floor(cpus().length / 2)));
  return tabs;
}

export async function exportVideo(o: ExportOptions): Promise<string> {
  const { doc, projectDir, signal } = o;
  const tl = timelineOf(doc);
  if (!tl.scenes.length) throw new Error("Nothing to export: the timeline is empty.");
  const { fps } = doc.meta.format;
  const cache = path.join(projectDir, CACHE_DIR);
  const work = path.join(cache, "export");
  await mkdir(work, { recursive: true });
  const sources = new Map(doc.sources.map((s) => [s.id, s]));
  const report = (stage: ExportProgress["stage"], label: string, fraction: number) =>
    o.onProgress?.({ stage, label, fraction: Math.min(1, Math.max(0, fraction)) });
  const check = () => {
    if (signal?.aborted) throw new CancelledError();
  };

  // 1. Masters for the video clips in the cut (shots and cutaways) that can't be rendered as they are.
  // A long recording that is already plain H.264 is used directly: transcoding an hour of an event to
  // use a minute of it would be most of the export.
  const used = [
    ...new Set([
      ...tl.scenes.map((p) => p.scene.source),
      ...doc.visuals.flatMap((v) => (v.content.kind !== "graphic" ? [v.content.source] : [])),
    ]),
  ]
    .map((id) => sources.get(id))
    .filter((s): s is Source => s?.kind === "video" && Boolean(s.path));
  const asIs = new Set(
    (
      await Promise.all(used.map(async (s) => (!s.hdr && (await renderableAsIs(s.path!)) ? s.id : null)))
    ).filter((id): id is string => id !== null),
  );
  const master = (s: Source) => path.join(cache, "master", `${s.id}.mov`);
  const masterOf = (s: Source) => (asIs.has(s.id) ? s.path! : master(s));
  const todo = used.filter((s) => !asIs.has(s.id) && !existsSync(master(s)));
  const total = todo.reduce((n, s) => n + s.duration, 0) || 1;
  let done = 0;
  for (const s of todo) {
    check();
    await makeMaster(s.path!, master(s), {
      hdr: s.hdr,
      duration: s.duration,
      ...(signal && { signal }),
      onProgress: (f) => report("masters", `Preparing ${s.label}`, ((done + f * s.duration) / total) * 0.25),
    });
    done += s.duration;
  }
  const base = todo.length ? 0.25 : 0;

  // 2. Dialogue, frame-accurate to the picture: the same rounding the composition uses.
  check();
  report("voice", "Cleaning up the voice", base);
  // The sound plan (J/L cuts, crossfades): each shot's stretch of sound, plus half of each crossfade
  // on either side, overlapping its neighbours by exactly the crossfade.
  const plan = audioPlan(tl, doc.mix.jlFade, doc.mix.cutFade);
  // Each clip's voice EQ'd toward broadcast balance, from its measured profile (mix.voiceMatch).
  const matching = doc.mix.voiceMatch && doc.mix.voiceEnhance;
  const eqOf = (id: string) => {
    const v = matching ? doc.analyses.find((a) => a.id === id)?.voice : undefined;
    const eq = v ? voiceMatchEq(v) : [];
    return eq.length ? { eq: eq.join(",") } : {};
  };
  const frame = (t: number) => Math.round(t * fps) / fps;
  const segments: VoiceSegment[] = plan.map((span) => {
    const p = span.placed;
    const from = frame(span.from - span.fadeIn / 2);
    const duration = frame(span.to + span.fadeOut / 2) - from;
    const crossfade = span.fadeIn;
    const src = sources.get(p.scene.source);
    const start = sourceTime(p, from);
    const speed = p.scene.speed;
    // A ramped shot's own sound is dropped (the music carries a velocity edit).
    if (src?.kind === "video" && src.hasAudio && p.scene.volume > 0 && !p.scene.ramp?.length)
      return {
        file: masterOf(src),
        start,
        duration,
        volume: p.scene.volume,
        speed,
        crossfade,
        ...eqOf(src.id),
      };
    if (src?.kind === "audio" && src.path)
      return { file: src.path, start, duration, volume: p.scene.volume, speed, crossfade, ...eqOf(src.id) };
    return { silence: duration, crossfade };
  });
  const hasVoice = segments.some((s) => "file" in s);
  const rawVoice = path.join(work, "voice.raw.wav");
  const voice = path.join(work, "voice.wav");
  // The voice is made while the picture renders (they share nothing until the mix): its clean-up and
  // mastering cost no time of their own.
  const voiceDone = (async () => {
    if (!hasVoice) return;
    // The project's mix: voice processing, loudness and stereo (audio/mix.json).
    const m = doc.mix;
    await buildVoiceTrack(segments, rawVoice, signal, { stereo: m.stereo });
    // Neural clean-up of room echo and noise (mix.voiceClean). Never fatal: without it, the voice
    // goes on as recorded and the spectral denoiser does what it can.
    const cleaned = path.join(work, "voice.clean.wav");
    let isClean = false;
    if (m.voiceClean !== "off" && o.cleanerDir) {
      isClean = await cleanVoice(rawVoice, cleaned, {
        toolsDir: o.cleanerDir,
        strength: m.voiceClean,
        ...(signal && { signal }),
      }).catch((err: unknown) => {
        if (signal?.aborted) throw err;
        console.warn("[export] voice clean-up skipped:", (err as Error).message);
        return false;
      });
    }
    // Room tone under the whole dialogue (mix.roomTone): cuts and gaps never drop to dead silence. From
    // the track's own pauses, else the main speaker's clip (only when uncleaned: the clip's room is noise
    // the cleaner just took out).
    const spoken = isClean ? cleaned : rawVoice;
    const toned = path.join(work, "voice.room.wav");
    const main = [...plan]
      .map((s) => sources.get(s.placed.scene.source))
      .find((s) => s?.kind === "video" && s.hasAudio && s.path);
    const mainSilences = main && doc.analyses.find((a) => a.id === main.id)?.silences;
    const hasTone = await addRoomTone(spoken, toned, m.roomTone, {
      stereo: m.stereo,
      ...(!isClean &&
        main?.path &&
        mainSilences && { fallback: { file: main.path, silences: mainSilences } }),
      ...(signal && { signal }),
    }).catch((err: unknown) => {
      if (signal?.aborted) throw err;
      console.warn("[export] room tone skipped:", (err as Error).message);
      return false;
    });
    // Closed loop: measure the voice as it now is (cleaning shifts its balance) and correct what's left.
    const track = hasTone ? toned : spoken;
    const residual = matching ? await voiceProfile(track, 150, signal) : null;
    await masterVoice(track, voice, signal, {
      ...(residual && { eq: voiceMatchEq(residual) }),
      enhance: m.voiceEnhance,
      denoise: m.denoise && !isClean,
      tone: m.voiceTone,
      loudness: m.loudness,
      truePeak: m.truePeak,
      stereo: m.stereo,
      matched: matching && doc.analyses.some((a) => a.voice),
    });
  })();
  // A voice that fails stops the render at once (the export can't finish without it).
  let voiceError: unknown = null;
  const renders = new Set<() => void>();
  voiceDone.catch((err: unknown) => {
    voiceError = err;
    for (const stop of renders) stop();
  });

  // 3. Picture, with music and effects.
  check();
  report("picture", "Rendering", base + 0.1);
  // Cutouts the cut uses but the cache lost (it's safe to delete): made again before rendering.
  const tlNow = timelineOf(doc);
  const starts = new Map(
    tlNow.scenes.map((p) => [p.scene.id, { start: p.start, end: p.start + p.duration }]),
  );
  for (const scene of scenesNeedingCutout(doc, starts)) {
    const c = cutoutCovering(
      doc.analyses.find((a) => a.id === scene.source),
      scene.in,
      scene.out,
    );
    const file = c && derivedPaths(projectDir).cutout(scene.source, c.from, c.to);
    const src = sources.get(scene.source);
    if (!c || !file || existsSync(file) || !src) continue;
    report("picture", "Cutting out the person", base + 0.05);
    const input = await derivationInput(projectDir, src);
    if (input) await makeCutout(input, c.from, c.to, file, { ...(signal && { signal }) });
  }
  const server = await startMediaServer(async (key) => {
    // Footage made from a clip: its cutout, or a ramped shot (rendered on first ask).
    if (key.includes("~")) return resolveDerived(projectDir, doc, key, fps);
    if (key.startsWith(`${FONTS_DIR}/`)) {
      const font = doc.fonts.find((f) => `${FONTS_DIR}/${f.file}` === key);
      return font ? path.join(projectDir, FONTS_DIR, font.file) : null;
    }
    if (key.startsWith("sfx/")) {
      const name = key.slice(4) as SfxName;
      return SFX_NAMES.includes(name) ? sfxFile(name, o.cacheDir) : null;
    }
    const src = sources.get(key.replace(/\?.*$/, ""));
    if (!src?.path) return null;
    return src.kind === "video" ? masterOf(src) : src.path;
  });
  // Export settings (export.json): codec, quality, audio, file name, more shapes.
  const xs = doc.exportSettings;
  const ext = xs.codec === "prores" ? "mov" : "mp4";
  const dir = path.join(projectDir, EXPORTS_DIR);
  await mkdir(dir, { recursive: true });
  const name = xs.fileName.trim() ? slug(xs.fileName) : `${slug(doc.meta.name)}-${stamp()}`;
  // The project's own shape, then each other shape asked for: same cut, same sound, reframed.
  const own = shapeOf(doc.meta.format);
  const shapes: (Shape | null)[] = [null, ...[...new Set(xs.formats)].filter((f) => f !== own)];
  const share = (0.9 - (base + 0.1)) / shapes.length;
  const outputs: string[] = [];
  // One browser for every shape and the covers (each render would otherwise start its own).
  let browser: HeadlessBrowser | null = null;
  try {
    await readyBrowser();
    const url = await serveUrl(o.entry);
    browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" } });
    const puppeteerInstance = browser;
    for (const [i, shape] of shapes.entries()) {
      check();
      const at = base + 0.1 + i * share;
      const tag = shape ? ` (${shape})` : "";
      const shaped: ProjectDoc = shape
        ? {
            ...doc,
            meta: { ...doc.meta, format: { ...doc.meta.format, ...shapeSize(doc.meta.format, shape) } },
          }
        : doc;
      const picture = path.join(work, `picture.${ext}`);
      report("picture", `Rendering${tag}`, at);
      const cancel = makeCancelSignal();
      const onAbort = () => cancel.cancel();
      signal?.addEventListener("abort", onAbort, { once: true });
      renders.add(onAbort);
      try {
        const inputProps: CompositionProps = {
          doc: shaped,
          mediaBase: server.base,
          quality: "export",
          muteSources: true,
        };
        const composition = await selectComposition({
          ...remotionBinaries(),
          serveUrl: url,
          id: "Video",
          inputProps,
          puppeteerInstance,
        });
        await renderMedia({
          ...remotionBinaries(),
          composition,
          serveUrl: url,
          codec: xs.codec,
          ...(xs.codec === "prores"
            ? { proResProfile: "hq" as const }
            : { crf: { high: 16, standard: 18, small: 23 }[xs.quality] + (xs.codec === "h265" ? 4 : 0) }),
          puppeteerInstance,
          concurrency: renderTabs(),
          // x264's "veryfast" renders 12% faster than "fast" at the same visually lossless quality (48.6
          // against 49.8 dB PSNR at crf 18); "high" keeps "fast" for the last fraction of a dB.
          ...(xs.codec === "h264" && {
            x264Preset: xs.quality === "high" ? ("fast" as const) : ("veryfast" as const),
          }),
          audioBitrate: "320k",
          outputLocation: picture,
          inputProps,
          cancelSignal: cancel.cancelSignal,
          enforceAudioTrack: true,
          // Scripted graphics may draw with WebGL (three.js).
          chromiumOptions: { gl: "angle" },
          onProgress: ({ progress }) => report("picture", `Rendering${tag}`, at + progress * share * 0.9),
        });
      } catch (err) {
        if (voiceError) throw voiceError;
        if (signal?.aborted) throw new CancelledError();
        throw err;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        renders.delete(onAbort);
      }
      // 4. Mix: the voice under this shape's picture.
      check();
      await voiceDone;
      const output = path.join(dir, `${name}${shape ? `-${shape.replace(":", "x")}` : ""}.${ext}`);
      await muxFinal(
        { picture, voice: hasVoice ? voice : null, output, duration: tl.duration },
        {
          ...(signal && { signal }),
          onProgress: (f) => report("mix", `Mixing${tag}`, at + share * (0.9 + f * 0.1)),
          audioBitrate: xs.audioBitrate,
          truePeak: doc.mix.truePeak,
          stereo: doc.mix.stereo,
        },
      );
      await rm(picture, { force: true });
      outputs.push(output);
      // The cover, in this shape too (cover.json), as a PNG beside the video.
      if (xs.cover) {
        report("mix", `Saving the cover${tag}`, at + share * 0.99);
        const props: CoverProps = { doc: shaped, mediaBase: server.base };
        const cover = await selectComposition({
          serveUrl: url,
          id: "Cover",
          inputProps: props,
          puppeteerInstance,
        });
        await renderStill({
          ...remotionBinaries(),
          puppeteerInstance,
          composition: cover,
          serveUrl: url,
          inputProps: props,
          frame: 0,
          imageFormat: "png",
          output: path.join(dir, `${name}-cover${shape ? `-${shape.replace(":", "x")}` : ""}.png`),
          chromiumOptions: { gl: "angle" },
        }).catch((err: unknown) => console.warn("[export] cover skipped:", (err as Error).message));
      }
    }
  } finally {
    await (browser as HeadlessBrowser | null)?.close({ silent: true }).catch(() => {});
    await server.close();
  }
  const output = outputs[0]!;
  // Credits: the music, and every stock clip and captured page the cut uses.
  const inCut = new Set([
    ...doc.scenes.map((s) => s.source),
    ...doc.sfx.flatMap((s) => (s.source ? [s.source] : [])),
    ...doc.musicClips.map((m) => m.source),
    ...doc.visuals.flatMap((v) => (v.content.kind !== "graphic" ? [v.content.source] : [])),
  ]);
  const credits = [
    ...(doc.music.source && doc.music.credit ? [`Music: ${doc.music.credit}`] : []),
    ...doc.sources
      .filter((s) => s.origin && inCut.has(s.id))
      .map((s) =>
        s.origin!.provider === "web"
          ? `Screenshot: ${s.label} (${s.origin!.url})`
          : s.origin!.provider === "klipy"
            ? `Meme: ${s.label}, via KLIPY (${s.origin!.url})`
            : s.kind === "audio"
              ? `Sound: ${s.summary || s.label}${s.origin!.author ? ` by ${s.origin!.author}` : ""}, ${s.origin!.license || s.origin!.provider} (${s.origin!.url})`
              : `Footage: ${s.label}${s.origin!.author ? ` by ${s.origin!.author}` : ""}, ${s.origin!.provider} (${s.origin!.url})`,
      ),
  ];
  if (credits.length) await writeFile(path.join(dir, "credits.txt"), `${credits.join("\n")}\n`);
  await Promise.all([rawVoice, voice, path.join(work, "voice.clean.wav")].map((f) => rm(f, { force: true })));
  report("done", outputs.length > 1 ? `Exported ${outputs.length} shapes` : "Exported", 1);
  return output;
}
