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
  handEdits,
  runAgent,
} from "@vedit/agent";
import type {
  AgentEvent,
  AgentStatus,
  AttachResult,
  ChatRecord,
  CommitResult,
  EditorEvents,
  ProjectSnapshot,
  RecentProject,
} from "@vedit/bridge";
import { AgentRequest, CommitRequestSchema } from "@vedit/bridge";
import { clearArea } from "@vedit/checks";
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
  measureJoins,
  type Probed,
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
  type Commit,
  demoProject,
  emptyProject,
  FONTS_DIR,
  type KitInfo,
  keepable,
  kitOps,
  newId,
  nextId,
  type Op,
  OpError,
  type ProjectDoc,
  round,
  type Scene,
  SFX_NAMES,
  type SfxName,
  type Source,
  starterOps,
  timelineOf,
} from "@vedit/project";
import { ProjectStore, readLog } from "@vedit/project/node";
import { renderStills, senseMotion } from "@vedit/render";
import { app, type BrowserWindow, dialog, nativeImage, shell } from "electron";
import { z } from "zod";
import { capturePage } from "./capture.ts";
import { claudeStatus, claudeTasks } from "./claude.ts";
import { makeNeededCutouts } from "./cutouts.ts";
import { Downloads } from "./downloads.ts";
import { Exporter, entry as renderEntry } from "./exporter.ts";
import { cachePaths, Indexer, stopUpgrades } from "./indexer.ts";
import { copyKitFonts, getKit, listKits, rememberInKit, removeKit, saveKit, withKit } from "./kits.ts";
import { Library } from "./library.ts";
import { onWindowsDrive } from "./platform.ts";
import { getSettings, paths, setSettings, whisperSetup } from "./settings.ts";
import { Versions } from "./versions.ts";

const SWATCHES = ["#355761", "#2B4F63", "#5A4A36", "#45603F", "#3A3552", "#2F5A6B", "#5E4632", "#4C5A3A"];

type AgentEventBody = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, "runId"> : never) : never;

export interface AgentSettings {
  readonly backend: Backend;
  readonly model: string;
  readonly effort: Effort;
  readonly showThinking: boolean;
}

const round3 = (t: number) => Math.round(t * 1000) / 1000;

