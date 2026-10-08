/**
 * Indexing is the "compile step" for footage. Every imported clip gets, in the background:
 * a preview proxy, its audio measured (silences, loudness, waveform), every word transcribed locally,
 * shot changes detected, and for music, a beat map. Results land in the project as commits by
 * "index" (not undoable), so the agent and the UI see them like any other part of the folder.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultBackend, describeBatch } from "@vedit/agent";
import type { ImportDoneEvent, IndexEvent } from "@vedit/bridge";
import {
  beatMap,
  CancelledError,
  contactSheets,
  cutToSpeech,
  decodes,
  detectFace,
  detectShots,
  detectSilences,
  ensureHear,
  ensureWhisper,
  extractSpeechWav,
  fromSpeechCut,
  hearSounds,
  loudStretches,
  makeProxy,
  measureLoudness,
  needsTranscript,
  pictureProfile,
  type Segment,
  seeClip,
  seeThrough,
  segmentsOf,
  transcribeWords,
  voiceEnvelope,
  voiceProfile,
  waveformPeaks,
  wordStress,
} from "@vedit/media";
import {
  type Analysis,
  alignEndsToVoice,
  alignToOnsets,
  alignToSilences,
  applyOps,
  CACHE_DIR,
  cleanCutOps,
  formatTime,
  moveEdgesWithWords,
  type Op,
  type ProjectDoc,
  retimeWords,
  round,
  type ShotLog,
  ShotSegment,
  type Source,
  soundShape,
  type TimedWord,
  type Transcript,
} from "@vedit/project";
import type { ProjectStore } from "@vedit/project/node";
import { claudeStatus } from "./claude.ts";
import { getSettings, paths, whisperSetup } from "./settings.ts";

/** At most this many vision calls at once, across every clip being indexed. */
class Limit {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((ok) => this.waiting.push(ok));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
const visionCalls = new Limit(6);
/**
 * One-time upgrades of older projects' transcripts (whisper again, for aligned word times): one at a
 * time across the app, and not stopped by switching projects. Their words are saved in the project's
 * cache, so a project left mid-upgrade applies them the moment it opens again instead of starting over.
 * Only quitting stops them.
 */
const upgrades = new Limit(1);
/** Upgrades under way, by the file their words go to: a project reopened mid-upgrade waits for it. */
const upgrading = new Map<string, Promise<TimedWord[]>>();
let upgradesStop = new AbortController();
export function stopUpgrades(): void {
  upgradesStop.abort();
  upgradesStop = new AbortController();
}

export const cachePaths = (dir: string, id: string) => {
  const cache = path.join(dir, CACHE_DIR);
  return {
    proxy: path.join(cache, "proxy", `${id}.mp4`),
    wav: path.join(cache, "audio", `${id}.wav`),
    /** Just where someone talks, for the transcriber (cutToSpeech). */
    speechWav: path.join(cache, "audio", `${id}.speech.wav`),
    peaks: path.join(cache, "peaks", `${id}.bin`),
    master: path.join(cache, "master", `${id}.mov`),
  };
};

interface Deps {
  store(): ProjectStore | null;
  emitIndex(e: IndexEvent): void;
  emitImportDone(e: ImportDoneEvent): void;
}

/** Two clips at a time: proxies are GPU-bound and whisper is CPU-bound, so two overlap well. */
const CONCURRENCY = 2;

/** The word-timing correction transcripts get (bumped when it changes, so old ones are redone). */
const WORD_ALIGNMENT = 4;

export class Indexer {
  private queue: string[] = [];
  private active = new Set<string>();
  /** Each clip's own stop switch, so removing one clip stops just its work. */
  private jobs = new Map<string, AbortController>();
  private controller = new AbortController();
  private batches: { ids: Set<string>; firstImport: boolean; finished: number }[] = [];

  constructor(private readonly deps: Deps) {}

  /** Stops everything (another project was opened). */
  reset(): void {
    this.controller.abort();
    this.controller = new AbortController();
    // Off the window's list: this project's work stops here, and its badges would otherwise stay up.
    for (const id of new Set([...this.queue, ...this.active, ...(this.describing ? [this.describing] : [])]))
      this.deps.emitIndex({ source: id, stage: "ready", fraction: 1, label: "Cancelled" });
    this.describing = null;
    // The run stopping here isn't this project's: asking again starts a new one.
    this.describingMissing = null;
    this.queue = [];
    this.active.clear();
    this.jobs.clear();
    this.batches = [];
  }

