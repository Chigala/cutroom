import { randomUUID } from "node:crypto";
/**
 * The host side of EditorApi: owns the open project folder, serializes every change through one
 * ProjectStore, indexes footage and runs the agent off the UI thread, and pushes what it does back to
 * the window as events.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AgentError,
  type AgentHost,
  type Backend,
  defaultBackend,
  type Effort,
  HARNESSES,
  handEdits,
  runAgent,
} from "@vedit/agent";
import type {
  ActiveRun,
  AgentEvent,
  AgentStatus,
  AttachResult,
  ChatRecord,
  CommitResult,
  EditorEvents,
  HarnessId,
  ProjectFolder,
  ProjectSnapshot,
  RecentProject,
} from "@vedit/bridge";
import { AgentRequest, CommitRequestSchema } from "@vedit/bridge";
import { clearArea } from "@vedit/checks";
import { type InstantResult, precheck, tryInstant } from "@vedit/instant";
import {
  alignText,
  cutoutsAvailable,
  downloadMeme,
  downloadSound,
  downloadStock,
  ensureWhisper,
  extractSpeechWav,
  type FoundTrack,
  findMusic,
  findSounds,
  grabFrame,
  isMedia,
  makeProcessed,
  measureJoins,
  measureProcessed,
  type Probed,
  type ProcessInput,
  playableCopy,
  probe,
  resolveDerived,
  STOCK_LICENSE,
  searchMemes,
  searchStock,
  sfxFile,
  soundHit,
  stockSheet,
  trackRange,
  transcribeWords,
} from "@vedit/media";
import {
  type AssetEntry,
  ATTACHMENTS_DIR,
  anchorAt,
  assetId,
  CACHE_DIR,
  CHAT_LOG,
  type ChangeGroup,
  type Commit,
  demoProject,
  emptyProject,
  FONTS_DIR,
  type InspirationInfo,
  type InspirationPack,
  inspirationInfo,
  inspirationMeta,
  inspirationOps,
  type KitInfo,
  keepable,
  kitOps,
  LUTS_DIR,
  newId,
  nextId,
  type Op,
  OpError,
  type ProcessRecipe,
  type ProjectDoc,
  packFromProject,
  revertOps,
  round,
  type Scene,
  SFX_NAMES,
  type SfxName,
  type Source,
  STARTER_INSPIRATIONS,
  starterOps,
  stopInspirationOps,
  timelineOf,
} from "@vedit/project";
import { ProjectStore, readLog } from "@vedit/project/node";
import { renderStills, senseMotion } from "@vedit/render";
import { app, type BrowserWindow, dialog, Notification, nativeImage, shell } from "electron";
import { z } from "zod";
import { capturePage } from "./capture.ts";
import { claudeStatus, claudeTasks } from "./claude.ts";
import { codexStatus } from "./codex.ts";
import { makeNeededCutouts } from "./cutouts.ts";
import { Downloads } from "./downloads.ts";
import { Exporter, entry as renderEntry } from "./exporter.ts";
import {
  type FolderEntry,
  isProjectFolder,
  makeProjectFolder,
  moveVideo,
  projectName,
  projectOf,
  renameProject,
  samePath,
  videosIn,
} from "./folders.ts";
import { makeNeededFootage } from "./footage.ts";
import { History } from "./history.ts";
import { cachePaths, Indexer, stopUpgrades } from "./indexer.ts";
import { InspirationStore } from "./inspirations.ts";
import { jevEndpoint, logInstant } from "./instant.ts";
import { copyKitFiles, getKit, listKits, rememberInKit, removeKit, saveKit, withKit } from "./kits.ts";
import { Library } from "./library.ts";
import { onWindowsDrive } from "./platform.ts";
import {
  copyProject,
  footageOps,
  makeThumbnail,
  readTimeline,
  relinked,
  relinkOps,
  thumbFile,
} from "./projects.ts";
import { getSettings, paths, setSettings, whisperSetup } from "./settings.ts";
import { makeNeededStems } from "./stems.ts";

const SWATCHES = ["#355761", "#2B4F63", "#5A4A36", "#45603F", "#3A3552", "#2F5A6B", "#5E4632", "#4C5A3A"];

type AgentEventBody = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, "runId"> : never) : never;

export interface AgentSettings {
  readonly backend: Backend;
  /** Which agent edits: Claude or Codex. */
  readonly harness: HarnessId;
  /** The model, for that agent ("" for Codex: its default for the plan). */
  readonly model: string;
  readonly effort: Effort;
  readonly showThinking: boolean;
}

const round3 = (t: number) => Math.round(t * 1000) / 1000;

export class ProjectService {
  private store: ProjectStore | null = null;
  private runs = new Map<string, AbortController>();
  /**
   * Each run's work so far (the live draft), by run: kept or thrown away by the user when the run ends
   * without finishing. Only for the project it was made in.
   */
  private partials = new Map<string, { dir: string; ops: Op[]; groups: ChangeGroup[] }>();
  /** What each running request was asked and when, for a window that reloads mid-request. */
  private asked = new Map<string, { dir: string; prompt: string; startedAt: number }>();
  readonly indexer: Indexer;
  readonly exporter: Exporter;
  /** Restore points: every request and edit, from the project's log. */
  readonly history = new History(() => this.store);
  /** The asset library: the shared folder and the open project's assets/. */
  readonly library = new Library((state) => this.emit("library", state));
  /** The user's own inspirations, in the library folder. */
  readonly inspirations = new InspirationStore(() =>
    // When the library isn't running (headless runs, a library that failed to start), the app's own
    // data folder keeps them.
    this.library.folder("library").catch((err: unknown) => {
      console.warn(`[inspirations] library unavailable (${(err as Error).message}); using app data`);
      return app.getPath("userData");
    }),
  );
  readonly downloads = new Downloads((list) => this.emit("downloads", list));
  /** Installing, signing in to and updating Claude Code. */
  readonly claude = claudeTasks((t) => this.emit("claude", t));

  constructor(private readonly window: () => BrowserWindow | null) {
    const store = () => this.store;
    this.indexer = new Indexer({
      store,
      emitIndex: (e) => this.emit("index", e),
      emitImportDone: (e) => this.emit("importDone", e),
    });
    this.exporter = new Exporter(store, (e) => this.emit("export", e));
  }

  private emit<E extends keyof EditorEvents>(event: E, payload: EditorEvents[E]): void {
    const win = this.window();
    if (win && !win.isDestroyed()) win.webContents.send(`event:${event}`, payload);
    for (const l of this.listeners.get(event) ?? []) (l as (p: EditorEvents[E]) => void)(payload);
  }

  private readonly listeners = new Map<string, Set<(payload: never) => void>>();

  /** Requests running in a project, taking in what indexing writes there meanwhile (runAgent). */
  private readonly indexWatchers = new Map<string, Set<(ops: readonly Op[]) => void>>();

  private watchIndexing(dir: string, listener: (ops: readonly Op[]) => void): () => void {
    const set = this.indexWatchers.get(dir) ?? new Set();
    set.add(listener);
    this.indexWatchers.set(dir, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.indexWatchers.delete(dir);
    };
  }

