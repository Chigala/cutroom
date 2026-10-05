/**
 * The project folder on disk. Owns one open project: its current doc, its commit log, and the files.
 *
 * - Writes are coalesced: a burst of commits (dragging a clip fires dozens) touches each file once.
 * - Writes are atomic (temp file + rename), so a crash never leaves half a JSON file.
 * - Only files whose sections changed are written, found by reference comparison.
 * - Edits made outside the app (a text editor, Claude Code, git checkout) are picked up by a watcher,
 *   diffed into ops and committed with author "file", so they show up, and undo, like any other change.
 */
import { createHash } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffDocs } from "../diff.ts";
import { FONTS_DIR, fontFromFile } from "../fonts.ts";
import { type Commit, type CommitInput, makeCommit } from "../history.ts";
import {
  changedFiles,
  type DirItem,
  dirItem,
  HISTORY_LOG,
  PROJECT_DIRS,
  PROJECT_FILES,
  type ProjectDir,
  type ProjectFile,
} from "../layout.ts";
import type { Op } from "../ops.ts";
import { type FontFile, type ProjectDoc, ProjectDocSchema } from "../schema.ts";

export class ProjectLoadError extends Error {
  constructor(
    message: string,
    readonly file?: string,
  ) {
    super(message);
    this.name = "ProjectLoadError";
  }
}

const sha = (text: string) => createHash("sha1").update(text).digest("hex");

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

async function readProjectFile(
  dir: string,
  f: ProjectFile,
): Promise<{ part: Partial<ProjectDoc>; text: string | null }> {
  const abs = path.join(dir, f.path);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    if (f.fallback) return { part: f.fallback(), text: null };
    throw new ProjectLoadError(`missing ${f.path}`, f.path);
  }
  try {
    return { part: f.parse(text), text };
  } catch (err) {
    throw new ProjectLoadError(`${f.path} is not valid: ${(err as Error).message}`, f.path);
  }
}

/** Every item of a folder collection (graphics/*.html). A missing folder seeds the starters. */
async function readProjectDir(
  dir: string,
  d: ProjectDir,
): Promise<{ items: DirItem[]; texts: Map<string, string>; seeded: boolean }> {
  let names: string[];
  try {
    names = await readdir(path.join(dir, d.dir));
  } catch {
    return { items: [...d.starters], texts: new Map(), seeded: true };
  }
  const items: DirItem[] = [];
  const texts = new Map<string, string>();
  for (const name of names.sort()) {
    const hit = dirItem(`${d.dir}/${name}`);
    if (!hit) continue;
    const text = await readFile(path.join(dir, d.dir, name), "utf8");
    try {
      items.push(d.parse(hit.id, text));
      texts.set(`${d.dir}/${name}`, text);
    } catch (err) {
      throw new ProjectLoadError(
        `${d.dir}/${name} is not valid: ${(err as Error).message}`,
        `${d.dir}/${name}`,
      );
    }
  }
  return { items, texts, seeded: false };
}

/** The project's own fonts: every font file in fonts/, named the way foundries name them. */
async function readFonts(dir: string): Promise<FontFile[]> {
  let names: string[];
  try {
    names = await readdir(path.join(dir, FONTS_DIR));
  } catch {
    return [];
  }
  const fonts = new Map<string, FontFile>();
  for (const name of names.sort()) {
    const font = fontFromFile(name);
    if (font && !fonts.has(font.id)) fonts.set(font.id, font);
  }
  return [...fonts.values()];
}

export interface StoreEvents {
  /** A commit from outside the renderer: the agent, a file edit, an import. */
  onCommit?(commit: Commit, doc: ProjectDoc): void;
  onError?(error: Error): void;
}

export class ProjectStore {
  private pending: ProjectDoc | null = null;
  private written: ProjectDoc | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();
  /** Font files known to be in fonts/. */
  private fontsOnDisk = new Set<string>();
  private logQueue: string[] = [];
  /** Hash of what we last wrote per file, so the watcher can ignore our own writes. */
  private hashes = new Map<string, string>();
  private watcher: FSWatcher | null = null;
  private reloadTimers = new Map<string, NodeJS.Timeout>();

  private constructor(
    readonly dir: string,
    private current: ProjectDoc,
    private headId: string | null,
    private events: StoreEvents,
  ) {}

  static async create(dir: string, doc: ProjectDoc, events: StoreEvents = {}): Promise<ProjectStore> {
    const store = new ProjectStore(dir, doc, null, events);
    store.pending = doc;
    await store.flush();
    return store;
  }