  /**
   * Clips that are no longer in the project (removed, or their import undone) stop indexing: dropped
   * from the queue, or stopped mid-way; clips brought back are indexed again. Called after every change
   * to the project.
   */
  prune(doc: { readonly sources: readonly { readonly id: string; readonly status?: string }[] }): void {
    const kept = new Set(doc.sources.map((s) => s.id));
    const gone = [...this.queue, ...this.active].filter((id) => !kept.has(id));
    // A removed clip brought back (undo the removal, redo the import): index it again.
    const back = doc.sources
      .filter((s) => (s.status === "pending" || s.status === "indexing") && !this.queue.includes(s.id))
      .filter((s) => !this.active.has(s.id))
      .map((s) => s.id);
    if (back.length) this.enqueue(back);
    if (!gone.length) return;
    this.queue = this.queue.filter((id) => kept.has(id));
    for (const id of gone) {
      this.jobs.get(id)?.abort();
      this.jobs.delete(id);
      this.active.delete(id);
      // Off the "indexing" list in the window.
      this.deps.emitIndex({ source: id, stage: "ready", fraction: 1, label: "Cancelled" });
    }
    // An import whose clips were all removed before any finished is simply over: no import-done event,
    // so no automatic first cut on clips that aren't there.
    for (const b of this.batches) for (const id of gone) b.ids.delete(id);
    const over = this.batches.filter((b) => b.ids.size === 0);
    this.batches = this.batches.filter((b) => b.ids.size > 0);
    const doc_ = this.deps.store()?.doc;
    for (const b of over)
      if (b.finished > 0)
        this.deps.emitImportDone({
          sources: doc_?.sources.map((s) => s.id) ?? [],
          firstImport: b.firstImport,
        });
    this.pump();
  }

  enqueue(ids: readonly string[], batch?: { firstImport: boolean }): void {
    // Indexing goes first: reading pictures stops, and starts again when indexing is done.
    if (ids.length) this.readStop?.abort();
    for (const id of ids) {
      if (this.queue.includes(id) || this.active.has(id)) continue;
      this.queue.push(id);
      this.deps.emitIndex({ source: id, stage: "queued", fraction: 0, label: "Waiting" });
    }
    if (batch && ids.length)
      this.batches.push({ ids: new Set(ids), firstImport: batch.firstImport, finished: 0 });
    this.pump();
  }

  /** Resumes clips that were mid-index when the app last closed. */
  resume(): void {
    const doc = this.deps.store()?.doc;
    if (!doc) return;
    this.enqueue(
      doc.sources.filter((s) => s.status === "pending" || s.status === "indexing").map((s) => s.id),
    );
    this.track(this.retime(this.controller.signal));
    this.track(this.healProxies(this.controller.signal));
    this.track(this.hearBackfill(this.controller.signal).then(() => this.readPictures()));
    this.track(this.describeMissing());
  }

  /** Work under way (indexing clips, the background passes): what settled() waits for. */
  private inflight = new Set<Promise<unknown>>();

  private track(work: Promise<unknown>): void {
    this.inflight.add(work);
    void work.catch(() => undefined).finally(() => this.inflight.delete(work));
  }

  /** Resolves once what was running has wound down (after reset(), before the folder goes away). */
  settled(): Promise<void> {
    return settle(this.inflight);
  }

  private describingMissing: Promise<void> | null = null;
  /** The clip describeMissing is describing now, for its badge in the window. */
  private describing: string | null = null;
  /**
   * Describes the shots of indexed clips that have none yet: Claude was unreachable when they indexed
   * (no key, signed out, offline). Runs when a project opens, after Claude has answered a request, when
   * the settings change, and when asked; one pass at a time.
   */
  describeMissing(): Promise<void> {
    if (!this.describingMissing) {
      const run = this.describeMissingNow(this.controller.signal).finally(() => {
        if (this.describingMissing === run) this.describingMissing = null;
      });
      this.describingMissing = run;
    }
    return this.describingMissing;
  }