  /** Listens to the events the window gets (the benchmark runs without one). Returns the unsubscribe. */
  on<E extends keyof EditorEvents>(event: E, listener: (payload: EditorEvents[E]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: never) => void);
    this.listeners.set(event, set);
    return () => set.delete(listener as (payload: never) => void);
  }

  /** The next `event` that passes `test`. */
  waitFor<E extends keyof EditorEvents>(
    event: E,
    test: (payload: EditorEvents[E]) => boolean,
    timeoutMs: number,
  ): Promise<EditorEvents[E]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for ${event}`));
      }, timeoutMs);
      const off = this.on(event, (p) => {
        if (!test(p)) return;
        clearTimeout(timer);
        off();
        resolve(p);
      });
    });
  }

  currentDoc(): ProjectDoc | null {
    return this.store?.doc ?? null;
  }

  /** A new project at `dir` with `clips` imported (the benchmark's). */
  async benchProject(dir: string, clips: string[]): Promise<void> {
    await mkdir(dir, { recursive: true });
    await this.switchTo(await ProjectStore.create(dir, await this.fresh(dir), this.events(dir)));
    const r = await this.importFiles(clips);
    if (!r.ok) throw new Error(r.error);
  }

  /** Measures the rendered motion of `doc` (the agent's inspect_motion). */
  senseMotion(doc: ProjectDoc, store: ProjectStore = this.requireStore()) {
    return senseMotion({
      doc,
      entry: renderEntry(),
      workDir: path.join(store.dir, CACHE_DIR, "sense"),
      safeZone: clearArea(doc.checkRules),
      resolve: (key) => this.resolveIn(doc, key.replace(/\?.*$/, ""), "proxy", store),
    });
  }

  /** How every dialogue cut in `doc` sounds (the agent's inspect_joins), from each clip's speech audio. */
  measureJoins(doc: ProjectDoc, store: ProjectStore = this.requireStore()) {
    const dir = path.join(store.dir, CACHE_DIR, "audio");
    return measureJoins(doc, async (id) => {
      const src = doc.sources.find((s) => s.id === id);
      if (!src?.path || !src.hasAudio || !existsSync(src.path)) return null;
      const wav = path.join(dir, `${id}.join.wav`);
      if (!existsSync(wav)) {
        // Written aside and moved in, so a half-written file is never read as the clip's audio.
        const tmp = path.join(dir, `${id}.join.${process.pid}.${Date.now()}.wav`);
        await extractSpeechWav(src.path, tmp);
        await rename(tmp, wav);
      }
      return wav;
    });
  }

  /** The open project's document, or null. */
  doc(): ProjectDoc | null {
    return this.store?.doc ?? null;
  }

  private requireStore(): ProjectStore {
    if (!this.store) throw new Error("no project is open");
    return this.store;
  }

  /**
   * Resolves a media:// key to a file the open project references; nothing else is reachable.
   * "<id>" is the clip itself, "<id>?proxy" its preview copy, "sfx/<name>" a built-in sound.
   */
  resolveMedia = (key: string, query: string): Promise<string | null> =>
    this.resolveIn(this.store?.doc ?? null, key, query);

  /**
   * A media key to a file, looked up in a given state of the project: the saved one, or the agent's
   * working copy (whose new clips, like a track it just found, aren't saved yet).
   */
  private async resolveIn(
    doc: ProjectDoc | null,
    key: string,
    query: string,
    /** The project the doc is from (a background request's), else the open one. */
    from: ProjectStore | null = this.store,
  ): Promise<string | null> {
    // An asset in the library or the project's assets/ (the Library tab's previews).
    if (key.startsWith("lib/")) return this.library.resolve(key.slice(4));
    // Footage made from a clip: its cutout, or a ramped shot (rendered on first ask).
    if (key.includes("~"))
      return from && doc ? resolveDerived(from.dir, doc, key, doc.meta.format.fps) : null;
    if (key.startsWith("sfx/")) {
      const name = key.slice(4) as SfxName;
      return SFX_NAMES.includes(name) ? sfxFile(name, paths.cache()) : null;
    }
    const store = from;
    // A picture the agent looked at (a frame strip), kept for the chat.
    if (/^looks\/[a-z0-9-]+\.jpg$/.test(key)) return store ? path.join(store.dir, CACHE_DIR, key) : null;
    if (key.startsWith(`${FONTS_DIR}/`)) {
      // Only fonts the project knows, by exact file name: no other path is reachable.
      const font = doc?.fonts.find((f) => `${FONTS_DIR}/${f.file}` === key);
      return store && font ? path.join(store.dir, FONTS_DIR, font.file) : null;
    }
    if (key.startsWith(`${LUTS_DIR}/`)) {
      const lut = doc?.luts.find((l) => `${LUTS_DIR}/${l.file}` === key);
      return store && lut ? path.join(store.dir, LUTS_DIR, lut.file) : null;
    }
    const src = doc?.sources.find((s) => s.id === key);
    if (!store || !src?.path) return null;
    if (query === "proxy") {
      const proxy = cachePaths(store.dir, src.id).proxy;
      if (existsSync(proxy)) return proxy;
    }
    return src.path;
  }

  private async snapshot(): Promise<ProjectSnapshot> {
    const store = this.requireStore();
    const log = await readLog(store.dir);
    return { dir: store.dir, doc: store.doc, head: store.head, commits: log.slice(-200) };
  }

  /** Switches run one at a time, so each closes the store before it (none is left watching a folder). */
  private switching: Promise<unknown> = Promise.resolve();

  private switchTo(next: ProjectStore): Promise<ProjectSnapshot> {
    const run = this.switching.then(
      () => this.doSwitch(next),
      () => this.doSwitch(next),
    );
    this.switching = run.catch(() => undefined);
    return run;
  }

  private async doSwitch(next: ProjectStore): Promise<ProjectSnapshot> {
    this.indexer.reset();
    this.exporter.stop();
    // The project on screen until now: Claude may still be working in it, and carries on in the
    // background (it's closed when its last request ends). Otherwise it closes.
    const prev = this.store;
    if (prev && prev !== next) {
      if (this.busy(prev.dir)) this.background.set(prev.dir, prev);
      else await prev.close();
    }
    this.background.delete(next.dir);
    // Worked on in the background: what Claude did there is on disk before the window reads the history.
    await next.flush();
    this.store = next;
    next.watch();
    await this.rescueTemporary(next);
    void this.convertUnplayable(next);
    // Built-ins added to the app since this project last opened: written in as its own files.
    const starters = starterOps(next.doc);
    if (starters.length)
      next.commitAndBroadcast({ author: "index", message: "Added the new built-in effects", ops: starters });
    await this.remember(next.dir, next.doc.meta.name);
    this.refreshThumbnail(0);
    this.indexer.resume();
    void this.library.setProject(next.dir);
    if (onWindowsDrive(next.dir))
      // Once the window has the project (its warning toasts are listening by then).
      setTimeout(
        () =>
          this.emit("error", {
            message:
              "This project is on a Windows drive (/mnt/...). From WSL that's slow and changes made outside the app aren't seen: keep projects in your Linux home folder.",
          }),
        1500,
      );
    return this.snapshot();
  }

  /**
   * Projects Claude is working in while another is on screen, by folder: kept open (and watching their
   * files) until their last request ends.
   */
  private background = new Map<string, ProjectStore>();

  /** Whether Claude has a request running in this project. */
  private busy(dir: string): boolean {
    for (const a of this.asked.values()) if (a.dir === dir) return true;
    return false;
  }

  /** Background projects being closed (saved), by folder: reopening one waits for its files. */
  private closing = new Map<string, Promise<void>>();

  /** A project's store: the one on screen, one working in the background, or opened from its folder. */
  private async openStore(dir: string): Promise<ProjectStore> {
    if (this.store?.dir === dir) return this.store;
    const kept = this.background.get(dir);
    if (kept) return kept;
    await this.closing.get(dir);
    return ProjectStore.open(dir, this.events(dir));
  }

  /** A project kept open for a request while another is on screen (a queued message sent there). */
  private async backgroundStore(dir: string): Promise<ProjectStore> {
    if (this.store?.dir === dir) return this.store;
    const kept = this.background.get(dir);
    if (kept) return kept;
    if (!(await this.recent()).some((r) => r.dir === dir))
      throw new Error("That project isn't in your list.");
    // Just let go of (its last request ended): its files are written before they're read again.
    await this.closing.get(dir);
    const again = this.background.get(dir);
    if (again) return again;
    const store = await ProjectStore.open(dir, this.events(dir));
    store.watch();
    this.background.set(dir, store);
    return store;
  }

  /** Closes a background project once Claude has nothing left running in it. */
  private async release(store: ProjectStore): Promise<void> {
    if (store === this.store || this.busy(store.dir) || this.background.get(store.dir) !== store) return;
    this.background.delete(store.dir);
    const closed = store.close().finally(() => {
      if (this.closing.get(store.dir) === closed) this.closing.delete(store.dir);
    });
    this.closing.set(store.dir, closed);
    await closed;
  }

  private events(dir: string) {
    return {
      onCommit: (commit: Commit) => {
        if (commit.author === "index") for (const l of this.indexWatchers.get(dir) ?? []) l(commit.ops);
        // A project working in the background: its changes stay in it (the window shows another one),
        // and its thumbnail follows its shots.
        if (this.store?.dir !== dir) {
          const store = this.background.get(dir);
          if (store && commit.ops.some((op) => "coll" in op && op.coll === "scenes"))
            void this.queueThumb(() => makeThumbnail(dir, store.doc))
              .then((made) => made && this.emit("thumbnail", { dir }))
              .catch(() => undefined);
          return;
        }
        this.emit("commit", { commit, head: commit.id });
        this.renamed(commit);
        // Clips removed (or imports undone) stop indexing.
        if (this.store) this.indexer.prune(this.store.doc);
        this.scheduleCutouts();
        this.shotsChanged(commit);
      },
      onError: (error: Error) => this.emit("error", { message: error.message }),
    };
  }

  /** A restore under way: a second ask (the window's startup running twice) waits for it, not opens again. */
  private restoring: Promise<ProjectSnapshot> | null = null;

  restore(): Promise<ProjectSnapshot> {
    this.restoring ??= this.restoreNow().finally(() => {
      this.restoring = null;
    });
    return this.restoring;
  }

  private async restoreNow(): Promise<ProjectSnapshot> {
    if (this.store) return this.snapshot();
    // The one opened last, wherever it sits in the list.
    const last = (await this.recent()).reduce<RecentProject | undefined>(
      (best, r) => (!best || r.openedAt > best.openedAt ? r : best),
      undefined,
    );
    if (last) {
      try {
        return await this.switchTo(await this.openStore(last.dir));
      } catch {
        // moved or deleted since; fall through to the demo
      }
    }
    return this.openDemo();
  }

  /**
   * Opens a project folder, or, given videos (or photos, or songs) instead, starts a new project with
   * them: people reach for Open with a video in mind.
   */
  async open(dir?: string): Promise<ProjectSnapshot | null> {
    let target = dir;
    if (!target) {
      const win = this.window();
      const options = {
        title: "Open a project folder, or pick videos to start a new project",
        buttonLabel: "Open",
        properties: ["openDirectory" as const, "openFile" as const, "multiSelections" as const],
        filters: [{ name: "Project folders, videos, audio and photos", extensions: MEDIA_EXTENSIONS }],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;
      const files = [];
      for (const p of result.filePaths) if (!(await stat(p)).isDirectory()) files.push(p);
      if (files.length) return this.startWith(files);
      target = result.filePaths[0];
    }
    // A project (a folder of videos), not a video: it joins the sidebar, and its latest video opens.
    if (isProjectFolder(target)) {
      await this.addFolder(target);
      const [latest] = (await videosIn(target)).sort((a, b) => b.changedAt - a.changedAt);
      return latest ? this.switchTo(await this.openStore(latest.dir)) : null;
    }
    return this.switchTo(await this.openStore(target));
  }

  /** "New project from videos…": pick clips, get a fresh project with them in it. */
  async newFromVideos(rawFolder?: unknown): Promise<ProjectSnapshot | null> {
    const folder = rawFolder ? await this.knownFolder(rawFolder) : undefined;
    const win = this.window();
    const options = {
      title: "Start a new project from videos",
      buttonLabel: "Start project",
      properties: ["openFile" as const, "multiSelections" as const],
      defaultPath: this.lastImportDir ?? app.getPath("downloads"),
      filters: [{ name: "Video, audio and photos", extensions: MEDIA_EXTENSIONS }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return null;
    return this.startWith(result.filePaths, folder);
  }

  /**
   * A new project in Movies, named after the first clip, with the clips imported. The import lands a
   * moment after the project opens, so the window shows it arriving (and indexing) like a drop.
   */
  private async startWith(files: string[], folder?: string): Promise<ProjectSnapshot> {
    this.lastImportDir = path.dirname(files[0]!);
    const name = sanitize(path.basename(files[0]!, path.extname(files[0]!))) || "Untitled";
    const dir = await freeDir(path.join(folder ?? app.getPath("videos"), name));
    await mkdir(dir, { recursive: true });
    const snapshot = await this.switchTo(
      await ProjectStore.create(dir, await this.fresh(dir), this.events(dir)),
    );
    setTimeout(() => {
      void this.importFiles(files).then((r) => {
        if (!r.ok) this.emit("error", { message: r.error });
      });
    }, 500);
    return snapshot;
  }

  async create(name: string, rawFolder?: unknown): Promise<ProjectSnapshot | null> {
    if (rawFolder) {
      // Inside a project: straight there, no picker.
      const dir = await freeDir(path.join(await this.knownFolder(rawFolder), sanitize(name)));
      await mkdir(dir, { recursive: true });
      return this.switchTo(await ProjectStore.create(dir, await this.fresh(dir), this.events(dir)));
    }
    const win = this.window();
    const options = {
      title: "Where should the project folder go?",
      properties: ["openDirectory" as const, "createDirectory" as const],
      defaultPath: app.getPath("videos"),
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const dir = await freeDir(path.join(result.filePaths[0], sanitize(name)));
    await mkdir(dir, { recursive: true });
    return this.switchTo(await ProjectStore.create(dir, await this.fresh(dir), this.events(dir)));
  }

  /** A new project's doc: empty, with the user's style and the brand kit new projects start with. */
  private async fresh(dir: string): Promise<ProjectDoc> {
    const settings = await getSettings();
    return withKit(emptyProject(path.basename(dir), settings.style), settings.kit, dir);
  }

  // --- Brand kits ---------------------------------------------------------------------------------

  listKits(): Promise<KitInfo[]> {
    return listKits();
  }

  /** Saves this project's taste as a kit and links the project to it (what it learns goes there too). */
  async saveKit(name: string, id?: string): Promise<KitInfo> {
    const store = this.requireStore();
    await store.flush();
    const info = await saveKit(store.doc, store.dir, name, id);
    if (store.doc.meta.kit !== info.id)
      store.commitAndBroadcast({
        author: "user",
        message: `Saved brand kit "${info.name}"`,
        ops: [{ op: "merge", key: "meta", patch: { kit: info.id } }],
      });
    return info;
  }

  async applyKit(id: string): Promise<CommitResult> {
    const store = this.requireStore();
    const kit = await getKit(id);
    if (!kit) return { ok: false, error: "That brand kit is gone." };
    await copyKitFiles(kit, store.dir);
    try {
      const commit = store.commitAndBroadcast({
        author: "user",
        message: `Applied brand kit "${kit.name}"`,
        ops: kitOps(store.doc, kit),
      });
      return { ok: true, commit };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async removeKit(id: string): Promise<void> {
    await removeKit(id);
    const settings = await getSettings();
    if (settings.kit === id) await setSettings({ kit: "" });
  }

  // --- Inspirations ---------------------------------------------------------------------------------

  /** Built in, the user's own (theirs win over a built-in with the same id), and copies only this project has. */
  async listInspirations(): Promise<InspirationInfo[]> {
    const mine = await this.inspirations.list().catch((err) => {
      console.warn(`[inspirations] couldn't read the folder: ${(err as Error).message}`);
      return [] as InspirationInfo[];
    });
    const have = new Set(mine.map((i) => i.id));
    const builtin = STARTER_INSPIRATIONS.flatMap((p) => {
      const info = have.has(p.id) ? null : inspirationInfo(p.id, p.md, "builtin");
      if (info) have.add(p.id);
      return info ? [info] : [];
    });
    const project = (this.store?.doc.inspirations ?? []).flatMap((i) => {
      const info = have.has(i.id) ? null : inspirationInfo(i.id, i.md, "project");
      return info ? [info] : [];
    });
    return [...mine, ...builtin, ...project];
  }

  /** One by id: the user's own first, then a built-in, then the project's copy. */
  private async findInspiration(id: string): Promise<InspirationPack | null> {
    return (
      (await this.inspirations.get(id).catch(() => null)) ??
      STARTER_INSPIRATIONS.find((p) => p.id === id) ??
      (this.store ? packFromProject(this.store.doc, id) : null)
    );
  }

  async readInspiration(id: string): Promise<string | null> {
    return (await this.findInspiration(id))?.md ?? null;
  }

  async applyInspiration(id: string, keepLook: boolean): Promise<CommitResult> {
    const store = this.requireStore();
    const pack = await this.findInspiration(id);
    if (!pack) return { ok: false, error: "That inspiration is gone." };
    try {
      const label = `Inspiration: ${inspirationMeta(pack.md)?.name ?? id}`;
      const ops = inspirationOps(store.doc, pack, { keepLook });
      // One change the user can undo as a whole, not a chip per setting.
      const commit = store.commitAndBroadcast({
        author: "user",
        message: label,
        ops,
        groups: [{ label, ops: ops.map((_, i) => i) }],
      });
      return { ok: true, commit };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async stopInspiration(): Promise<CommitResult> {
    const store = this.requireStore();
    const ops = stopInspirationOps(store.doc);
    if (!ops.length) return { ok: false, error: "This project doesn't follow an inspiration." };
    try {
      return {
        ok: true,
        commit: store.commitAndBroadcast({
          author: "user",
          message: "Stopped following the inspiration",
          ops,
          groups: [{ label: "Stopped following the inspiration", ops: ops.map((_, i) => i) }],
        }),
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async saveInspiration(id: string): Promise<InspirationInfo> {
    const pack = packFromProject(this.requireStore().doc, id);
    if (!pack) throw new Error("This project has no copy of that inspiration.");
    return this.inspirations.save(pack);
  }

  async removeInspiration(id: string): Promise<void> {
    await this.inspirations.remove(id);
  }

  async revealInspirations(): Promise<void> {
    await shell.openPath(await this.inspirations.dir());
  }

  async openDemo(): Promise<ProjectSnapshot> {
    const dir = paths.demo();
    try {
      return await this.switchTo(await this.openStore(dir));
    } catch {
      await mkdir(dir, { recursive: true });
      return this.switchTo(await ProjectStore.create(dir, demoProject(), this.events(dir)));
    }
  }

  async recent(): Promise<RecentProject[]> {
    try {
      const list = JSON.parse(await readFile(paths.recent(), "utf8")) as RecentProject[];
      return list.filter((r) => existsSync(r.dir));
    } catch {
      return [];
    }
  }

  /**
   * Notes a project as opened. A new one goes to the top of the list; one already in it keeps its place
   * (the rail stays put as you switch around), with its time updated.
   */
  private remember(dir: string, name: string): Promise<void> {
    return this.updateRecent((list) => {
      const at = list.findIndex((r) => r.dir === dir);
      const entry = { ...list[at], dir, name, openedAt: Date.now() };
      if (at >= 0) list[at] = entry;
      else list.unshift(entry);
      return list.slice(0, 300);
    });
  }

  // --- Projects: folders of videos ------------------------------------------------------------------

  private async folderList(): Promise<FolderEntry[]> {
    try {
      const list = JSON.parse(await readFile(paths.folders(), "utf8")) as FolderEntry[];
      return list.filter((f) => isProjectFolder(f.dir));
    } catch {
      return [];
    }
  }

  private folderWrites: Promise<unknown> = Promise.resolve();

  /** Like the video list: one change at a time, written whole and renamed into place. */
  private updateFolders(change: (list: FolderEntry[]) => FolderEntry[]): Promise<void> {
    const run = this.folderWrites.then(async () => {
      const list = change(await this.folderList());
      const tmp = `${paths.folders()}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(list, null, 2));
      await rename(tmp, paths.folders());
    });
    this.folderWrites = run.catch(() => undefined);
    return run;
  }

  private async addFolder(dir: string): Promise<void> {
    const name = await projectName(dir);
    await this.updateFolders((list) =>
      list.some((f) => samePath(f.dir, dir)) ? list : [{ dir, name, addedAt: Date.now() }, ...list],
    );
  }

  /** A project in the sidebar (the window can't name any other folder). */
  private async knownFolder(raw: unknown): Promise<string> {
    const dir = z.string().max(4096).parse(raw);
    const found = (await this.folderList()).find((f) => samePath(f.dir, dir));
    if (!found) throw new Error("That project isn't in your sidebar.");
    return found.dir;
  }

  /**
   * The projects, each with its videos: the ones opened here and any others in its folder (made on
   * another computer, synced in). A video opened here inside a project's folder brings the project in.
   */
  async folders(): Promise<ProjectFolder[]> {
    const recent = await this.recent();
    let list = await this.folderList();
    const found = new Set<string>();
    for (const r of recent) {
      const parent = path.dirname(r.dir);
      if (!found.has(parent) && !list.some((f) => samePath(f.dir, parent)) && isProjectFolder(parent))
        found.add(parent);
    }
    if (found.size) {
      for (const dir of found) await this.addFolder(dir);
      list = await this.folderList();
    }
    return Promise.all(
      list.map(async (f) => {
        // Newest made first, and kept there: opening one doesn't move it.
        const onDisk = (await videosIn(f.dir)).sort((a, b) => b.createdAt - a.createdAt);
        const videos: RecentProject[] = onDisk.map((v) => {
          const seen = recent.find((r) => samePath(r.dir, v.dir));
          return {
            dir: seen?.dir ?? v.dir,
            name: seen?.name ?? v.name,
            openedAt: seen?.openedAt ?? v.changedAt,
            ...(seen?.pinned && { pinned: true }),
          };
        });
        return {
          dir: f.dir,
          name: await projectName(f.dir),
          ...(f.pinned && { pinned: true }),
          videos,
        };
      }),
    );
  }

  async newFolder(name: string): Promise<ProjectFolder> {
    const made = await makeProjectFolder(app.getPath("videos"), name.trim() || "Untitled project");
    await this.updateFolders((list) => [made, ...list]);
    return { dir: made.dir, name: made.name, videos: [] };
  }

  /** Pins a video or a project, or unpins it. */
  async pin(raw: unknown, rawPinned: unknown): Promise<void> {
    const dir = z.string().max(4096).parse(raw);
    const pinned = z.boolean().parse(rawPinned);
    const folders = await this.folderList();
    if (folders.some((f) => samePath(f.dir, dir))) {
      await this.updateFolders((list) =>
        list
          .map((f) => (samePath(f.dir, dir) ? { ...f, pinned } : f))
          .map(({ pinned: p, ...f }) => (p ? { ...f, pinned: p } : f)),
      );
      return;
    }
    const video = await this.listed(dir);
    const name = (await videosIn(path.dirname(video))).find((v) => samePath(v.dir, video))?.name;
    await this.updateRecent((list) => {
      const at = list.findIndex((r) => samePath(r.dir, video));
      // A video found in a project's folder but never opened here joins the list to keep its pin.
      const entry =
        at >= 0 ? list[at]! : { dir: video, name: name ?? path.basename(video), openedAt: Date.now() };
      const { pinned: _, ...rest } = entry;
      const next = pinned ? { ...rest, pinned: true } : rest;
      if (at >= 0) list[at] = next;
      else list.push(next);
      return list;
    });
  }

  /**
   * Renames a video or a project. A video takes the name as its edit's name (project.json, as the title
   * bar renames it): in its open copy when it's open or Claude works in it, else opened just for that.
   */
  async rename(raw: unknown, rawName: unknown): Promise<void> {
    const dir = z.string().max(4096).parse(raw);
    const name = z.string().trim().min(1).max(200).parse(rawName);
    const folder = (await this.folderList()).find((f) => samePath(f.dir, dir));
    if (folder) {
      const clean = await renameProject(folder.dir, name);
      await this.updateFolders((list) => list.map((f) => (samePath(f.dir, dir) ? { ...f, name: clean } : f)));
      return;
    }
    const video = await this.listed(dir);
    const ops: Op[] = [{ op: "merge", key: "meta", patch: { name } }];
    const live = this.store && samePath(this.store.dir, video) ? this.store : this.background.get(video);
    if (live) {
      const commit = live.commitAndBroadcast({ author: "user", message: `Renamed to ${name}`, ops });
      if (live === this.store) this.renamed(commit);
      else await this.updateRecent((list) => list.map((r) => (samePath(r.dir, video) ? { ...r, name } : r)));
      return;
    }
    await this.closing.get(video);
    const store = await ProjectStore.open(video, this.events(video));
    store.commit({ author: "user", message: `Renamed to ${name}`, ops });
    await store.flush();
    await store.close();
    await this.updateRecent((list) => list.map((r) => (samePath(r.dir, video) ? { ...r, name } : r)));
  }

  /**
   * Moves a video into a project's folder, or out of one into the videos folder. The open one is closed,
   * moved and opened again where it is now (its chat and history go with it). Files it owns (attachments,
   * converted photos, stock) moved with it: the edit points at them there. Not while Claude works in it.
   */
  async move(raw: unknown, rawFolder: unknown): Promise<{ dir: string; snapshot: ProjectSnapshot | null }> {
    const video = await this.listed(raw);
    const to = rawFolder ? await this.knownFolder(rawFolder) : app.getPath("videos");
    if (samePath(path.dirname(video), to)) return { dir: video, snapshot: null };
    if (this.background.has(video) || [...this.asked.values()].some((a) => samePath(a.dir, video)))
      throw new Error("Claude is working in that video. Move it when it's done.");
    const wasOpen = this.store !== null && samePath(this.store.dir, video);
    if (wasOpen) {
      this.indexer.reset();
      this.exporter.stop();
      await this.store?.close();
      this.store = null;
      // What was writing into it (a proxy, a render, a thumbnail) winds down first: its files must be
      // free to move (Windows won't move a folder with a file open in it).
      await Promise.all([this.indexer.settled(), this.exporter.settled(), this.thumbs]);
    }
    await this.closing.get(video);
    let moved: string;
    try {
      moved = await moveVideo(video, to);
    } catch (err) {
      if (wasOpen) await this.switchTo(await this.openStore(video));
      throw err;
    }
    await this.updateRecent((list) => list.map((r) => (samePath(r.dir, video) ? { ...r, dir: moved } : r)));
    const store = await ProjectStore.open(moved, this.events(moved));
    const ops = relinkOps(store.doc, video, moved);
    if (ops.length) store.commit({ author: "index", message: "Moved with its folder", ops });
    if (wasOpen) return { dir: moved, snapshot: await this.switchTo(store) };
    await store.flush();
    await store.close();
    return { dir: moved, snapshot: null };
  }

  private recentWrites: Promise<unknown> = Promise.resolve();

  /**
   * Changes the project list one change at a time (two at once would each drop the other's), written
   * whole to a temporary file and renamed into place, so a read never sees half of it.
   */
  private updateRecent(change: (list: RecentProject[]) => RecentProject[]): Promise<void> {
    const run = this.recentWrites.then(async () => {
      const list = change(await this.recent());
      const tmp = `${paths.recent()}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(list, null, 2));
      await rename(tmp, paths.recent());
    });
    this.recentWrites = run.catch(() => undefined);
    return run;
  }

  // --- The project list: thumbnails, copies, the Trash -----------------------------------------------

  /** A project from the user's list (the window can't name any other folder). */
  private async listed(raw: unknown): Promise<string> {
    const dir = z.string().max(4096).parse(raw);
    if ((await this.recent()).some((r) => r.dir === dir)) return dir;
    // A video in one of the projects (made elsewhere, never opened here), or a project itself.
    const folders = await this.folderList();
    if (folders.some((f) => samePath(f.dir, dir))) return dir;
    const home = projectOf(dir, folders);
    if (home && (await videosIn(home.dir)).some((v) => samePath(v.dir, dir))) return dir;
    throw new Error("That video isn't in your sidebar.");
  }

  private thumbs: Promise<unknown> = Promise.resolve();
  private thumbTimer: NodeJS.Timeout | null = null;

  /** One at a time: a list of projects asks for all of theirs at once. */
  private queueThumb<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.thumbs.then(fn, fn);
    this.thumbs = run.catch(() => undefined);
    return run;
  }

  async thumbnail(raw: unknown): Promise<string | null> {
    const dir = await this.listed(raw);
    return this.queueThumb(async () => {
      if (!existsSync(thumbFile(dir))) {
        const doc = this.store?.dir === dir ? this.store.doc : await readTimeline(dir).catch(() => null);
        if (!doc || !(await makeThumbnail(dir, doc).catch(() => false))) return null;
      }
      return `data:image/jpeg;base64,${(await readFile(thumbFile(dir))).toString("base64")}`;
    });
  }

  /** The open project's thumbnail, made again a moment after its shots change. */
  private refreshThumbnail(delayMs = 3000): void {
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => {
      const store = this.store;
      if (!store) return;
      void this.queueThumb(() => makeThumbnail(store.dir, store.doc))
        .then((made) => {
          if (made) this.emit("thumbnail", { dir: store.dir });
        })
        .catch((err: Error) => console.warn(`[thumbnail] ${err.message}`));
    }, delayMs);
  }

  /** A rename (in the title bar, by Claude, in project.json): the project list takes the new name. */
  private renamed(commit: Commit): void {
    const renamed = commit.ops.some((op) => op.op === "merge" && op.key === "meta" && "name" in op.patch);
    if (renamed && this.store) void this.remember(this.store.dir, this.store.doc.meta.name);
  }

  private shotsChanged(commit: Commit): void {
    if (commit.ops.some((op) => "coll" in op && op.coll === "scenes")) this.refreshThumbnail();
  }

  /** A copy of a project beside it, opened: of its edit, or of just its footage to start again. */
  async duplicate(rawDir: unknown, rawFrom: unknown): Promise<ProjectSnapshot> {
    const dir = await this.listed(rawDir);
    const from = z.enum(["edit", "footage"]).parse(rawFrom);
    const open = this.store?.dir === dir ? this.store : (this.background.get(dir) ?? null);
    await open?.flush();
    const name =
      open?.doc.meta.name ?? (await this.recent()).find((r) => r.dir === dir)?.name ?? path.basename(dir);
    // Names are at most 200 characters; the suffix always fits.
    const label = `${name.slice(0, 160)}${from === "edit" ? " copy" : " from footage"}`;
    const target = await freeDir(path.join(path.dirname(dir), sanitize(label)));
    await copyProject(dir, target);
    try {
      const next = await ProjectStore.open(target, this.events(target));
      const ops: Op[] = [
        { op: "merge", key: "meta", patch: { name: label } },
        // Files the project owns (attachments, stock, sounds) were copied with it: the copy uses its own.
        ...relinkOps(next.doc, dir, target),
        ...(from === "footage" ? footageOps(target, relinked(next.doc, dir, target)) : []),
      ];
      next.commit({
        author: "user",
        message: from === "edit" ? `Copied from ${name}` : `Started again from the footage of ${name}`,
        ops,
      });
      // On disk before the window reads the history, so the change is in its undo.
      await next.flush();
      return await this.switchTo(next);
    } catch (err) {
      // Nothing half-made left behind, unlisted.
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Moves a project's folder to the Trash (the system's, so it can be put back) and drops it from the
   * list. The open one is closed first, and the next most recent opens in its place.
   */
  async trash(raw: unknown): Promise<ProjectSnapshot | null> {
    const dir = await this.listed(raw);
    const wasOpen = this.store?.dir === dir;
    // Claude stops working in it, on screen or in the background.
    for (const [runId, a] of this.asked) if (a.dir === dir) this.runs.get(runId)?.abort();
    const kept = this.background.get(dir);
    if (kept) {
      this.background.delete(dir);
      await kept.close();
    }
    if (wasOpen) {
      this.indexer.reset();
      this.exporter.stop();
      await this.store?.close();
      this.store = null;
      // What was writing into it (a proxy, a render, a thumbnail) winds down first, or it would make
      // the folder again after it's gone.
      await Promise.all([this.indexer.settled(), this.exporter.settled(), this.thumbs]);
    }
    try {
      await shell.trashItem(dir);
    } catch (err) {
      // Not trashed (no Trash on that drive, no permission): the project stays open, as it was.
      if (wasOpen) await this.switchTo(await this.openStore(dir));
      throw err;
    }
    await this.updateRecent((list) => list.filter((r) => r.dir !== dir));
    return wasOpen ? this.restore() : null;
  }

  async showProject(raw: unknown): Promise<void> {
    await shell.openPath(await this.listed(raw));
  }

  async commit(raw: unknown): Promise<CommitResult> {
    const req = CommitRequestSchema.parse(raw);
    const store = this.requireStore();
    try {
      const { commit } = store.commit({
        author: "user",
        ops: req.ops,
        ...(req.message && { message: req.message }),
        ...(req.groups && { groups: req.groups }),
        ...(req.reverts && { reverts: req.reverts }),
      });
      this.shotsChanged(commit);
      this.renamed(commit);
      return { ok: true, commit };
    } catch (err) {
      if (!(err instanceof OpError)) throw err;
      // The window's copy has drifted from ours. Hand it the truth.
      this.emit("reload", await this.snapshot());
      return { ok: false, error: err.message };
    }
  }

  /**
   * Adds clips in place (nothing is copied): every video goes on the timeline whole, so nothing is lost
   * before the agent makes the first cut; photos hold 2 seconds; the first song becomes the music.
   */
  /** Sources still pointing into a temporary folder (from before imports copied them): copy them in. */
  private async rescueTemporary(store: ProjectStore): Promise<void> {
    const ops: Op[] = [];
    for (const s of store.doc.sources) {
      if (!s.path || !isTemporary(s.path) || !existsSync(s.path)) continue;
      const kept = await keepCopy(s.path, store.dir).catch(() => null);
      if (kept) ops.push({ op: "update", coll: "sources", id: s.id, patch: { path: kept } });
    }
    if (ops.length)
      store.commitAndBroadcast({ author: "index", message: "Kept copies of temporary files", ops });
  }

  /**
   * Photos and sounds the app can't show or play, from before it converted them on the way in (an
   * iPhone's HEIC, AIFF): converted now, in the background, and the clips pointed at the copies.
   */
  private async convertUnplayable(store: ProjectStore): Promise<void> {
    const ops: Op[] = [];
    for (const s of store.doc.sources) {
      if (!s.path || (s.kind !== "image" && s.kind !== "audio") || !existsSync(s.path)) continue;
      try {
        const file = await playableCopy(s.path, path.join(store.dir, CONVERTED_DIR));
        if (file === s.path) continue;
        const p = await probe(file);
        ops.push({
          op: "update",
          coll: "sources",
          id: s.id,
          patch: { path: file, ...(p.width && p.height && { width: p.width, height: p.height }) },
        });
      } catch (err) {
        console.warn(`[convert] ${s.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    // Still open (on screen, or working in the background).
    if (ops.length && (this.store === store || this.background.get(store.dir) === store))
      store.commitAndBroadcast({ author: "index", message: "Converted photos and sounds to play here", ops });
  }

  /** The system file picker for clips (video, audio, photos), then an ordinary import. */
  async pickAndImport(): Promise<CommitResult | null> {
    this.requireStore();
    const win = this.window();
    const options = {
      title: "Import clips",
      buttonLabel: "Import",
      properties: ["openFile" as const, "multiSelections" as const],
      defaultPath: this.lastImportDir ?? app.getPath("downloads"),
      filters: [
        {
          name: "Video, audio and photos",
          extensions: MEDIA_EXTENSIONS,
        },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return null;
    this.lastImportDir = path.dirname(result.filePaths[0]!);
    return this.importFiles(result.filePaths);
  }

  private lastImportDir: string | null = null;

  /** The asset library's file picker: copies the picked files into the library or the project's assets/. */
  async pickLibraryFiles(scope: "library" | "project"): Promise<void> {
    const win = this.window();
    const options = {
      title: scope === "project" ? "Add to this project's assets" : "Add to your library",
      buttonLabel: "Add",
      properties: ["openFile" as const, "multiSelections" as const],
      defaultPath: this.lastImportDir ?? app.getPath("downloads"),
      filters: [{ name: "Sounds, music, images and clips", extensions: MEDIA_EXTENSIONS }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return;
    this.lastImportDir = path.dirname(result.filePaths[0]!);
    await this.library.add(result.filePaths, scope);
  }

  /** Moves the shared library to a folder picked in Finder. */
  async pickLibraryDir(): Promise<void> {
    const win = this.window();
    const options = {
      title: "Choose where your asset library lives",
      buttonLabel: "Use this folder",
      properties: ["openDirectory" as const, "createDirectory" as const],
      defaultPath: this.library.state().dir,
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const dir = result.filePaths[0];
    if (result.canceled || !dir) return;
    await setSettings({ libraryDir: dir });
    await this.library.setLibraryDir(dir);
  }

  /**
   * Copies clips the project uses into the shared library (songs, sounds, images, short clips; footage
   * stays the project's), so every project can use them. Returns the new assets' ids.
   */
  async keepInLibrary(ids: readonly string[], doc: ProjectDoc = this.requireStore().doc): Promise<string[]> {
    const files = ids
      .map((id) => doc.sources.find((s) => s.id === id))
      .filter((s): s is Source => s !== undefined && keepable(s) && existsSync(s.path ?? ""))
      .map((s) => s.path!);
    if (!files.length) throw new Error("Only songs, sounds, images and short clips go in the library.");
    const added = await this.library.add(files, "library");
    return added.map((f) => assetId(f, "library"));
  }

  /**
   * A library asset in the project, as a clip: copied into media/library/ (a project's own assets/ are
   * already in it), so the project keeps working wherever it goes. The ops add the clip; placing it is
   * up to the caller.
   */
  async assetSource(
    id: string,
    doc: ProjectDoc,
    store: ProjectStore = this.requireStore(),
  ): Promise<{ ops: Op[]; id: string; asset: AssetEntry }> {
    const asset = this.library.asset(id);
    const file = this.library.resolve(id);
    if (!asset || !file) throw new Error(`No asset "${id}" in the library.`);
    let target = file;
    if (asset.scope === "library") {
      const dir = path.join(store.dir, "media", "library");
      await mkdir(dir, { recursive: true });
      target = path.join(dir, path.basename(file));
      const there = await stat(target).catch(() => null);
      // Another asset with the same file name: keep both.
      if (there && there.size !== (await stat(file)).size)
        target = path.join(dir, `${id.replace(/[^a-z0-9]+/gi, "-")}${path.extname(file)}`);
      if (!(await stat(target).catch(() => null))) await copyFile(file, target);
    }
    const origin = { url: "", provider: "library", license: "", author: "" };
    const made = fetchedSourceOps(
      doc,
      await probeIn(target, store.dir),
      asset.name,
      origin,
      asset.description || asset.name,
    );
    return { ...made, asset };
  }

  /**
   * The Library tab's "+": the asset at a time in the edit, as one undoable change. A sound plays there,
   * a track becomes the music, a meme shows over the video for a few seconds (a see-through one as a sticker).
   */
  async placeAsset(id: string, at: number): Promise<CommitResult> {
    const store = this.requireStore();
    const doc = store.doc;
    const { ops, id: source, asset } = await this.assetSource(id, doc);
    const tl = timelineOf(doc);
    const anchor = anchorAt(tl, Math.min(Math.max(0, at), Math.max(0, tl.duration - 0.05)));
    if (!anchor && asset.kind !== "music") return { ok: false, error: "Add a clip to the timeline first." };
    if (asset.kind === "sound")
      ops.push({
        op: "insert",
        coll: "sfx",
        item: { id: nextId("sfx_", doc.sfx), anchor: anchor!, source, volume: 0.8 },
      });
    else if (asset.kind === "music")
      ops.push({ op: "merge", key: "music", patch: { source, label: asset.name, offset: 0, section: null } });
    else
      ops.push({
        op: "insert",
        coll: "visuals",
        item: {
          id: nextId("v_", doc.visuals),
          anchor: anchor!,
          duration: Math.min(4, Math.max(1.5, asset.duration ?? 2.5)),
          layout: "overlay",
          content: {
            kind: "media",
            source,
            in: 0,
            loop: true,
            box: { x: 0.5, y: 0.3, width: asset.alpha ? 0.42 : 0.62 },
            rotate: 0,
            style: asset.alpha ? "sticker" : "card",
          },
        },
      });
    try {
      const commit = store.commitAndBroadcast({ author: "user", message: `Added ${asset.name}`, ops });
      this.indexer.enqueue(store.doc.sources.filter((s) => s.status === "pending").map((s) => s.id));
      return { ok: true, commit };
    } catch (err) {
      if (!(err instanceof OpError)) throw err;
      return { ok: false, error: err.message };
    }
  }

  async importFiles(raw: unknown): Promise<CommitResult> {
    const store = this.requireStore();
    const files = await Promise.all(
      (
        await expandFolders(
          z
            .array(z.string())
            .max(1000)
            .parse(raw)
            .filter((p) => path.isAbsolute(p)),
        )
      ).map((f) => keepCopy(f, store.dir)),
    );
    if (!files.length) return { ok: false, error: "No video, photo or audio files in that drop." };
    const probed = await Promise.all(files.map((f) => probeIn(f, store.dir).catch((err: Error) => err)));
    const ok = probed.filter((p): p is Probed => !(p instanceof Error));
    const failures = probed.filter((p): p is Error => p instanceof Error);
    if (!ok.length) return { ok: false, error: failures[0]?.message ?? "Could not read those files." };

    // Read and probed while another project may have opened: the clips go to the one they were dropped on.
    if (this.store !== store)
      return { ok: false, error: "The project changed while those clips were being read." };
    const doc = store.doc;
    const demo = doc.sources.length > 0 && doc.sources.every((s) => s.kind === "solid");
    const firstImport = doc.scenes.length === 0 || demo;
    const known = new Set(doc.sources.map((s) => s.path));
    const ops: Op[] = [];
    // Real footage dropped into the demo replaces the stand-ins.
    if (demo) {
      for (const s of doc.scenes) ops.push({ op: "remove", coll: "scenes", id: s.id });
      for (const coll of ["zooms", "captions", "titles", "sfx", "comments"] as const)
        for (const item of doc[coll]) ops.push({ op: "remove", coll, id: item.id });
    }
    const sources: { id: string }[] = [...doc.sources];
    const scenes: { id: string }[] = demo ? [] : [...doc.scenes];
    const added: string[] = [];
    let music = doc.music.source;
    for (const p of ok.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""))) {
      if (known.has(p.path)) continue;
      const id = nextId("clip_", sources);
      sources.push({ id });
      const source: Source = {
        ...p,
        id,
        color: SWATCHES[sources.length % SWATCHES.length]!,
        status: p.kind === "image" ? "ready" : "pending",
        proxy: false,
        speech: false,
        summary: "",
        tags: [],
      };
      ops.push({ op: "insert", coll: "sources", item: source });
      added.push(id);
      if (source.kind === "audio") {
        if (!music) {
          music = id;
          ops.push({ op: "merge", key: "music", patch: { source: id, label: source.label } });
        }
        continue;
      }
      const length = source.kind === "image" ? 2 : source.duration;
      if (length <= 0.05) continue;
      const sceneId = nextId("sc", scenes);
      scenes.push({ id: sceneId });
      const scene: Scene = { id: sceneId, source: id, in: 0, out: round(length), note: "", volume: 1 };
      ops.push({ op: "insert", coll: "scenes", item: scene });
    }
    if (!added.length) return { ok: false, error: "Those clips are already in the project." };
    const n = added.length;
    const commit = store.commitAndBroadcast({
      author: "user",
      message: `Imported ${n} ${n === 1 ? "clip" : "clips"}`,
      ops,
      groups: [{ label: `+${n} ${n === 1 ? "clip" : "clips"} imported`, ops: ops.map((_, i) => i) }],
    });
    this.indexer.enqueue(
      added.filter((id) => store.doc.sources.find((s) => s.id === id)?.status === "pending"),
      { firstImport },
    );
    if (failures.length)
      this.emit("error", { message: `${failures.length} files could not be read: ${failures[0]!.message}` });
    return { ok: true, commit };
  }

  /**
   * Reference media for one request: into the library and indexed, but not onto the timeline (the agent
   * places it where the user says). A file already in the project is reused.
   */
  async attach(raw: unknown): Promise<AttachResult> {
    const files = z
      .array(z.string())
      .max(10)
      .parse(raw)
      .filter((p) => path.isAbsolute(p));
    return this.attachTo(this.requireStore(), files);
  }

  /** Attaches to the project the request came in for, never to one opened while the files were read. */
  private async attachTo(store: ProjectStore, files: string[]): Promise<AttachResult> {
    if (!files.length) return { ok: false, error: "Nothing to attach." };
    for (let i = 0; i < files.length; i++) files[i] = await keepCopy(files[i]!, store.dir);
    const probed = await Promise.all(files.map((f) => probeIn(f, store.dir).catch((err: Error) => err)));
    const failed = probed.find((p): p is Error => p instanceof Error);
    if (failed) return { ok: false, error: `Couldn't read that file: ${failed.message}` };
    const doc = store.doc;
    const sources: { id: string }[] = [...doc.sources];
    const ids: string[] = [];
    const ops: Op[] = [];
    for (const p of probed as Probed[]) {
      const existing = doc.sources.find((s) => s.path === p.path);
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const id = nextId("clip_", sources);
      sources.push({ id });
      ids.push(id);
      const source: Source = {
        ...p,
        id,
        color: SWATCHES[sources.length % SWATCHES.length]!,
        status: p.kind === "image" ? "ready" : "pending",
        proxy: false,
        speech: false,
        summary: "",
        tags: [],
      };
      ops.push({ op: "insert", coll: "sources", item: source });
    }
    if (this.store !== store)
      return { ok: false, error: "The project changed while that file was being added." };
    if (ops.length) {
      const n = ops.length;
      const label = n === 1 ? `Attached ${(probed[0] as Probed).label}` : `Attached ${n} files`;
      store.commitAndBroadcast({
        author: "user",
        message: label,
        ops,
        groups: [{ label, ops: ops.map((_, i) => i) }],
      });
      this.indexer.enqueue(
        ids.filter((id) => store.doc.sources.find((s) => s.id === id)?.status === "pending"),
        { firstImport: false },
      );
    }
    return { ok: true, sources: ids };
  }

  /** A pasted screenshot or other media without a file: saved into media/attachments/, then attached. */
  async attachData(rawName: unknown, rawBytes: unknown): Promise<AttachResult> {
    const store = this.requireStore();
    const name = z.string().max(200).parse(rawName);
    const bytes = z.instanceof(Uint8Array).parse(rawBytes);
    if (bytes.byteLength > 500 * 1024 * 1024) return { ok: false, error: "That file is over 500 MB." };
    const ext = (path.extname(name).toLowerCase() || ".png").replace(/[^.a-z0-9]/g, "");
    const stem =
      path
        .basename(name, path.extname(name))
        .replace(/[^\w.-]+/g, "-")
        .slice(0, 60) || "attachment";
    const dir = path.join(store.dir, ATTACHMENTS_DIR);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${stem}-${Date.now().toString(36)}${ext}`);
    await writeFile(file, bytes);
    return this.attachTo(store, [file]);
  }

  async reveal(relative?: unknown): Promise<void> {
    const store = this.requireStore();
    if (typeof relative !== "string" || !relative) {
      await shell.openPath(store.dir);
      return;
    }
    const file = path.resolve(store.dir, relative);
    if (file.startsWith(store.dir + path.sep)) shell.showItemInFolder(file);
  }

  /** Only files inside the open project (exports) can be shown. */
  async showFile(file: unknown): Promise<void> {
    const store = this.requireStore();
    if (typeof file !== "string") return;
    const abs = path.resolve(file);
    if (abs.startsWith(store.dir + path.sep) && existsSync(abs)) shell.showItemInFolder(abs);
  }

  async loadChat(): Promise<ChatRecord[]> {
    const store = this.requireStore();
    try {
      return JSON.parse(await readFile(path.join(store.dir, CHAT_LOG), "utf8")) as ChatRecord[];
    } catch {
      return [];
    }
  }

  async saveChat(records: unknown, rawDir?: unknown): Promise<void> {
    if (!Array.isArray(records)) return;
    // A conversation Claude carried on in the background goes to its own project.
    const dir =
      typeof rawDir === "string" && rawDir !== this.store?.dir
        ? await this.listed(rawDir)
        : this.requireStore().dir;
    const file = path.join(dir, CHAT_LOG);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(records.slice(-300)));
  }

  async agentSettings(): Promise<AgentSettings> {
    const s = await getSettings();
    // Which Claude Code to run (found at startup; this waits for it), looked at again when it wasn't
    // signed in then: someone may have signed in since, in their own terminal. Always the subscription
    // for now: the API-key backend is switched off (defaultBackend).
    if (s.harness === "codex") {
      if ((await codexStatus()).signedIn !== true) await codexStatus(true);
    } else if ((await claudeStatus()).signedIn !== true) await claudeStatus(true);
    return {
      backend: defaultBackend(),
      harness: s.harness,
      model: s.harness === "codex" ? s.codexModel : s.model,
      effort: s.effort,
      showThinking: s.showThinking,
    };
  }

  async agentStatus(): Promise<AgentStatus> {
    const s = await this.agentSettings();
    const k = await getSettings();
    // Keys come from Settings only: each person brings their own.
    return {
      backend: s.backend,
      model: s.model,
      apiKey: false,
      keys: {
        klipy: k.klipyKey ? "saved" : null,
        pexels: k.pexelsKey ? "saved" : null,
        pixabay: k.pixabayKey ? "saved" : null,
        groq: k.groqKey ? "saved" : null,
      },
    };
  }

  /** What the agent can ask of the machine: frames of footage, and music from the web. */
  /** What the agent can ask of the machine, for a request in `store`'s project (on screen or not). */
  private agentHost(store: ProjectStore): AgentHost {
    // In the background, the library's "project" assets are the open project's: only the shared ones.
    const here = () => store === this.store;
    return {
      frame: async (sourceId, time, width) => {
        const src = store.doc.sources.find((s) => s.id === sourceId);
        if (!src?.path) throw new Error("no such clip");
        const proxy = cachePaths(store.dir, sourceId).proxy;
        // The 540p proxy is quicker; a wider frame (an attached screenshot) needs the original.
        return grabFrame(
          existsSync(proxy) && (width ?? 512) <= 540 ? proxy : src.path,
          Math.min(time, Math.max(0, src.duration - 0.05)),
          width,
        );
      },
      // Faces and people tracked over a stretch of a clip's preview copy, split at its shot changes.
      track: async (sourceId, from, to, idPrefix) => {
        const proxy = cachePaths(store.dir, sourceId).proxy;
        const src = store.doc.sources.find((s) => s.id === sourceId);
        if (!src?.path) throw new Error("no such clip");
        const cuts = store.doc.analyses.find((a) => a.id === sourceId)?.shots ?? [];
        const tracks = await trackRange(existsSync(proxy) ? proxy : src.path, from, to, { cuts, idPrefix });
        return tracks.map((t) => ({ ...t, points: [...t.points] }));
      },
      // What the agent sees of its own edit: rendered from the scratch doc, over the fast proxies.
      stills: async (doc, times, options) => {
        const { images, errors } = await renderStills({
          doc,
          entry: renderEntry(),
          times,
          ...(options?.composition && { composition: options.composition }),
          ...(options?.scale && { scale: options.scale }),
          // The agent's working copy, not the saved project: it may hold clips it just added.
          resolve: (key) => this.resolveIn(doc, key.replace(/\?.*$/, ""), "proxy", store),
        });
        return { images: [...images], errors: [...errors] };
      },
      keepPicture: async (jpeg) => {
        const name = `looks/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.jpg`;
        await mkdir(path.join(store.dir, CACHE_DIR, "looks"), { recursive: true });
        await writeFile(path.join(store.dir, CACHE_DIR, name), jpeg);
        return name;
      },
      findMusic: async (mood, doc) => {
        const found = await findMusic(mood, {
          targetDir: path.join(store.dir, "music"),
          cacheDir: paths.cache(),
        });
        if (!found) return null;
        return { ops: musicOps(doc, found), title: found.title, bpm: found.beats.bpm };
      },
      peaks: (id, doc) => this.indexer.peaksNow(id, doc, store.dir),
      // A second listen to a stretch the first pass missed or misheard (singing, music over the voice).
      transcribe: async (sourceId, from, to, { text, hint }) => {
        const src = store.doc.sources.find((s) => s.id === sourceId);
        if (!src?.path) throw new Error("no such clip");
        const settings = await getSettings();
        const setup = whisperSetup(settings);
        // A second and a half either side: started mid-word, the recognizer misses what follows (measured:
        // a sung line heard in full from a second's lead-in, not at all from 0.4s).
        const lo = Math.max(0, from - 1.5);
        const hi = Math.min(src.duration, to + 1.5);
        const wav = path.join(
          store.dir,
          CACHE_DIR,
          "audio",
          `${sourceId}.part.${process.pid}.${Date.now()}.wav`,
        );
        try {
          await extractSpeechWav(src.path, wav, undefined, { from: lo, to: hi });
          await ensureWhisper(setup);
          // The words when they're known, so the recognizer hears what's there: then they're timed to it.
          const prompt = text ?? hint;
          const { words } = await transcribeWords(wav, setup, {
            glossary: settings.glossary,
            ...(prompt && { prompt }),
          });
          const heard = words
            .map((w) => ({ ...w, start: round3(w.start + lo), end: round3(w.end + lo) }))
            .filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 <= to);
          return text ? alignText(text, heard, from, to) : heard;
        } finally {
          await rm(wav, { force: true });
        }
      },
      library: {
        search: async () => {
          const all = await this.library.entries();
          return here() ? all : { ...all, assets: all.assets.filter((e) => e.scope === "library") };
        },
        use: async (id, doc) => {
          if (!here() && this.library.asset(id)?.scope !== "library")
            throw new Error("That asset is in another project's assets/: only the shared library is here.");
          const { ops, id: source } = await this.assetSource(id, doc, store);
          return { ops, id: source };
        },
        update: (id, patch) => this.library.update(id, patch),
        setRole: (role, id) => this.library.setRole(role, id),
        keep: (ids, doc) => this.keepInLibrary(ids, doc),
      },
      kits: {
        list: () => listKits(),
        save: (doc, name, id) => saveKit(doc, store.dir, name, id),
        apply: async (id, doc) => {
          const kit = await getKit(id);
          if (!kit) return null;
          await copyKitFiles(kit, store.dir);
          return { ops: kitOps(doc, kit), name: kit.name };
        },
        remember: (id, note) => rememberInKit(id, note),
      },
      inspirations: {
        list: () => this.inspirations.list(),
        get: (id) => this.inspirations.get(id),
        save: (pack) => this.inspirations.save(pack),
      },
      // Off macOS the agent's cutout tool says they aren't available here.
      ...(cutoutsAvailable() && {
        cutouts: async (doc: ProjectDoc) => makeNeededCutouts(store.dir, doc),
      }),
      footage: async (doc: ProjectDoc) => makeNeededFootage(store.dir, doc),
      findStock: async (query, kind, orientation) => {
        const settings = await getSettings();
        const keys = {
          pexels: settings.pexelsKey,
          pixabay: settings.pixabayKey,
        };
        const candidates = await searchStock(query, { kind, orientation, keys });
        return { candidates, sheet: candidates.length ? await stockSheet(candidates) : null };
      },
      senseMotion: (doc) => this.senseMotion(doc, store),
      measureJoins: (doc) => this.measureJoins(doc, store),
      findSounds: (query, maxSeconds) => findSounds(query, { maxSeconds }),
      addSound: async (c, label, doc) => {
        const file = await downloadSound(c, path.join(store.dir, "media", "sounds"));
        const { hit, tail } = await soundHit(file);
        const origin = {
          url: c.page,
          provider: "freesound",
          license: c.license,
          author: c.credit ? c.author : "",
        };
        return {
          ...fetchedSourceOps(doc, await probeIn(file, store.dir), label, origin, c.title),
          hit,
          tail,
        };
      },
      addStock: async (c, label, doc) => {
        const file = await downloadStock(c, path.join(store.dir, "media", "stock"));
        const origin = {
          url: c.page,
          provider: c.provider,
          license: STOCK_LICENSE[c.provider],
          author: c.author,
        };
        return fetchedSourceOps(doc, await probeIn(file, store.dir), label, origin, c.about);
      },
      findMemes: async (query, kind) => {
        const settings = await getSettings();
        const key = settings.klipyKey;
        // KLIPY asks for a stable, anonymous id per user: made once, kept in settings.
        let customerId = settings.klipyUser;
        if (!customerId) {
          customerId = randomUUID();
          await setSettings({ klipyUser: customerId });
        }
        const candidates = await searchMemes(query, { kind, key, customerId });
        return { candidates, sheet: candidates.length ? await stockSheet(candidates) : null };
      },
      addMeme: async (c, label, doc) => {
        const file = await downloadMeme(c, path.join(store.dir, "media", "memes"));
        const origin = { url: c.page, provider: "klipy", license: "KLIPY", author: "" };
        return fetchedSourceOps(doc, await probe(file), label, origin, c.title);
      },
      makeMedia: async (recipe, name, doc) => {
        const file = await makeProcessed({
          inputs: processInputs(recipe, doc),
          graph: recipe.graph,
          kind: recipe.kind,
          ...(recipe.alpha && { alpha: true }),
          dir: path.join(store.dir, "media", "processed"),
        });
        return processedSourceOps(doc, await probe(file), recipe, name);
      },
      measureMedia: (recipe, doc) =>
        measureProcessed({ inputs: processInputs(recipe, doc), graph: recipe.graph }),
      capturePage: async (url, o, doc) => {
        const got = await capturePage(url, path.join(store.dir, "media", "captures"), o);
        const origin = { url: got.url, provider: "web", license: "", author: new URL(got.url).hostname };
        const { ops, id } = fetchedSourceOps(doc, await probe(got.file), o.label, origin, got.title);
        // What the model looks at: a JPEG, small enough to read the headline.
        const image = nativeImage.createFromPath(got.file).resize({ width: 640 }).toJPEG(80);
        return { ops, id, image, title: got.title, found: got.found };
      },
    };
  }

  private cutoutTimer: ReturnType<typeof setTimeout> | undefined;
  private cutoutRun: Promise<void> = Promise.resolve();

  /**
   * After edits settle: make any cutout the project now needs (a background change, something behind
   * the subject), then any steadied or slowed shot's footage, one job at a time, and record them so they
   * switch on.
   */
  private scheduleCutouts(): void {
    clearTimeout(this.cutoutTimer);
    this.cutoutTimer = setTimeout(() => {
      this.cutoutRun = this.cutoutRun.then(async () => {
        const store = this.store;
        if (!store) return;
        try {
          const ops = await makeNeededCutouts(store.dir, store.doc, {
            onProgress: (source, fraction) =>
              this.emit("index", { source, stage: "analyze", fraction, label: "Cutting out the person" }),
          });
          for (const id of new Set(store.doc.scenes.map((s) => s.source)))
            if (ops.some((o) => o.op === "update" && o.id === id))
              this.emit("index", { source: id, stage: "ready", fraction: 1, label: "Ready" });
          if (ops.length && this.store === store)
            store.commitAndBroadcast({ author: "index", message: "Cut out the person", ops });
        } catch (err) {
          console.error("[cutout] failed:", err);
          this.emit("error", { message: `Couldn't cut out the person: ${(err as Error).message}` });
        }
        // Then steadied and slowed shots (after the cutouts' record, so each sees the other's).
        if (this.store !== store) return;
        try {
          const touched = new Set<string>();
          const ops = await makeNeededFootage(store.dir, store.doc, {
            onProgress: (source, fraction, label) => {
              touched.add(source);
              this.emit("index", { source, stage: "analyze", fraction, label });
            },
          });
          for (const id of touched)
            this.emit("index", { source: id, stage: "ready", fraction: 1, label: "Ready" });
          if (ops.length && this.store === store)
            store.commitAndBroadcast({ author: "index", message: "Steadied and smoothed shots", ops });
        } catch (err) {
          console.error("[footage] failed:", err);
          this.emit("error", { message: `Couldn't steady or smooth a shot: ${(err as Error).message}` });
        }
        if (this.store !== store) return;
        const separating = new Set<string>();
        try {
          const ops = await makeNeededStems(store.dir, store.doc, {
            onProgress: (source, fraction) => {
              separating.add(source);
              this.emit("index", { source, stage: "analyze", fraction, label: "Taking out the music" });
            },
          });
          this.stemsError = "";
          if (ops.length && this.store === store)
            store.commitAndBroadcast({ author: "index", message: "Took the music out of a clip", ops });
        } catch (err) {
          const message = `Couldn't take the music out of a clip: ${(err as Error).message}`;
          console.error("[stems] failed:", err);
          // Said once: the next edit would try again, and fail the same way.
          if (message !== this.stemsError) this.emit("error", { message });
          this.stemsError = message;
        } finally {
          for (const id of separating)
            this.emit("index", { source: id, stage: "ready", fraction: 1, label: "Ready" });
        }
      });
    }, 800);
  }

  /** The last failure taking music out of a clip, so it isn't repeated after every edit. */
  private stemsError = "";

  async runAgent(raw: unknown): Promise<{ runId: string }> {
    const req = AgentRequest.parse(raw);
    // Its own project: the open one, or (a waiting message, sent when the request before it in a
    // project working in the background ended) that one.
    const store =
      req.dir && req.dir !== this.store?.dir ? await this.backgroundStore(req.dir) : this.requireStore();
    const settings = await this.agentSettings();
    // Named in its notifications: the agent this request ran on.
    const agent = HARNESSES[settings.harness].name;
    const runId = newId("run");
    // A first cut, or a request the size of one (a long brief, a project with nothing edited yet, or
    // carrying on with one), gets a first cut's thought and room, however it was sent.
    const unedited =
      store.doc.scenes.length <= store.doc.sources.filter((s) => s.kind === "video").length &&
      !store.doc.visuals.length &&
      !store.doc.titles.length;
    // "Carry on" picks up a big job that ran out of room: it gets the same room.
    const continuing = /^\s*(carry on|continue|keep going|go on|finish( it| the edit)?)\b/i.test(req.prompt);
    const thorough = req.depth === "thorough" || req.prompt.length > 1200 || unedited || continuing;
    const ctrl = new AbortController();
    this.runs.set(runId, ctrl);
    this.asked.set(runId, { dir: store.dir, prompt: req.prompt, startedAt: Date.now() });
    const send = (e: AgentEventBody) => this.emit("agent", { runId, ...e } as AgentEvent);
    const started = Date.now();
    send({ type: "start", backend: settings.backend });
    // A quick tweak to something already in the edit ("captions bigger", "undo the zooms"): done now,
    // in about a second, without the agent. Anything else carries on to the agent below.
    if (!thorough && (await this.instant(store, req, send, started, ctrl.signal))) {
      this.runs.delete(runId);
      this.asked.delete(runId);
      void this.release(store);
      return { runId };
    }
    // Claude Code set to bill an API key (it uses one ahead of a signed-in plan) or signed out: say so
    // now, plainly, instead of a request that never answers.
    // Codex not installed or signed in: say so now, the same way.
    if (settings.harness === "codex") {
      const codex = await codexStatus();
      if (!codex.installed || codex.signedIn === false) {
        this.runs.delete(runId);
        this.asked.delete(runId);
        send({
          type: "error",
          message: !codex.installed
            ? "Codex isn't installed. Install the Codex app (or its CLI), then open Settings → Agent."
            : "Codex isn't signed in. Sign in with ChatGPT from Settings → Agent.",
        });
        return { runId };
      }
    }
    const claude =
      settings.harness === "claude" ? await claudeStatus() : { apiKey: undefined, signedIn: true };
    if (claude.apiKey || claude.signedIn === false) {
      this.runs.delete(runId);
      this.asked.delete(runId);
      send({
        type: "error",
        message: claude.apiKey
          ? `Claude Code is set to use an API key (from ${claude.apiKey}) instead of your Claude plan. Sign in with your plan in Settings → Claude.`
          : "Claude isn't signed in. Sign in from Settings → Claude (it opens Claude Code's own sign-in).",
      });
      return { runId };
    }
    // What the user did by hand since the agent's last change, so it keeps their choices.
    const hand = await store
      .flush()
      .then(() => readLog(store.dir))
      .then(handEdits)
      .catch(() => []);

    void runAgent({
      doc: store.doc,
      prompt: req.prompt,
      context: req.context,
      history: req.history,
      attachments: req.attachments.map((a) => a.source),
      handEdits: hand,
      host: this.agentHost(store),
      indexed: (listener) => this.watchIndexing(store.dir, listener),
      backend: settings.backend,
      harness: settings.harness,
      model: settings.model,
      effort: thorough && settings.effort !== "max" ? "high" : settings.effort,
      showThinking: settings.showThinking,
      // A first cut reads, cuts, designs, looks, checks, measures and makes a cover: it needs room.
      maxTurns: thorough ? 90 : 40,
      signal: ctrl.signal,
      onStep: (text, status) => send({ type: "step", text, status }),
      onText: (delta, turn) => send({ type: "text", delta, ...(turn && { turn: true }) }),
      onThinking: (delta, block) => send({ type: "thinking", delta, ...(block && { block: true }) }),
      onActivity: (text) => send({ type: "activity", text }),
      onUsage: (usage) => send({ type: "usage", harness: settings.harness, ...usage }),
      onTool: (call) => send({ type: "tool", ...call }),
      // The editor's live draft: each change as it's made, also held here in case the run doesn't finish.
      onDraft: (label, ops) => {
        const held = this.partials.get(runId) ?? { dir: store.dir, ops: [], groups: [] };
        this.partials.set(runId, held);
        const start = held.ops.length;
        held.ops.push(...ops);
        held.groups.push({ label, ops: ops.map((_, i) => start + i) });
        send({ type: "draft", label, ops, at: start });
      },
    })
      .then((result) => {
        this.partials.delete(runId);
        let commit: Commit | null = null;
        if (result.ops.length) {
          // Rebase: the user may have kept editing while the agent worked.
          commit = store.commitAndBroadcast({
            author: "agent",
            message: result.summary.slice(0, 480) || result.groups.map((g) => g.label).join(", "),
            ops: result.ops,
            groups: result.groups,
          });
          // Music the agent found still needs its waveform measured (in the background: when it's opened).
          if (store === this.store)
            this.indexer.enqueue(store.doc.sources.filter((s) => s.status === "pending").map((s) => s.id));
        }
        // Claude just answered: describe any shots it couldn't reach before.
        void this.indexer.describeMissing();
        send({
          type: "done",
          commit,
          elapsedMs: Date.now() - started,
          summary: result.summary,
          ...(result.next && { next: result.next }),
        });
        this.notify(store, agent, result.summary || "Done.");
      })
      .catch((err: unknown) => {
        const message =
          err instanceof OpError
            ? `You changed the same things while I was working (${err.message}). Ask again and I'll redo it on top.`
            : err instanceof AgentError
              ? err.message
              : // No key, a bad key, or signed out: say so plainly (the chat offers Settings).
                /authentication|api.?key|x-api-key|authorization|401|unauthori[sz]ed|not logged in|credential/i.test(
                    (err as Error).message,
                  )
                ? "Claude isn't signed in. Sign in from Settings → Claude (it opens Claude Code's own sign-in)."
                : `Something went wrong: ${(err as Error).message}`;
        // Work done before it stopped is held for the user to keep or throw away (a clash with their own
        // edits can't be kept as it is).
        const held = err instanceof OpError ? undefined : this.partials.get(runId);
        if (!held) this.partials.delete(runId);
        send({ type: "error", message, ...(held?.groups.length && { kept: held.groups.length }) });
        if (!ctrl.signal.aborted) this.notify(store, agent, message, true);
      })
      .finally(() => {
        this.runs.delete(runId);
        this.asked.delete(runId);
        void this.release(store);
      });

    return { runId };
  }

  /**
   * Tries the request as an instant edit: Jev picks what to change, code changes it, as one undoable
   * change like the agent's. True when it's done (the run ends here); false hands it to the agent.
   */
  private async instant(
    store: ProjectStore,
    req: z.output<typeof AgentRequest>,
    send: (e: AgentEventBody) => void,
    started: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!(await getSettings()).instantEdits) return false;
    const endpoint = await jevEndpoint();
    const early = precheck(req.prompt, req.attachments.length);
    if (!endpoint && early?.kind !== "undo") return false;
    // Changes "undo the …" can mean: the user's and the agent's, newest first, not undone already.
    const log = await store
      .flush()
      .then(() => readLog(store.dir))
      .catch(() => [] as Commit[]);
    const undone = new Set(
      log.flatMap((c) => (c.reverts && c.reverts.group === undefined ? [c.reverts.commit] : [])),
    );
    const undoable = log
      .filter((c) => (c.author === "user" || c.author === "agent") && !c.reverts && !undone.has(c.id))
      .toReversed();
    const project = store.doc.meta.name;
    let result: InstantResult;
    try {
      result = early
        ? { instant: early }
        : await tryInstant({
            doc: store.doc,
            request: req.prompt,
            endpoint: endpoint!,
            attachments: req.attachments.length,
            focus: req.context,
            earlier: req.history.map((h) => h.user),
            recent: undoable.slice(0, 12).map((c) => ({ id: c.id, label: c.message.slice(0, 120) })),
            signal,
          });
    } catch (err) {
      void logInstant({
        project,
        request: req.prompt,
        instant: { kind: "agent", why: "error" },
        error: (err as Error).message,
        ms: Date.now() - started,
      });
      return false;
    }
    const { instant } = result;
    const done = (summary: string, commit: Commit | null) => {
      if (commit) send({ type: "step", text: summary, status: "done" });
      send({ type: "done", commit, elapsedMs: Date.now() - started, summary });
      void logInstant({ project, request: req.prompt, ...result, ms: Date.now() - started });
      return true;
    };
    try {
      switch (instant.kind) {
        case "edit":
          return done(
            instant.label,
            store.commitAndBroadcast({ author: "agent", message: instant.label, ops: [...instant.ops] }),
          );
        case "undo": {
          const target =
            instant.commit === "last" ? undoable[0] : undoable.find((c) => c.id === instant.commit);
          if (!target) break;
          const label = `Undo: ${target.message.slice(0, 200)}`;
          return done(
            label,
            store.commitAndBroadcast({
              author: "agent",
              message: label,
              ops: revertOps(target),
              reverts: { commit: target.id },
            }),
          );
        }
        case "same":
          return done(`${instant.label}.`, null);
        case "agent":
          break;
      }
    } catch (err) {
      // The edit no longer applies (the project moved on): the agent can work it out.
      void logInstant({
        project,
        request: req.prompt,
        ...result,
        error: (err as Error).message,
        ms: Date.now() - started,
      });
      return false;
    }
    void logInstant({ project, request: req.prompt, ...result, ms: Date.now() - started });
    return false;
  }

  /**
   * Says Claude finished, by a system notification, when it can't be seen: the request was in a project
   * not on screen, or the app isn't in front. A click opens that project.
   */
  private notify(store: ProjectStore, agent: string, text: string, failed = false): void {
    const win = this.window();
    const elsewhere = store !== this.store;
    if (!elsewhere && win?.isFocused()) return;
    if (!Notification.isSupported()) return;
    const name = store.doc.meta.name;
    const note = new Notification({
      title: failed ? `${agent} stopped in ${name}` : `${agent} finished ${name}`,
      body: text.replace(/\s+/g, " ").slice(0, 180),
      silent: false,
    });
    note.on("click", () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      if (store.dir !== this.store?.dir) this.emit("focusProject", { dir: store.dir });
    });
    note.show();
  }

  /** Shots indexing couldn't describe (Claude unreachable then): described now, if Claude answers. */
  describeMissing(): Promise<void> {
    return this.indexer.describeMissing();
  }

  cancel(runId: unknown): void {
    if (typeof runId === "string") this.runs.get(runId)?.abort();
  }

  /** Keeps what a run that didn't finish did, as one undoable change on top of the project as it is. */
  keepPartial(runId: unknown): CommitResult {
    const held = typeof runId === "string" ? this.partials.get(runId) : undefined;
    const store = this.store;
    if (!held || !store || store.dir !== held.dir)
      return { ok: false, error: "That work isn't here anymore." };
    this.partials.delete(runId as string);
    try {
      const commit = store.commitAndBroadcast({
        author: "agent",
        message:
          `Kept what the agent did before it stopped: ${held.groups.map((g) => g.label).join(", ")}`.slice(
            0,
            480,
          ),
        ops: held.ops,
        groups: held.groups,
      });
      this.indexer.enqueue(store.doc.sources.filter((s) => s.status === "pending").map((s) => s.id));
      return { ok: true, commit };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof OpError
            ? `It clashes with what you changed since (${err.message}).`
            : (err as Error).message,
      };
    }
  }

  /** Requests still running in this project, with their changes so far (the window reloaded). */
  activeRuns(): ActiveRun[] {
    return [...this.asked].map(([runId, a]) => ({
      runId,
      dir: a.dir,
      prompt: a.prompt,
      startedAt: a.startedAt,
      ops: this.partials.get(runId)?.ops ?? [],
    }));
  }

  discardPartial(runId: unknown): void {
    if (typeof runId === "string") this.partials.delete(runId);
  }

  async retryIndex(id: unknown): Promise<void> {
    if (typeof id === "string") this.indexer.enqueue([id]);
  }

  async close(): Promise<void> {
    const t0 = Date.now();
    const step = (name: string) => console.log(`[quit] ${name} after ${Date.now() - t0}ms`);
    for (const ctrl of this.runs.values()) ctrl.abort();
    this.indexer.reset();
    stopUpgrades();
    this.exporter.stop();
    step("stopped background work");
    await this.store?.close();
    for (const store of this.background.values()) await store.close();
    step("saved the project");
  }
}