export class ProjectService {
  private store: ProjectStore | null = null;
  private runs = new Map<string, AbortController>();
  readonly indexer: Indexer;
  readonly exporter: Exporter;
  readonly versions: Versions;
  /** The asset library: the shared folder and the open project's assets/. */
  readonly library = new Library((state) => this.emit("library", state));
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
    this.versions = new Versions(
      store,
      (e) => this.emit("versions", e),
      async () => ({ ...(await this.agentSettings()), host: this.agentHost() }),
    );
  }

  private emit<E extends keyof EditorEvents>(event: E, payload: EditorEvents[E]): void {
    const win = this.window();
    if (win && !win.isDestroyed()) win.webContents.send(`event:${event}`, payload);
    for (const l of this.listeners.get(event) ?? []) (l as (p: EditorEvents[E]) => void)(payload);
  }

  private readonly listeners = new Map<string, Set<(payload: never) => void>>();

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
    await this.switchTo(await ProjectStore.create(dir, await this.fresh(dir), this.events()));
    const r = await this.importFiles(clips);
    if (!r.ok) throw new Error(r.error);
  }

  /** Measures the rendered motion of `doc` (the agent's inspect_motion). */
  senseMotion(doc: ProjectDoc) {
    return senseMotion({
      doc,
      entry: renderEntry(),
      workDir: path.join(this.requireStore().dir, CACHE_DIR, "sense"),
      safeZone: clearArea(doc.checkRules),
      resolve: (key) => this.resolveIn(doc, key.replace(/\?.*$/, ""), "proxy"),
    });
  }

  /** How every dialogue cut in `doc` sounds (the agent's inspect_joins), from each clip's speech audio. */
  measureJoins(doc: ProjectDoc) {
    const dir = path.join(this.requireStore().dir, CACHE_DIR, "audio");
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
  private async resolveIn(doc: ProjectDoc | null, key: string, query: string): Promise<string | null> {
    // An asset in the library or the project's assets/ (the Library tab's previews).
    if (key.startsWith("lib/")) return this.library.resolve(key.slice(4));
    // Footage made from a clip: its cutout, or a ramped shot (rendered on first ask).
    if (key.includes("~"))
      return this.store && doc ? resolveDerived(this.store.dir, doc, key, doc.meta.format.fps) : null;
    if (key.startsWith("sfx/")) {
      const name = key.slice(4) as SfxName;
      return SFX_NAMES.includes(name) ? sfxFile(name, paths.cache()) : null;
    }
    const store = this.store;
    // A picture the agent looked at (a frame strip), kept for the chat.
    if (/^looks\/[a-z0-9-]+\.jpg$/.test(key)) return store ? path.join(store.dir, CACHE_DIR, key) : null;
    if (key.startsWith(`${FONTS_DIR}/`)) {
      // Only fonts the project knows, by exact file name: no other path is reachable.
      const font = doc?.fonts.find((f) => `${FONTS_DIR}/${f.file}` === key);
      return store && font ? path.join(store.dir, FONTS_DIR, font.file) : null;
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

  private async switchTo(next: ProjectStore): Promise<ProjectSnapshot> {
    for (const ctrl of this.runs.values()) ctrl.abort();
    this.indexer.reset();
    this.exporter.stop();
    await this.store?.close();
    this.store = next;
    next.watch();
    await this.rescueTemporary(next);
    // Built-ins added to the app since this project last opened: written in as its own files.
    const starters = starterOps(next.doc);
    if (starters.length)
      next.commitAndBroadcast({ author: "index", message: "Added the new built-in effects", ops: starters });
    await this.remember(next.dir, next.doc.meta.name);
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

  private events() {
    return {
      onCommit: (commit: Commit) => {
        this.emit("commit", { commit, head: commit.id });
        // A rename: the projects list shows the new name.
        const renamed = commit.ops.some((op) => op.op === "merge" && op.key === "meta" && "name" in op.patch);
        if (renamed && this.store) void this.remember(this.store.dir, this.store.doc.meta.name);
        // Clips removed (or imports undone) stop indexing.
        if (this.store) this.indexer.prune(this.store.doc);
        this.scheduleCutouts();
      },
      onError: (error: Error) => this.emit("error", { message: error.message }),
    };
  }

  async restore(): Promise<ProjectSnapshot> {
    if (this.store) return this.snapshot();
    const [last] = await this.recent();
    if (last) {
      try {
        return await this.switchTo(await ProjectStore.open(last.dir, this.events()));
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
    return this.switchTo(await ProjectStore.open(target, this.events()));
  }

  /** "New project from videos…": pick clips, get a fresh project with them in it. */
  async newFromVideos(): Promise<ProjectSnapshot | null> {
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
    return this.startWith(result.filePaths);
  }

  /**
   * A new project in Movies, named after the first clip, with the clips imported. The import lands a
   * moment after the project opens, so the window shows it arriving (and indexing) like a drop.
   */
  private async startWith(files: string[]): Promise<ProjectSnapshot> {
    this.lastImportDir = path.dirname(files[0]!);
    const name = sanitize(path.basename(files[0]!, path.extname(files[0]!))) || "Untitled";
    const dir = await freeDir(path.join(app.getPath("videos"), name));
    await mkdir(dir, { recursive: true });
    const snapshot = await this.switchTo(
      await ProjectStore.create(dir, await this.fresh(dir), this.events()),
    );
    setTimeout(() => {
      void this.importFiles(files).then((r) => {
        if (!r.ok) this.emit("error", { message: r.error });
      });
    }, 500);
    return snapshot;
  }

  async create(name: string): Promise<ProjectSnapshot | null> {
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
    return this.switchTo(await ProjectStore.create(dir, await this.fresh(dir), this.events()));
  }

  /** A new project's doc: empty, with the brand kit new projects start with (settings.kit). */
  private async fresh(dir: string): Promise<ProjectDoc> {
    return withKit(emptyProject(path.basename(dir)), (await getSettings()).kit, dir);
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
    await copyKitFonts(kit, store.dir);
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

  async openDemo(): Promise<ProjectSnapshot> {
    const dir = paths.demo();
    try {
      return await this.switchTo(await ProjectStore.open(dir, this.events()));
    } catch {
      await mkdir(dir, { recursive: true });
      return this.switchTo(await ProjectStore.create(dir, demoProject(), this.events()));
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

  private async remember(dir: string, name: string): Promise<void> {
    const list = [
      { dir, name, openedAt: Date.now() },
      ...(await this.recent()).filter((r) => r.dir !== dir),
    ].slice(0, 300);
    await writeFile(paths.recent(), JSON.stringify(list, null, 2));
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
  async assetSource(id: string, doc: ProjectDoc): Promise<{ ops: Op[]; id: string; asset: AssetEntry }> {
    const store = this.requireStore();
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
      await probe(target),
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
    const probed = await Promise.all(files.map((f) => probe(f).catch((err: Error) => err)));
    const ok = probed.filter((p): p is Probed => !(p instanceof Error));
    const failures = probed.filter((p): p is Error => p instanceof Error);
    if (!ok.length) return { ok: false, error: failures[0]?.message ?? "Could not read those files." };

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
    const store = this.requireStore();
    const files = z
      .array(z.string())
      .max(10)
      .parse(raw)
      .filter((p) => path.isAbsolute(p));
    if (!files.length) return { ok: false, error: "Nothing to attach." };
    for (let i = 0; i < files.length; i++) files[i] = await keepCopy(files[i]!, store.dir);
    const probed = await Promise.all(files.map((f) => probe(f).catch((err: Error) => err)));
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
    return this.attach([file]);
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

  async saveChat(records: unknown): Promise<void> {
    const store = this.requireStore();
    if (!Array.isArray(records)) return;
    const file = path.join(store.dir, CHAT_LOG);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(records.slice(-300)));
  }

  async agentSettings(): Promise<AgentSettings> {
    const s = await getSettings();
    // Which Claude Code to run (found once at startup; this waits for it).
    if ((s.backend === "auto" ? defaultBackend() : s.backend) === "subscription") await claudeStatus();
    return {
      backend: s.backend === "auto" ? defaultBackend() : s.backend,
      model: s.model,
      effort: s.effort,
      showThinking: s.showThinking,
    };
  }

  async agentStatus(): Promise<AgentStatus> {
    const s = await this.agentSettings();
    const k = await getSettings();
    const env = process.env;
    return {
      backend: s.backend,
      model: s.model,
      apiKey: Boolean(env.ANTHROPIC_API_KEY),
      keys: {
        klipy: k.klipyKey ? "saved" : env.KLIPY_API_KEY ? "env" : null,
        pexels: k.pexelsKey ? "saved" : env.PEXELS_API_KEY ? "env" : null,
        pixabay: k.pixabayKey ? "saved" : env.PIXABAY_API_KEY ? "env" : null,
        freesound: k.freesoundKey ? "saved" : env.FREESOUND_API_KEY ? "env" : null,
        groq: k.groqKey ? "saved" : env.GROQ_API_KEY ? "env" : null,
      },
    };
  }

  /** What the agent can ask of the machine: frames of footage, and music from the web. */
  private agentHost(): AgentHost {
    return {
      frame: async (sourceId, time, width) => {
        const store = this.requireStore();
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
        const store = this.requireStore();
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
          resolve: (key) => this.resolveIn(doc, key.replace(/\?.*$/, ""), "proxy"),
        });
        return { images: [...images], errors: [...errors] };
      },
      keepPicture: async (jpeg) => {
        const store = this.requireStore();
        const name = `looks/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.jpg`;
        await mkdir(path.join(store.dir, CACHE_DIR, "looks"), { recursive: true });
        await writeFile(path.join(store.dir, CACHE_DIR, name), jpeg);
        return name;
      },
      findMusic: async (mood, doc) => {
        const store = this.requireStore();
        const found = await findMusic(mood, {
          targetDir: path.join(store.dir, "music"),
          cacheDir: paths.cache(),
        });
        if (!found) return null;
        return { ops: musicOps(doc, found), title: found.title, bpm: found.beats.bpm };
      },
      peaks: (id, doc) => this.indexer.peaksNow(id, doc),
      // A second listen to a stretch the first pass missed or misheard (singing, music over the voice).
      transcribe: async (sourceId, from, to, { text, hint }) => {
        const store = this.requireStore();
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
        search: async () => this.library.entries(),
        use: async (id, doc) => {
          const { ops, id: source } = await this.assetSource(id, doc);
          return { ops, id: source };
        },
        update: (id, patch) => this.library.update(id, patch),
        setRole: (role, id) => this.library.setRole(role, id),
        keep: (ids, doc) => this.keepInLibrary(ids, doc),
      },
      kits: {
        list: () => listKits(),
        save: (doc, name, id) => saveKit(doc, this.requireStore().dir, name, id),
        apply: async (id, doc) => {
          const kit = await getKit(id);
          if (!kit) return null;
          await copyKitFonts(kit, this.requireStore().dir);
          return { ops: kitOps(doc, kit), name: kit.name };
        },
        remember: (id, note) => rememberInKit(id, note),
      },
      // Off macOS the agent's cutout tool says they aren't available here.
      ...(cutoutsAvailable() && {
        cutouts: async (doc: ProjectDoc) => makeNeededCutouts(this.requireStore().dir, doc),
      }),
      findStock: async (query, kind, orientation) => {
        const settings = await getSettings();
        const keys = {
          pexels: settings.pexelsKey || process.env.PEXELS_API_KEY || "",
          pixabay: settings.pixabayKey || process.env.PIXABAY_API_KEY || "",
        };
        const candidates = await searchStock(query, { kind, orientation, keys });
        return { candidates, sheet: candidates.length ? await stockSheet(candidates) : null };
      },
      senseMotion: (doc) => this.senseMotion(doc),
      measureJoins: (doc) => this.measureJoins(doc),
      findSounds: async (query, maxSeconds) => {
        const settings = await getSettings();
        const freesoundKey = settings.freesoundKey || process.env.FREESOUND_API_KEY || "";
        return findSounds(query, { maxSeconds, ...(freesoundKey && { freesoundKey }) });
      },
      addSound: async (c, label, doc) => {
        const store = this.requireStore();
        const file = await downloadSound(c, path.join(store.dir, "media", "sounds"));
        const { hit, tail } = await soundHit(file);
        const origin = {
          url: c.page,
          provider: "freesound",
          license: c.license,
          author: c.credit ? c.author : "",
        };
        return { ...fetchedSourceOps(doc, await probe(file), label, origin, c.title), hit, tail };
      },
      addStock: async (c, label, doc) => {
        const store = this.requireStore();
        const file = await downloadStock(c, path.join(store.dir, "media", "stock"));
        const origin = {
          url: c.page,
          provider: c.provider,
          license: STOCK_LICENSE[c.provider],
          author: c.author,
        };
        return fetchedSourceOps(doc, await probe(file), label, origin, c.about);
      },
      findMemes: async (query, kind) => {
        const settings = await getSettings();
        const key = settings.klipyKey || process.env.KLIPY_API_KEY || "";
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
        const store = this.requireStore();
        const file = await downloadMeme(c, path.join(store.dir, "media", "memes"));
        const origin = { url: c.page, provider: "klipy", license: "KLIPY", author: "" };
        return fetchedSourceOps(doc, await probe(file), label, origin, c.title);
      },
      capturePage: async (url, o, doc) => {
        const store = this.requireStore();
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
   * the subject), one job at a time, and record it so the subject layer switches on.
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
      });
    }, 800);
  }

  async runAgent(raw: unknown): Promise<{ runId: string }> {
    const req = AgentRequest.parse(raw);
    const store = this.requireStore();
    const settings = await this.agentSettings();
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
    const send = (e: AgentEventBody) => this.emit("agent", { runId, ...e } as AgentEvent);
    const started = Date.now();
    send({ type: "start", backend: settings.backend });
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
      host: this.agentHost(),
      backend: settings.backend,
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
      onTool: (call) => send({ type: "tool", ...call }),
    })
      .then((result) => {
        let commit: Commit | null = null;
        if (result.ops.length) {
          // Rebase: the user may have kept editing while the agent worked.
          commit = store.commitAndBroadcast({
            author: "agent",
            message: result.summary.slice(0, 480) || result.groups.map((g) => g.label).join(", "),
            ops: result.ops,
            groups: result.groups,
          });
          // Music the agent found still needs its waveform measured.
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
                ? settings.backend === "api"
                  ? "Claude couldn't sign in: there's no valid API key. Add one, or choose Automatic or Subscription in Settings to use your Claude subscription."
                  : "Claude couldn't sign in with your subscription. Sign in again (claude login), or add an API key in Settings."
                : `Something went wrong: ${(err as Error).message}`;
        send({ type: "error", message });
      })
      .finally(() => this.runs.delete(runId));

    return { runId };
  }

  /** Shots indexing couldn't describe (Claude unreachable then): described now, if Claude answers. */
  describeMissing(): Promise<void> {
    return this.indexer.describeMissing();
  }

  cancel(runId: unknown): void {
    if (typeof runId === "string") this.runs.get(runId)?.abort();
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
  "webp",
  "gif",
  "tif",
  "tiff",
];