  private async describeMissingNow(signal: AbortSignal): Promise<void> {
    const settings = await getSettings();
    const store = this.deps.store();
    if (!store || !settings.describeShots) return;
    for (const source of store.doc.sources) {
      if (signal.aborted) return;
      const doc = this.deps.store()?.doc;
      if (source.kind !== "video" || source.status !== "ready" || !source.path || !existsSync(source.path))
        continue;
      if (doc?.shotLogs.some((l) => l.id === source.id && l.segments.length)) continue;
      const analysis = doc?.analyses.find((a) => a.id === source.id);
      if (!analysis || this.active.has(source.id)) continue;
      const files = cachePaths(store.dir, source.id);
      const watch = { ...files, proxy: existsSync(files.proxy) ? files.proxy : source.path };
      this.describing = source.id;
      this.deps.emitIndex({
        source: source.id,
        stage: "describe",
        fraction: 0.5,
        label: "Describing the shots",
      });
      const started = Date.now();
      console.log("[index] describing", source.id);
      try {
        const log = await this.describe(source, analysis, watch, signal);
        const now = this.deps.store();
        if (signal.aborted || now !== store || !now.doc.sources.some((s) => s.id === source.id)) {
          console.log("[index] describing", source.id, "stopped: the project changed");
          return;
        }
        const exists = now.doc.shotLogs.some((l) => l.id === source.id);
        this.commit([
          exists
            ? { op: "update", coll: "shotLogs", id: source.id, patch: { ...log } }
            : { op: "insert", coll: "shotLogs", item: log },
        ]);
        const secs = Math.round((Date.now() - started) / 1000);
        console.log("[index] described", source.id, `(${log.segments.length} shots, ${secs}s)`);
      } catch (err) {
        if (signal.aborted) {
          console.log("[index] describing", source.id, "stopped");
          return;
        }
        console.warn("[index] describing", source.id, "still failing:", (err as Error).message);
        // Claude's still unreachable: the rest would fail the same way. Next trigger tries again.
        return;
      } finally {
        // Its badge comes down however it ended. Unless another project is open now: reset took it
        // down, and a clip there may have the same id.
        if (this.describing === source.id) {
          this.describing = null;
          if (this.deps.store() === store)
            this.deps.emitIndex({ source: source.id, stage: "ready", fraction: 1, label: "Ready" });
        }
      }
    }
  }

  /** The sounds in a speech or music wav (null when the classifier isn't available, or it failed). */
  private async hear(wav: string, signal: AbortSignal) {
    const ear = await ensureHear(paths.hear()).catch(() => null);
    if (!ear) return null;
    return hearSounds(ear, wav, signal).catch((err: unknown) => {
      if (signal.aborted) throw err;
      console.error("[index] hearing", wav, "failed:", err);
      return null;
    });
  }

  /**
   * Clips indexed before the editor could hear: their sounds, a track's instruments and how hard each
   * word is said, filled in once in the background (a second or two a clip).
   */
  /** What a clip's picture shows a frame a second (see.ts); null when it can't be read here. */
  private async see(video: string, signal: AbortSignal) {
    return seeClip(video, { signal }).catch((err: unknown) => {
      if (!signal.aborted)
        console.warn("[index] seeing", path.basename(video), "failed:", (err as Error).message);
      return null;
    });
  }

  private reading: Promise<void> | null = null;
  /** Stops reading at once when there's indexing to do (the clip is read again later). */
  private readStop: AbortController | null = null;