/** Ops that add a found track as a clip with its beat map and make it the music. */
/** A file the agent fetched (stock, a page capture) as a new source, with where it came from. */
function fetchedSourceOps(
  doc: ProjectDoc,
  p: Probed,
  label: string,
  origin: NonNullable<Source["origin"]>,
  about: string,
): { ops: Op[]; id: string } {
  const existing = doc.sources.find((s) => s.path === p.path);
  if (existing) return { ops: [], id: existing.id };
  const id = nextId("clip_", doc.sources);
  const source: Source = {
    ...p,
    id,
    label: label.slice(0, 200),
    color: SWATCHES[doc.sources.length % SWATCHES.length]!,
    status: p.kind === "image" ? "ready" : "pending",
    proxy: false,
    speech: false,
    summary: about.slice(0, 500),
    tags: [origin.provider],
    origin,
  };
  return { ops: [{ op: "insert", coll: "sources", item: source }], id };
}

/** A recipe's inputs: the project's clips, by id (nothing else can be read). */
function processInputs(recipe: ProcessRecipe, doc: ProjectDoc): ProcessInput[] {
  return recipe.inputs.map((i) => {
    const s = doc.sources.find((x) => x.id === i.source);
    if (!s?.path || s.kind === "solid") throw new Error(`there's no clip ${i.source} with a file to read`);
    return { path: s.path, kind: s.kind, in: i.in, out: i.out };
  });
}