  static async open(dir: string, events: StoreEvents = {}): Promise<ProjectStore> {
    const parts = await Promise.all(PROJECT_FILES.map((f) => readProjectFile(dir, f)));
    const folders = await Promise.all(PROJECT_DIRS.map((d) => readProjectDir(dir, d)));
    const merged = Object.assign(
      {},
      ...parts.map((p) => p.part),
      ...PROJECT_DIRS.map((d, i) => ({ [d.section]: folders[i]!.items })),
      { fonts: await readFonts(dir) },
    );
    const parsed = ProjectDocSchema.safeParse(merged);
    if (!parsed.success) throw new ProjectLoadError(`project is not valid: ${parsed.error.message}`);
    const store = new ProjectStore(dir, parsed.data, await lastCommitId(dir), events);
    store.written = parsed.data;
    store.fontsOnDisk = new Set(parsed.data.fonts.map((f) => f.file));
    const missing: ProjectFile[] = [];
    PROJECT_FILES.forEach((f, i) => {
      const text = parts[i]!.text;
      if (text === null) missing.push(f);
      else store.hashes.set(f.path, sha(text));
    });
    // Files added in newer versions: write their defaults so the folder is complete.
    await Promise.all(
      missing.map(async (f) => {
        const text = f.serialize(parsed.data);
        store.hashes.set(f.path, sha(text));
        await writeAtomic(path.join(dir, f.path), text);
      }),
    );
    for (const [i, d] of PROJECT_DIRS.entries()) {
      const folder = folders[i]!;
      for (const [rel, text] of folder.texts) store.hashes.set(rel, sha(text));
      if (folder.seeded) await store.writeDir(d, null, parsed.data);
    }
    // So people can see where their fonts go.
    await mkdir(path.join(dir, FONTS_DIR), { recursive: true });
    return store;
  }

  get doc(): ProjectDoc {
    return this.current;
  }

  get head(): string | null {
    return this.headId;
  }

  /** Applies and persists a commit. Throws OpError (doc untouched) if the ops do not apply. */
  commit(input: CommitInput): { commit: Commit; doc: ProjectDoc } {
    const { doc, commit } = makeCommit(this.current, this.headId, input);
    this.accept(commit, doc);
    return { commit, doc };
  }

  /** Commits made outside the renderer are pushed to it through the onCommit event. */
  commitAndBroadcast(input: CommitInput): Commit {
    const { commit, doc } = this.commit(input);
    this.events.onCommit?.(commit, doc);
    return commit;
  }