  /**
   * Reads the picture of clips that haven't had it read (the words on screen, where the eye goes, how
   * good each moment looks): in the background, only while nothing is indexing, so a clip is ready as
   * soon as it ever was and this never competes with transcribing or Claude describing shots. Stops when
   * indexing starts again; indexing finishing starts it again. Nothing waits for it.
   */
  private readPictures(): Promise<void> {
    if (this.reading) return this.reading;
    this.readStop = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, this.readStop.signal]);
    this.reading = this.readPicturesNow(signal).finally(() => {
      this.reading = null;
      this.readStop = null;
    });
    return this.reading;
  }

  private async readPicturesNow(signal: AbortSignal): Promise<void> {
    const store = this.deps.store();
    if (!store) return;
    for (const src of store.doc.sources) {
      if (signal.aborted) return;
      // Indexing came back: it goes first, and starts this again when it's done.
      if (this.queue.length || this.active.size) return;
      if (src.kind !== "video" || src.status !== "ready") continue;
      const analysis = this.deps.store()?.doc.analyses.find((a) => a.id === src.id);
      if (!analysis || analysis.text !== undefined) continue;
      const proxy = cachePaths(store.dir, src.id).proxy;
      const video = existsSync(proxy) ? proxy : src.path;
      if (!video || !existsSync(video)) continue;
      const seen = await this.see(video, signal);
      if (!seen || signal.aborted) return;
      if (this.deps.store()?.doc.sources.some((s) => s.id === src.id))
        this.commit([{ op: "update", coll: "analyses", id: src.id, patch: { ...seen } }]);
    }
  }

  private async hearBackfill(signal: AbortSignal): Promise<void> {
    const store = this.deps.store();
    if (!store) return;
    for (const src of store.doc.sources) {
      if (signal.aborted) return;
      if (src.status !== "ready" || !src.hasAudio || !src.path || !existsSync(src.path)) continue;
      if (src.kind !== "video" && src.kind !== "audio") continue;
      const doc = this.deps.store()?.doc;
      const analysis = doc?.analyses.find((a) => a.id === src.id);
      const transcript = doc?.transcripts.find((t) => t.id === src.id);
      const needSounds = !!analysis && analysis.sounds === undefined;
      // Where someone talks: for clips indexed before it was heard for (their transcripts stay).
      const needSpeech = !!analysis && src.kind === "video" && analysis.speech === undefined;
      const needStress = !!transcript?.words.length && transcript.words.some((w) => w.stress === undefined);
      if (!needSounds && !needStress && !needSpeech) continue;
      const wav = path.join(store.dir, CACHE_DIR, "audio", `${src.id}.hear.wav`);
      try {
        await extractSpeechWav(src.path, wav, signal);
        const ops: Op[] = [];
        if (needSounds || needSpeech) {
          const heard = await this.hear(wav, signal);
          if (heard)
            ops.push({
              op: "update",
              coll: "analyses",
              id: src.id,
              patch: {
                ...(needSounds && { sounds: heard.sounds }),
                ...(needSounds &&
                  src.kind === "audio" &&
                  heard.instruments.length && { instruments: heard.instruments }),
                ...(needSpeech && { speech: heard.speech.spans.map(([a, b]) => [a, b]) }),
              },
            });
        }
        if (needStress && transcript) {
          const stress = await wordStress(wav, transcript.words);
          ops.push({
            op: "update",
            coll: "transcripts",
            id: src.id,
            patch: { words: transcript.words.map((w, i) => ({ ...w, stress: stress[i]! })) },
          });
        }
        if (signal.aborted) return;
        // Still there, and still the same words (nothing re-transcribed meanwhile).
        const now = this.deps.store()?.doc;
        if (ops.length && now?.sources.some((s) => s.id === src.id)) this.commit(ops);
      } catch (err) {
        if (signal.aborted) return;
        console.error("[index] hearing", src.id, "failed:", err);
      } finally {
        await rm(wav, { force: true });
      }
    }
  }

  /**
   * Preview copies that don't decode (a copy cut short or scrambled, say by a crash mid-write) show a
   * black picture: check each once when the project opens, and make broken ones again.
   */
  private async healProxies(signal: AbortSignal): Promise<void> {
    const store = this.deps.store();
    if (!store) return;
    for (const src of store.doc.sources) {
      if (src.kind !== "video" || !src.proxy || !src.path || src.status !== "ready") continue;
      const file = cachePaths(store.dir, src.id).proxy;
      if (!existsSync(file) || !existsSync(src.path)) continue;
      // A copy that passed once, unchanged since, isn't checked on every open.
      const passed = `${file}.ok`;
      const stamp = await stat(file)
        .then((s) => `${s.size}:${Math.round(s.mtimeMs)}`)
        .catch(() => null);
      if (!stamp) continue;
      if (existsSync(passed) && (await readFile(passed, "utf8").catch(() => "")) === stamp) continue;
      try {
        if (await decodes(file, src.duration, signal)) {
          await writeFile(passed, stamp).catch(() => {});
          continue;
        }
        if (signal.aborted) return;
        console.warn("[index] preview copy of", src.id, "is broken; making it again");
        this.deps.emitIndex({
          source: src.id,
          stage: "preview",
          fraction: 0,
          label: "Repairing the preview copy",
        });
        await rm(file, { force: true });
        await makeProxy(src.path, file, {
          hdr: src.hdr,
          duration: src.duration,
          signal,
          onProgress: (f) =>
            this.deps.emitIndex({
              source: src.id,
              stage: "preview",
              fraction: f,
              label: "Repairing the preview copy",
            }),
        });
        this.deps.emitIndex({ source: src.id, stage: "ready", fraction: 1, label: "Ready" });
      } catch (err) {
        if (signal.aborted) return;
        console.error("[index] repairing the preview copy of", src.id, "failed:", err);
      }
    }
  }

  /**
   * Transcripts made before word starts were checked against the voice: re-time them in place, once.
   * Only times change (same words, same indexes), so caption fixes and emphasis keep pointing at the
   * right words, and nothing is transcribed again.
   */
  private async retime(signal: AbortSignal): Promise<void> {
    const doc = this.deps.store()?.doc;
    if (!doc) return;
    const settings = await getSettings();
    for (const t of doc.transcripts) {
      if ((t.aligned ?? 0) >= WORD_ALIGNMENT || !t.words.length) continue;
      const src = doc.sources.find((s) => s.id === t.id);
      if (!src?.path || src.status !== "ready" || !existsSync(src.path)) continue;
      const dir = this.deps.store()!.dir;
      // Its own name: an upgrade still running from an earlier visit may be reading the last one.
      const wav = path.join(dir, CACHE_DIR, "audio", `${src.id}.retime.${process.pid}.${Date.now()}.wav`);
      const saved = path.join(dir, CACHE_DIR, "audio", `${src.id}.words-v${WORD_ALIGNMENT}.json`);
      // Progress only while this project is the open one (another project's clip may share the id).
      const here = () => !signal.aborted && this.deps.store()?.dir === dir;
      const progress = (fraction: number) =>
        here() &&
        this.deps.emitIndex({
          source: src.id,
          stage: "transcribe",
          fraction,
          label: "Updating word timings",
        });
      try {
        progress(0);
        await extractSpeechWav(src.path, wav, signal);
        const envelope = await voiceEnvelope(wav, signal);
        // 4: times from whisper's alignment (the earlier passes' offsets drift), matched onto the words
        // already there so their fixes and emphasis stay put.
        let fresh: TimedWord[] | null = null;
        if ((t.aligned ?? 0) < 4) {
          fresh = existsSync(saved) ? (JSON.parse(await readFile(saved, "utf8")) as TimedWord[]) : null;
          if (!fresh) {
            let job = upgrading.get(saved);
            if (!job) {
              job = upgrades
                .run(async () => {
                  const setup = whisperSetup(settings);
                  await ensureWhisper(setup);
                  const { words } = await transcribeWords(wav, setup, {
                    signal: upgradesStop.signal,
                    onProgress: progress,
                  });
                  await writeFile(saved, JSON.stringify(words));
                  return words;
                })
                .finally(() => upgrading.delete(saved));
              upgrading.set(saved, job);
            }
            fresh = await job;
          }
        }
        if (signal.aborted) return;
        const store = this.deps.store();
        const current = store?.doc.transcripts.find((x) => x.id === t.id);
        if (!store || !current) continue;
        const silences = store.doc.analyses.find((a) => a.id === t.id)?.silences ?? [];
        const timed = fresh ? retimeWords(current.words, fresh) : current.words;
        const words = alignEndsToVoice(alignToSilences(alignToOnsets(timed, envelope), silences), envelope);
        // The cut keeps the same words: its edges move with them, then onto the breath.
        const ops: Op[] = [
          { op: "update", coll: "transcripts", id: t.id, patch: { words, aligned: WORD_ALIGNMENT } },
          ...moveEdgesWithWords(store.doc, t.id, current.words, words),
        ];
        const moved = applyOps(store.doc, ops).doc;
        const peaks = existsSync(cachePaths(store.dir, t.id).peaks)
          ? new Uint8Array(await readFile(cachePaths(store.dir, t.id).peaks))
          : null;
        const clean = peaks
          ? cleanCutOps(
              { ...moved, scenes: moved.scenes.filter((sc) => sc.source === t.id) } as typeof moved,
              (id) => (id === t.id ? peaks : null),
            ).ops
          : [];
        if (store.doc.transcripts.find((x) => x.id === t.id) !== current) continue; // changed meanwhile
        store.commitAndBroadcast({
          author: "index",
          message: "Re-timed the words to the audio",
          ops: [...ops, ...clean],
        });
        this.deps.emitIndex({ source: src.id, stage: "ready", fraction: 1, label: "Ready" });
      } catch (err) {
        if (signal.aborted) return;
        console.error("[index] re-timing words of", t.id, "failed:", err);
        this.deps.emitIndex({ source: src.id, stage: "ready", fraction: 1, label: "Ready" });
      } finally {
        await rm(wav, { force: true });
      }
    }
  }

  private pump(): void {
    while (this.active.size < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.active.add(id);
      const project = this.controller.signal;
      const own = new AbortController();
      this.jobs.set(id, own);
      const signal = AbortSignal.any([project, own.signal]);
      const work = this.index(id, signal);
      this.track(work);
      void work.finally(() => {
        // Another project opened, or this clip was removed (prune already moved on).
        if (signal.aborted) return;
        this.jobs.delete(id);
        this.active.delete(id);
        this.finishBatches(id);
        this.pump();
        // All indexed: now the pictures can be read, in the background.
        if (!this.queue.length && !this.active.size) void this.readPictures();
      });
    }
  }

  private finishBatches(id: string): void {
    for (const b of this.batches) if (b.ids.delete(id)) b.finished++;
    const done = this.batches.filter((b) => b.ids.size === 0);
    this.batches = this.batches.filter((b) => b.ids.size > 0);
    const doc = this.deps.store()?.doc;
    for (const b of done)
      this.deps.emitImportDone({ sources: doc?.sources.map((s) => s.id) ?? [], firstImport: b.firstImport });
  }

  private commit(ops: Op[]): void {
    const store = this.deps.store();
    if (!store || !ops.length) return;
    store.commitAndBroadcast({ author: "index", message: "Indexed", ops });
  }

  private async index(id: string, signal: AbortSignal): Promise<void> {
    const store = this.deps.store();
    const source = store?.doc.sources.find((s) => s.id === id);
    if (!store || !source?.path) return;
    const dir = store.dir;
    const files = cachePaths(dir, id);
    const emit = (stage: IndexEvent["stage"], fraction: number, label: string) =>
      this.deps.emitIndex({ source: id, stage, fraction, label });
    const settings = await getSettings();

    try {
      this.commit([{ op: "update", coll: "sources", id, patch: { status: "indexing", error: null } }]);
      const patch: Partial<Source> = { status: "ready" };
      const analysis: Analysis = { id, silences: [], shots: [] };
      let transcript: Transcript | null = null;

      // A see-through clip (a keyed one) plays as it is: an H.264 preview copy would lose its transparency.
      if (source.kind === "video" && !(await seeThrough(source.path))) {
        emit("preview", 0, "Making a preview copy");
        await makeProxy(source.path, files.proxy, {
          hdr: source.hdr,
          duration: source.duration,
          signal,
          onProgress: (f) => emit("preview", f * 0.3, "Making a preview copy"),
        });
        patch.proxy = true;
      }

      // Shots and faces need only the preview copy. With them, describing the picture (network-bound)
      // runs while whisper transcribes (CPU-bound), instead of after it.
      let describing: Promise<ShotLog | null> = Promise.resolve(null);
      if (source.kind === "video" && patch.proxy) {
        emit("analyze", 0.31, "Finding shot changes and faces");
        analysis.shots = await detectShots(files.proxy, signal);
        const face = await detectFace(files.proxy, source.duration, signal);
        if (face) analysis.face = face;
        const picture = await pictureProfile(files.proxy, source.duration, signal);
        if (picture) analysis.picture = picture;
        if (settings.describeShots)
          describing = this.describe(source, analysis, files, signal).catch((err: unknown) => {
            if (signal.aborted) throw err;
            console.error("[index] describing", id, "failed:", err);
            return null;
          });
      }

      // What the clip sounds like, and where someone talks in it (before transcribing: only that is).
      let heard: Awaited<ReturnType<Indexer["hear"]>> = null;
      if (source.hasAudio && (source.kind === "video" || source.kind === "audio")) {
        emit("audio", 0.32, "Listening");
        await extractSpeechWav(source.path, files.wav, signal);
        analysis.silences = await detectSilences(files.wav, { signal });
        await mkdir(path.dirname(files.peaks), { recursive: true });
        await writeFile(files.peaks, await waveformPeaks(files.wav, signal));
        const loudness = await measureLoudness(files.wav, signal).catch(() => null);
        if (loudness !== null) analysis.loudness = loudness;
        // How the voice sounds against broadcast speech, so the export can match it and the agent knows.
        if (source.kind === "video") {
          const voice = await voiceProfile(source.path, 150, signal);
          if (voice) analysis.voice = { bands: [...voice.bands], noiseFloor: voice.noiseFloor };
        }
        // What it sounds like: laughter, applause, music... and a track's instruments. Never fatal.
        heard = await this.hear(files.wav, signal);
        if (heard) {
          analysis.sounds = heard.sounds;
          if (source.kind === "video") analysis.speech = heard.speech.spans.map(([a, b]) => [a, b]);
          if (source.kind === "audio" && heard.instruments.length) analysis.instruments = heard.instruments;
        }
      }

      if (source.kind === "audio") {
        emit("analyze", 0.5, "Finding the beat");
        const beats = await beatMap(source.path, paths.cache());
        if (beats.bpm) analysis.bpm = beats.bpm;
        analysis.beats = beats.beats.map((ms) => ms / 1000);
        analysis.downbeats = beats.downbeats.map((ms) => ms / 1000);
        analysis.start = beats.startMs / 1000;
        if (beats.dropMs !== null) analysis.drop = beats.dropMs / 1000;
        // No drop from the beat analysis (short edits often have none): the biggest jump in energy.
        if (analysis.drop === undefined && existsSync(files.peaks)) {
          const shape = soundShape(new Uint8Array(await readFile(files.peaks)), { beats: analysis.beats });
          if (shape.hit !== null) analysis.drop = shape.hit;
        }
      } else if (
        source.kind === "video" &&
        source.hasAudio &&
        heard &&
        !needsTranscript(heard.speech, source.duration)
      ) {
        // Nobody talks (scenery, b-roll, music, ambience): nothing to transcribe, and nothing for the
        // transcriber to invent over it ("thanks for watching" over a song).
        patch.speech = false;
        analysis.speech = [];
      } else if (source.kind === "video" && source.hasAudio) {
        const setup = whisperSetup(settings);
        emit("transcribe", 0.4, "Transcribing");
        await ensureWhisper(setup, (label, f) => emit("setup", 0.4, `${label} ${Math.round(f * 100)}%`));
        // Talk in part of it (a vlog's pieces to camera between scenery): only those stretches are heard.
        // Heard nothing (the classifier isn't here): all of it, as before.
        const spans = heard?.speech.spans ?? [];
        const talked = spans.reduce((n, [a, b]) => n + b - a, 0);
        const cut =
          spans.length && talked < source.duration * 0.85
            ? await cutToSpeech(files.wav, spans, files.speechWav)
            : null;
        const said = await transcribeWords(cut ? files.speechWav : files.wav, setup, {
          glossary: settings.glossary,
          signal,
          onProgress: (f) => emit("transcribe", 0.4 + f * 0.5, "Transcribing"),
        });
        const { language } = said;
        const words = cut ? fromSpeechCut(said.words, cut) : said.words;
        // Word starts the transcriber put early (after pauses) move to where the voice really starts.
        const envelope = await voiceEnvelope(files.wav, signal).catch(() => null);
        const edged = alignToSilences(envelope ? alignToOnsets(words, envelope) : words, analysis.silences);
        // Ends last: a phrase's final word runs on until the voice actually fades.
        const timed = envelope ? alignEndsToVoice(edged, envelope) : edged;
        // How hard each word is said, heard from the voice.
        const stress = await wordStress(files.wav, timed).catch(() => null);
        const aligned = stress ? timed.map((w, i) => ({ ...w, stress: stress[i]! })) : timed;
        transcript = { id, language, words: aligned, ...(envelope && { aligned: WORD_ALIGNMENT }) };
        patch.speech = aligned.length >= 5;
        if (patch.speech) {
          const text = aligned.map((w) => w.text).join(" ");
          const first = /^(.{20,140}?[.!?])(\s|$)/.exec(text)?.[1] ?? text.slice(0, 120);
          patch.summary = `Says: "${first.trim()}"`;
        }
      }

      // The visual transcript: what every stretch of picture shows. Optional and never fatal: a clip
      // without it is still fully usable.
      emit("describe", 0.92, "Watching the footage");
      const described = await describing;
      const shotLog: ShotLog | null = described && {
        ...described,
        loud: loudStretches(
          existsSync(files.peaks) ? new Uint8Array(await readFile(files.peaks)) : new Uint8Array(),
          transcript?.words ?? [],
        ),
      };

      await rm(files.wav, { force: true });
      await rm(files.speechWav, { force: true });
      const current = this.deps.store()?.doc;
      if (!current?.sources.some((s) => s.id === id)) return; // removed meanwhile
      const ops: Op[] = [{ op: "update", coll: "sources", id, patch }];
      const upsert = <C extends "transcripts" | "analyses" | "shotLogs">(
        coll: C,
        item: C extends "transcripts" ? Transcript : C extends "shotLogs" ? ShotLog : Analysis,
      ) => {
        const exists = current[coll].some((x) => x.id === id);
        ops.push(exists ? { op: "update", coll, id, patch: { ...item } } : { op: "insert", coll, item });
      };
      upsert("analyses", analysis);
      if (transcript) upsert("transcripts", transcript);
      if (shotLog) upsert("shotLogs", shotLog);
      this.commit(ops);
      emit("ready", 1, "Ready");
    } catch (err) {
      if (signal.aborted || err instanceof CancelledError) return;
      // Removed while indexing: nothing to record (and no clip to mark as failed).
      if (!this.deps.store()?.doc.sources.some((s) => s.id === id)) return;
      const message = (err as Error).message.split("\n")[0]!.slice(0, 300);
      this.commit([{ op: "update", coll: "sources", id, patch: { status: "failed", error: message } }]);
      this.deps.emitIndex({ source: id, stage: "failed", fraction: 1, label: "Failed", error: message });
    }
  }

  /**
   * Segments at the shot changes, contact sheets of them from the preview copy, and descriptions from a
   * vision model, three sheets per call, a few calls at a time.
   */
  private async describe(
    source: Source,
    analysis: Analysis,
    files: ReturnType<typeof cachePaths>,
    signal: AbortSignal,
  ): Promise<ShotLog> {
    const backend = defaultBackend();
    // Which Claude Code to run (found once at startup; this waits for it).
    await claudeStatus();
    const segments = segmentsOf(source.duration, analysis.shots);
    const perSheet = 8;
    const sheets = await contactSheets(files.proxy, segments, {
      perSheet,
      portrait: (source.height ?? 0) > (source.width ?? 0),
      signal,
    });
    const label = (s: Segment) => `${formatTime(s.start, true)}-${formatTime(s.end, true)}`;
    // Three sheets per call; calls share one limit across clips indexing at the same time.
    const perCall = 3;
    const batches: { from: number; count: number }[] = [];
    for (let i = 0; i < sheets.length; i += perCall)
      batches.push({
        from: i * perSheet,
        count: Math.min(perCall * perSheet, segments.length - i * perSheet),
      });
    const described: (ShotSegment | null)[] = new Array(segments.length).fill(null);
    await Promise.all(
      batches.map((b, k) =>
        visionCalls.run(async () => {
          const results = await describeBatch(
            {
              sheets: sheets.slice(k * perCall, (k + 1) * perCall),
              segments: segments.slice(b.from, b.from + b.count).map((s) => ({ label: label(s) })),
              perSheet,
            },
            backend,
            signal,
          );
          results.forEach((r, i) => {
            const seg = segments[b.from + i]!;
            if (r) {
              const { n: _, ...rest } = r;
              described[b.from + i] = ShotSegment.parse({
                ...rest,
                start: round(seg.start),
                end: round(seg.end),
              });
            }
          });
        }),
      ),
    );
    // Claude unreachable (no key, signed out, offline): nothing is saved, so the clip is described once
    // it's back (describeMissing) instead of keeping an empty log forever.
    const got = described.filter(Boolean).length;
    if (segments.length && got < segments.length / 2)
      throw new Error(`Claude described ${got} of ${segments.length} shots`);
    // Back-to-back segments the model saw the same way read as one.
    const merged: ShotSegment[] = [];
    for (const s of described) {
      if (!s) continue;
      const last = merged.at(-1);
      if (last && last.end === s.start && last.what === s.what && last.shot === s.shot)
        merged[merged.length - 1] = { ...last, end: s.end, highlight: last.highlight || s.highlight };
      else merged.push(s);
    }
    return { id: source.id, segments: merged, loud: [] };
  }

  /** The waveform of a clip, if it has been measured. */
  async peaks(id: string, dir = this.deps.store()?.dir): Promise<Uint8Array | null> {
    if (!dir) return null;
    const file = cachePaths(dir, id).peaks;
    if (!existsSync(file)) return null;
    return new Uint8Array(await readFile(file));
  }

  /**
   * The waveform now: measured straight from the file when indexing hasn't got to it yet (a track the
   * agent just brought in), so the agent never has to wait and ask again.
   */
  async peaksNow(id: string, doc?: ProjectDoc, dir?: string): Promise<Uint8Array | null> {
    // A request in a project working in the background names its own folder.
    const store = this.deps.store();
    const where = dir ?? store?.dir;
    const stored = await this.peaks(id, where);
    if (stored?.length) return stored;
    // The agent's working copy when given: a sound it just added isn't in the saved project yet.
    const src = (doc ?? store?.doc)?.sources.find((s) => s.id === id);
    if (!where || !src?.path || (src.kind !== "audio" && src.kind !== "video")) return null;
    const file = cachePaths(where, id).peaks;
    const peaks = await waveformPeaks(src.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, peaks);
    return peaks;
  }
}

/** Waits for promises to settle, but no longer than `ms` (an aborted job winds down in a moment). */
export function settle(work: Iterable<Promise<unknown>>, ms = 3000): Promise<void> {
  return Promise.race([
    Promise.allSettled([...work]).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, ms)),
  ]);
}