/**
 * A clip process_media made, as a source with its recipe: credited like what it was made from (a stock
 * clip reversed is still that stock clip). The same file again is the clip already there.
 */
function processedSourceOps(
  doc: ProjectDoc,
  p: Probed,
  recipe: ProcessRecipe,
  name: string,
): { ops: Op[]; source: Source } {
  const existing = doc.sources.find((s) => s.path === p.path);
  if (existing) return { ops: [], source: existing };
  const origin = recipe.inputs
    .map((i) => doc.sources.find((s) => s.id === i.source)?.origin)
    .find((o) => o !== undefined);
  const source: Source = {
    ...p,
    id: nextId("clip_", doc.sources),
    label: name.slice(0, 200),
    color: SWATCHES[doc.sources.length % SWATCHES.length]!,
    status: p.kind === "image" ? "ready" : "pending",
    proxy: false,
    speech: false,
    summary: `Made from ${recipe.inputs.map((i) => i.source).join(", ")} with process_media`,
    tags: ["processed"],
    ...(origin && { origin }),
    recipe,
  };
  return { ops: [{ op: "insert", coll: "sources", item: source }], source };
}

function musicOps(doc: ProjectDoc, found: FoundTrack): Op[] {
  const b = found.beats;
  // A track already in the project (the search found the same one again) is reused, not imported twice.
  const existing = doc.sources.find((s) => s.path === found.file);
  if (existing)
    return [
      {
        op: "merge",
        key: "music",
        patch: { source: existing.id, label: found.title, credit: found.credit, offset: b.startMs / 1000 },
      },
    ];
  const id = nextId("music_", doc.sources);
  return [
    {
      op: "insert",
      coll: "sources",
      item: {
        id,
        kind: "audio",
        label: found.title,
        path: found.file,
        duration: b.durationMs / 1000,
        hdr: false,
        hasAudio: true,
        status: "pending",
        proxy: false,
        speech: false,
        summary: `Music: ${found.title}`,
        tags: ["music"],
      },
    },
    {
      op: "insert",
      coll: "analyses",
      item: {
        id,
        silences: [],
        shots: [],
        ...(b.bpm && { bpm: b.bpm }),
        beats: b.beats.map((ms) => ms / 1000),
        downbeats: b.downbeats.map((ms) => ms / 1000),
        start: b.startMs / 1000,
        ...(b.dropMs !== null && { drop: b.dropMs / 1000 }),
      },
    },
    {
      op: "merge",
      key: "music",
      patch: { source: id, label: found.title, credit: found.credit, offset: b.startMs / 1000 },
    },
  ];
}