  private accept(commit: Commit, doc: ProjectDoc): void {
    this.current = doc;
    this.headId = commit.id;
    this.pending = doc;
    this.logQueue.push(JSON.stringify(commit));
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((err: Error) => this.events.onError?.(err));
    }, 120);
  }

  /** Writes pending changes. Serialized: a flush never overlaps another. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      const next = this.pending;
      const lines = this.logQueue.splice(0);
      if (next) {
        this.pending = null;
        await Promise.all(
          changedFiles(this.written, next).map(async (f) => {
            const text = f.serialize(next);
            const h = sha(text);
            if (this.hashes.get(f.path) === h) return;
            this.hashes.set(f.path, h);
            await writeAtomic(path.join(this.dir, f.path), text);
          }),
        );
        for (const d of PROJECT_DIRS)
          if (!this.written || this.written[d.section] !== next[d.section])
            await this.writeDir(d, this.written, next);
        await this.removeFonts(next);
        this.written = next;
      }
      if (lines.length) {
        const log = path.join(this.dir, HISTORY_LOG);
        await mkdir(path.dirname(log), { recursive: true });
        await appendFile(log, `${lines.join("\n")}\n`, "utf8");
      }
    });
    return this.flushing;
  }

  /**
   * Font files are the user's: the app never writes them, but removing a font deletes its file. Compared
   * with what is on disk, not with the last write: flushes are debounced, so a font can arrive and be
   * removed before one happens.
   */
  private async removeFonts(next: ProjectDoc): Promise<void> {
    const kept = new Set(next.fonts.map((f) => f.file));
    const gone = [...this.fontsOnDisk].filter((file) => !kept.has(file));
    for (const file of gone) this.fontsOnDisk.delete(file);
    await Promise.all(gone.map((file) => rm(path.join(this.dir, FONTS_DIR, file), { force: true })));
  }

  /** The fonts folder changed outside the app: an ordinary, undoable commit. */
  private async rescanFonts(): Promise<void> {
    const found = await readFonts(this.dir);
    this.fontsOnDisk = new Set(found.map((f) => f.file));
    const now = new Map(this.current.fonts.map((f) => [f.id, f]));
    const seen = new Map(found.map((f) => [f.id, f]));
    const ops: Op[] = [
      ...found
        .filter((f) => !now.has(f.id))
        .map((item) => ({ op: "insert" as const, coll: "fonts" as const, item })),
      ...this.current.fonts
        .filter((f) => !seen.has(f.id))
        .map((f) => ({ op: "remove" as const, coll: "fonts" as const, id: f.id })),
    ];
    if (!ops.length) return;
    try {
      this.commitAndBroadcast({ author: "file", message: `Edited ${FONTS_DIR}/`, ops });
    } catch (err) {
      this.events.onError?.(err as Error);
    }
  }

  /** Writes the items of a folder collection that changed, and deletes the ones that were removed. */
  private async writeDir(d: ProjectDir, prev: ProjectDoc | null, next: ProjectDoc): Promise<void> {
    const before = new Map((prev?.[d.section] ?? []).map((item) => [item.id, item]));
    const after = new Set(next[d.section].map((item) => item.id));
    await Promise.all([
      ...next[d.section].map(async (item) => {
        if (before.get(item.id) === item) return;
        const rel = `${d.dir}/${item.id}${d.ext}`;
        const text = d.serialize(item);
        const h = sha(text);
        if (this.hashes.get(rel) === h) return;
        this.hashes.set(rel, h);
        await writeAtomic(path.join(this.dir, rel), text);
      }),
      ...[...before.keys()]
        .filter((id) => !after.has(id))
        .map(async (id) => {
          const rel = `${d.dir}/${id}${d.ext}`;
          this.hashes.delete(rel);
          await rm(path.join(this.dir, rel), { force: true });
        }),
    ]);
  }

  /** Watches the folder for edits made outside the app. */
  watch(): void {
    if (this.watcher) return;
    const known = new Map(PROJECT_FILES.map((f) => [f.path, f]));
    this.watcher = watch(this.dir, { recursive: true }, (_event, name) => {
      if (!name) return;
      const rel = name.split(path.sep).join("/");
      if (rel.startsWith(`${FONTS_DIR}/`)) {
        clearTimeout(this.reloadTimers.get(FONTS_DIR));
        this.reloadTimers.set(
          FONTS_DIR,
          setTimeout(() => void this.rescanFonts(), 200),
        );
        return;
      }
      const file = known.get(rel);
      const item = file ? null : dirItem(rel);
      if (!file && !item) return;
      // Editors save in bursts (truncate, write, rename). Settle before reading.
      clearTimeout(this.reloadTimers.get(rel));
      this.reloadTimers.set(
        rel,
        setTimeout(
          () => void (file ? this.reloadFile(file) : this.reloadDirItem(item!.dir, item!.id, rel)),
          80,
        ),
      );
    });
  }

  private async reloadFile(file: ProjectFile): Promise<void> {
    let text: string;
    try {
      text = await readFile(path.join(this.dir, file.path), "utf8");
    } catch {
      return; // deleted or mid-rename; the next event will tell us
    }
    if (this.hashes.get(file.path) === sha(text)) return; // our own write
    let part: Partial<ProjectDoc>;
    try {
      part = file.parse(text);
    } catch (err) {
      this.events.onError?.(new ProjectLoadError(`${file.path}: ${(err as Error).message}`, file.path));
      return;
    }
    const ops = opsFromFileEdit(this.current, part);
    this.hashes.set(file.path, sha(text));
    if (!ops.length) return;
    try {
      this.commitAndBroadcast({ author: "file", message: `Edited ${file.path}`, ops });
    } catch (err) {
      this.events.onError?.(err as Error);
    }
  }

  /** A graphic created, edited or deleted outside the app: an ordinary, undoable commit. */
  private async reloadDirItem(d: ProjectDir, id: string, rel: string): Promise<void> {
    const exists = this.current[d.section].find((x) => x.id === id);
    let text: string | null = null;
    try {
      text = await readFile(path.join(this.dir, rel), "utf8");
    } catch {
      text = null;
    }
    let ops: Op[] = [];
    if (text === null) {
      if (!exists || !this.hashes.has(rel)) return;
      this.hashes.delete(rel);
      ops = [{ op: "remove", coll: d.section, id }];
    } else {
      if (this.hashes.get(rel) === sha(text)) return; // our own write
      this.hashes.set(rel, sha(text));
      let item: DirItem;
      try {
        item = d.parse(id, text);
      } catch (err) {
        this.events.onError?.(new ProjectLoadError(`${rel}: ${(err as Error).message}`, rel));
        return;
      }
      if (exists && d.serialize(exists) === d.serialize(item)) return;
      const { id: _, ...patch } = item;
      ops = exists
        ? [{ op: "update", coll: d.section, id, patch }]
        : [{ op: "insert", coll: d.section, item }];
    }
    try {
      this.commitAndBroadcast({ author: "file", message: `Edited ${rel}`, ops });
    } catch (err) {
      this.events.onError?.(err as Error);
    }
  }

  async close(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;
    for (const t of this.reloadTimers.values()) clearTimeout(t);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

/** Ops that bring `doc` in line with sections read from an edited file. */
export function opsFromFileEdit(doc: ProjectDoc, part: Partial<ProjectDoc>): Op[] {
  return diffDocs(doc, part);
}

async function lastCommitId(dir: string): Promise<string | null> {
  try {
    const text = await readFile(path.join(dir, HISTORY_LOG), "utf8");
    const last = text.trimEnd().split("\n").at(-1);
    return last ? (JSON.parse(last) as Commit).id : null;
  } catch {
    return null;
  }
}

/** Reads the whole commit log, oldest first. Skips a torn final line from a crash. */
export async function readLog(dir: string): Promise<Commit[]> {
  let text: string;
  try {
    text = await readFile(path.join(dir, HISTORY_LOG), "utf8");
  } catch {
    return [];
  }
  const commits: Commit[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      commits.push(JSON.parse(line) as Commit);
    } catch {
      // torn write at the tail
    }
  }
  return commits;
}