/** A dropped folder imports every media file in it (one level deep, sorted by name). */
async function expandFolders(list: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of list) {
    const info = await stat(p).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      const names = (await readdir(p)).filter((n) => !n.startsWith(".")).sort();
      out.push(...names.map((n) => path.join(p, n)).filter(isMedia));
    } else if (isMedia(p)) out.push(p);
  }
  return out;
}

const sanitize = (name: string) =>
  name
    .replace(/[/\\:*?"<>|]+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled";

async function freeDir(dir: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? dir : `${dir} ${i}`;
    if (!(await stat(candidate).catch(() => null))) return candidate;
  }
}

/**
 * Screenshots and some drags arrive from temporary folders the system empties later (macOS's, and
 * Windows' %TEMP%). Clips are used where they are, so anything in one is copied into the project first.
 */
const TEMP_ROOTS = [tmpdir(), "/private/var/folders", "/var/folders", "/private/tmp", "/tmp"];
const inside = (root: string, file: string) => {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};
const isTemporary = (file: string) =>
  file.split(/[\\/]/).includes("TemporaryItems") || TEMP_ROOTS.some((r) => inside(r, file));

/** Photos and sounds converted for the app (playable.ts): in the project, beside its other media. */
const CONVERTED_DIR = "media/converted";

/** A file coming into the project, read once it's in a form the app can show or play. */
const probeIn = async (file: string, projectDir: string): Promise<Probed> =>
  probe(await playableCopy(file, path.join(projectDir, CONVERTED_DIR)));

async function keepCopy(file: string, projectDir: string): Promise<string> {
  if (!isTemporary(file)) return file;
  const dir = path.join(projectDir, ATTACHMENTS_DIR);
  await mkdir(dir, { recursive: true });
  const ext = path.extname(file).toLowerCase();
  const stem =
    path
      .basename(file, path.extname(file))
      .replace(/[^\w .-]+/g, "")
      .trim()
      .slice(0, 60) || "file";
  const dest = path.join(dir, `${stem}-${Date.now().toString(36)}${ext}`);
  await copyFile(file, dest);
  return dest;
}

/** What the file pickers offer: video, audio and photos. */
const MEDIA_EXTENSIONS = [
  "mp4",
  "mov",
  "m4v",
  "mkv",
  "webm",
  "avi",
  "mts",
  "m2ts",
  "3gp",
  "mp3",
  "wav",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "aif",
  "aiff",
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "hif",
  "avif",
  "bmp",
  "webp",
  "gif",
  "tif",
  "tiff",
];
