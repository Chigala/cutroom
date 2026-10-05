/**
 * The asset library: the shared folder (~/Movies/Video Editor Library unless Settings says otherwise)
 * and the open project's assets/ folder. Both are watched; files that arrive are catalogued into the
 * folder's library.json: a sound's tags from the on-device sound classifier, a track's tempo, what a
 * meme shows (described by Claude). Names, notes and tags someone wrote are never overwritten.
 */
import { existsSync, type FSWatcher, watch } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { defaultBackend, describeAssets } from "@vedit/agent";
import type { LibraryState } from "@vedit/bridge";
import { beatMap, ensureHear, hearSounds, mediaKind, type Probed, probe, run } from "@vedit/media";
import {
  type AssetEntry,
  type AssetKind,
  assetId,
  CATALOG_FILE,
  kindFromFolder,
  type LibraryAsset,
  LibraryCatalog,
  nameFromFile,
  PROJECT_ASSETS_DIR,
} from "@vedit/project";
import { claudeStatus } from "./claude.ts";
import { getSettings, paths } from "./settings.ts";

type Scope = "library" | "project";

/** The folders a new library starts with, by kind. */
const FOLDERS: Record<AssetKind, string> = { sound: "Sounds", music: "Music", meme: "Memes" };
const ABOUT = "About this folder.txt";
const ABOUT_TEXT = `Video Editor's asset library.

Put the sounds, music and memes you want in your edits here:
  Sounds/  sound effects: booms, whooshes, stings, "bruh"...
  Music/   tracks and beds
  Memes/   images, GIFs, stickers and short reaction clips

Any folder works (the names above just help). The editor catalogues what you add in library.json:
what each sound is, a track's tempo, what a meme shows. You can rename, describe and tag things there
or in the editor's Library tab, and give your favourites roles ("impact", "reaction sting") so the
agent always uses them. Every project can also have its own assets/ folder for one-off things.
`;

/** Longer than this, a sound file is music. */
const MUSIC_SECONDS = 45;

export const defaultLibraryDir = () => path.join(homedir(), "Movies", "Video Editor Library");

interface Root {
  readonly scope: Scope;
  readonly dir: string;
  catalog: LibraryCatalog;
  watcher: FSWatcher | null;
  scanning: Promise<void> | null;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const isHidden = (name: string) => name.startsWith(".") || name === CATALOG_FILE || name === ABOUT;

async function walk(dir: string, rel = "", depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r, depth + 1)));
    else if (e.isFile() && mediaKind(e.name)) out.push(r);
  }
  return out;
}

/** Has see-through parts: an alpha pixel format, or a WebM marked as carrying alpha. */
async function hasAlpha(file: string): Promise<boolean> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=pix_fmt:stream_tags=alpha_mode",
      "-of",
      "default=nw=1",
      file,
    ]);
    return /pix_fmt=(rgba|bgra|argb|abgr|ya|yuva|gbrap|pal8)/.test(stdout) || /alpha_mode=1/i.test(stdout);
  } catch {
    return false;
  }
}

export class Library {
  private roots = new Map<Scope, Root>();
  private pending = 0;
  /** Memes whose description was already tried this session (a failure isn't retried in a loop). */
  private described = new Set<string>();

  constructor(private readonly emit: (state: LibraryState) => void) {}

  /** Starts on the shared library (made if missing). The project's assets/ come with setProject. */
  async start(): Promise<void> {
    const dir = (await getSettings()).libraryDir.trim() || defaultLibraryDir();
    await this.open("library", dir.replace(/^~(?=$|\/)/, homedir()), true);
    this.broadcast();
  }

  async setProject(projectDir: string | null): Promise<void> {
    this.close("project");
    if (projectDir) await this.open("project", path.join(projectDir, PROJECT_ASSETS_DIR), false);
    this.broadcast();
  }

  /** Moves the shared library to another folder (its catalogue is in the folder, so it comes along). */
  async setLibraryDir(dir: string): Promise<void> {
    this.close("library");
    await this.open("library", dir, true);
    this.broadcast();
  }

  close(scope?: Scope): void {
    for (const [s, root] of this.roots) {
      if (scope && s !== scope) continue;
      root.watcher?.close();
      if (root.timer) clearTimeout(root.timer);
      this.roots.delete(s);
    }
  }

  private async open(scope: Scope, dir: string, create: boolean): Promise<void> {
    if (create) {
      for (const f of Object.values(FOLDERS)) await mkdir(path.join(dir, f), { recursive: true });
      const about = path.join(dir, ABOUT);
      if (!(await stat(about).catch(() => null))) await writeFile(about, ABOUT_TEXT);
    }
    const root: Root = {
      scope,
      dir,
      catalog: await this.read(dir),
      watcher: null,
      scanning: null,
      again: false,
      timer: null,
    };
    this.roots.set(scope, root);
    this.watch(root);
    void this.scan(root);
  }

  /** Watches the folder; a project without an assets/ yet is watched for one to appear. */
  private watch(root: Root): void {
    root.watcher?.close();
    root.watcher = null;
    try {
      root.watcher = existsSync(root.dir)
        ? watch(root.dir, { recursive: true }, (_event, name) => {
            const n = String(name ?? "");
            if (n.endsWith(CATALOG_FILE) || n.endsWith(".tmp")) return;
            this.later(root);
          })
        : watch(path.dirname(root.dir), (_event, name) => {
            if (String(name ?? "") !== path.basename(root.dir) || !existsSync(root.dir)) return;
            this.watch(root);
            this.later(root);
          });
    } catch {}
  }

  /** Rescans a moment after the last change (a copy of many files is one rescan). */
  private later(root: Root): void {
    if (root.timer) clearTimeout(root.timer);
    root.timer = setTimeout(() => void this.scan(root), 800);
  }

  private async read(dir: string): Promise<LibraryCatalog> {
    try {
      return LibraryCatalog.parse(JSON.parse(await readFile(path.join(dir, CATALOG_FILE), "utf8")));
    } catch {
      return LibraryCatalog.parse({});
    }
  }

  private async write(root: Root): Promise<void> {
    if (!(await stat(root.dir).catch(() => null))) return;
    const file = path.join(root.dir, CATALOG_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(root.catalog, null, 2)}\n`);
    await rename(tmp, file);
  }

  /** Brings the catalogue in line with the folder: new and changed files looked at, removed ones gone. */
  scan(root: Root): Promise<void> {
    if (root.scanning) {
      root.again = true;
      return root.scanning;
    }
    root.scanning = (async () => {
      do {
        root.again = false;
        await this.scanOnce(root).catch((err: unknown) =>
          console.warn(`[library] couldn't catalogue ${root.dir}:`, (err as Error).message),
        );
      } while (root.again && this.roots.get(root.scope) === root);
    })().finally(() => {
      root.scanning = null;
    });
    return root.scanning;
  }

  private async scanOnce(root: Root): Promise<void> {
    const files = await walk(root.dir);
    const byFile = new Map(root.catalog.assets.map((a) => [a.file, a]));
    const next: LibraryAsset[] = [];
    let changed = files.length !== root.catalog.assets.length;
    const fresh: string[] = [];
    for (const file of files) {
      const st = await stat(path.join(root.dir, file)).catch(() => null);
      if (!st) continue;
      const old = byFile.get(file);
      if (old && old.size === st.size && Math.abs(old.mtime - st.mtimeMs) < 1) next.push(old);
      else fresh.push(file);
    }
    this.pending += fresh.length;
    this.broadcast();
    for (const file of fresh) {
      try {
        const old = byFile.get(file);
        const made = await this.catalogue(root, file);
        // What a person (or the agent) wrote stays; the file's facts are measured again.
        next.push(
          old?.edited
            ? { ...made, name: old.name, description: old.description, tags: old.tags, edited: true }
            : made,
        );
        changed = true;
      } catch (err) {
        console.warn(`[library] couldn't read ${file}:`, (err as Error).message.slice(0, 200));
      } finally {
        this.pending--;
      }
      if (this.roots.get(root.scope) !== root) return;
      // Shown as it goes: what's done, and the rest as it was.
      const done = new Set(next.map((a) => a.file));
      const rest = files.filter((f) => !done.has(f)).flatMap((f) => byFile.get(f) ?? []);
      root.catalog = { ...root.catalog, assets: [...next, ...rest] };
      this.broadcast();
    }
    // Roles whose asset is gone go too.
    const ids = new Set(next.map((a) => a.id));
    const roles = Object.fromEntries(Object.entries(root.catalog.roles).filter(([, id]) => ids.has(id)));
    if (Object.keys(roles).length !== Object.keys(root.catalog.roles).length) changed = true;
    root.catalog = { ...root.catalog, assets: next.sort((a, b) => a.file.localeCompare(b.file)), roles };
    if (changed) await this.write(root);
    this.broadcast();
    await this.describeMemes(root);
  }

  /** One file's entry: kind, length and size, and what the app can tell about it on the Mac. */
  private async catalogue(root: Root, file: string): Promise<LibraryAsset> {
    const abs = path.join(root.dir, file);
    const st = await stat(abs);
    const p: Probed = await probe(abs);
    const kind: AssetKind =
      kindFromFolder(file) ??
      (p.kind === "audio" ? ((p.duration ?? 0) > MUSIC_SECONDS ? "music" : "sound") : "meme");
    const asset: LibraryAsset = {
      id: assetId(file, root.scope),
      file,
      kind,
      name: nameFromFile(file),
      description: "",
      tags: [],
      ...(p.duration && { duration: Math.round(p.duration * 100) / 100 }),
      ...(p.width && { width: p.width }),
      ...(p.height && { height: p.height }),
      edited: false,
      size: st.size,
      mtime: st.mtimeMs,
    };
    if (kind === "meme") {
      if (p.kind !== "audio" && (await hasAlpha(abs))) asset.alpha = true;
      return asset;
    }
    // Sounds and music: what the on-device classifier hears (and a track's tempo).
    const heard = await this.hear(abs).catch(() => null);
    if (heard) {
      const labels = [
        ...heard.sounds
          .slice()
          .sort((a, b) => b.confidence - a.confidence)
          .map((s) => s.label.replace(/_/g, " ")),
        ...heard.instruments.map((i) => i.name.replace(/_/g, " ")),
      ];
      asset.tags = [...new Set(labels.map((l) => (l === "speech" ? "voice" : l)))].slice(0, 8);
    }
    if (kind === "music") {
      const beats = await beatMap(abs, paths.cache()).catch(() => null);
      if (beats?.bpm) asset.bpm = beats.bpm;
    }
    return asset;
  }

  private async hear(file: string) {
    const ear = await ensureHear(paths.hear());
    if (!ear) return null;
    const dir = await mkdtemp(path.join(tmpdir(), "vedit-hear-"));
    try {
      const wav = path.join(dir, "a.wav");
      // The first half minute is plenty to know what a sound or a track is.
      await run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-t",
        "30",
        "-i",
        file,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        wav,
      ]);
      return await hearSounds(ear, wav);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Memes nobody has described yet: a sheet of up to 12 at a time, described by Claude. */
  private async describeMemes(root: Root): Promise<void> {
    const settings = await getSettings();
    if (!settings.describeShots) return;
    const todo = root.catalog.assets.filter(
      (a) => a.kind === "meme" && !a.edited && !a.description && !this.described.has(`${root.dir}|${a.file}`),
    );
    if (!todo.length) return;
    const backend = settings.backend === "auto" ? defaultBackend() : settings.backend;
    if (backend === "subscription") await claudeStatus();
    for (let i = 0; i < todo.length; i += 12) {
      const group = todo.slice(i, i + 12);
      for (const a of group) this.described.add(`${root.dir}|${a.file}`);
      this.pending += group.length;
      this.broadcast();
      try {
        const sheet = await this.sheet(root, group);
        const found = await describeAssets(
          sheet,
          group.map((a) => a.file.replace(/^.*\//, "")),
          backend,
        );
        if (this.roots.get(root.scope) !== root) return;
        const byId = new Map(group.map((a, n) => [a.id, found[n]]));
        root.catalog = {
          ...root.catalog,
          assets: root.catalog.assets.map((a) => {
            const d = byId.get(a.id);
            if (!d || a.edited) return a;
            // A file named by its maker keeps that name; "IMG_2041" gets the description's.
            const generic =
              /^(img|image|photo|screenshot|download|giphy|tenor|pxl|dsc|untitled)\b|^\d|^[a-f0-9]{8,}/i.test(
                a.name,
              );
            return { ...a, name: generic ? d.name : a.name, description: d.what, tags: d.tags };
          }),
        };
        await this.write(root);
      } catch (err) {
        console.warn("[library] couldn't describe memes:", (err as Error).message.slice(0, 200));
      } finally {
        this.pending -= group.length;
        this.broadcast();
      }
    }
  }

  /** A contact sheet: each meme's frame (a third of the way in for moving ones), 4 across. */
  private async sheet(root: Root, group: readonly LibraryAsset[]): Promise<Buffer> {
    const dir = await mkdtemp(path.join(tmpdir(), "vedit-sheet-"));
    try {
      let n = 0;
      for (const a of group) {
        n++;
        const out = path.join(dir, `${String(n).padStart(2, "0")}.jpg`);
        const at = a.duration && a.duration > 0.5 ? ["-ss", String(a.duration / 3)] : [];
        await run("ffmpeg", [
          "-v",
          "error",
          "-y",
          ...at,
          "-i",
          path.join(root.dir, a.file),
          "-frames:v",
          "1",
          // See-through parts on grey, so a sticker reads; every tile the same size.
          "-filter_complex",
          "color=c=0x8a8a8a:s=320x320[bg];[0:v]scale=320:320:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuvj420p",
          "-q:v",
          "4",
          out,
        ]).catch(() =>
          run("ffmpeg", [
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x8a8a8a:s=320x320",
            "-frames:v",
            "1",
            out,
          ]),
        );
      }
      const sheet = path.join(dir, "sheet.jpg");
      const cols = Math.min(4, group.length);
      const rows = Math.ceil(group.length / cols);
      await run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        path.join(dir, "%02d.jpg"),
        "-vf",
        `tile=${cols}x${rows}:padding=8:color=0x1b1b1f`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        sheet,
      ]);
      return await readFile(sheet);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Every asset, with the roles each fills: the project's roles override the library's. */
  entries(): { assets: AssetEntry[]; roles: Record<string, string> } {
    const lib = this.roots.get("library");
    const proj = this.roots.get("project");
    const roles = { ...(lib?.catalog.roles ?? {}), ...(proj?.catalog.roles ?? {}) };
    const byAsset = new Map<string, string[]>();
    for (const [role, id] of Object.entries(roles)) byAsset.set(id, [...(byAsset.get(id) ?? []), role]);
    const assets: AssetEntry[] = [];
    for (const root of [proj, lib]) {
      if (!root) continue;
      for (const a of root.catalog.assets)
        assets.push({ ...a, scope: root.scope, roles: (byAsset.get(a.id) ?? []).sort() });
    }
    return { assets, roles };
  }

  state(): LibraryState {
    const { assets, roles } = this.entries();
    return {
      dir: this.roots.get("library")?.dir ?? defaultLibraryDir(),
      projectDir: this.roots.get("project")?.dir ?? null,
      assets,
      roles,
      pending: this.pending,
    };
  }

  private broadcast(): void {
    this.emit(this.state());
  }

  private find(id: string): { root: Root; asset: LibraryAsset } | null {
    for (const root of this.roots.values()) {
      const asset = root.catalog.assets.find((a) => a.id === id);
      if (asset) return { root, asset };
    }
    return null;
  }

  /** The file behind an asset id, or null. */
  resolve(id: string): string | null {
    const hit = this.find(id);
    return hit ? path.join(hit.root.dir, hit.asset.file) : null;
  }

  asset(id: string): AssetEntry | null {
    return this.entries().assets.find((a) => a.id === id) ?? null;
  }

  async update(id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<void> {
    const hit = this.find(id);
    if (!hit) throw new Error(`No asset "${id}" in the library.`);
    const { root } = hit;
    root.catalog = {
      ...root.catalog,
      assets: root.catalog.assets.map((a) =>
        a.id === id
          ? {
              ...a,
              ...(patch.name !== undefined && { name: patch.name.slice(0, 120) }),
              ...(patch.description !== undefined && { description: patch.description.slice(0, 400) }),
              ...(patch.tags !== undefined && {
                tags: [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(
                  0,
                  24,
                ),
              }),
              edited: true,
            }
          : a,
      ),
    };
    await this.write(root);
    this.broadcast();
  }

  /** A role for an asset, kept in the catalogue of the folder the asset is in; null clears the role. */
  async setRole(role: string, id: string | null): Promise<void> {
    const name = role.trim().toLowerCase().slice(0, 60);
    if (!name) throw new Error("A role needs a name.");
    for (const root of this.roots.values()) {
      if (!(name in root.catalog.roles)) continue;
      const { [name]: _, ...rest } = root.catalog.roles;
      root.catalog = { ...root.catalog, roles: rest };
      await this.write(root);
    }
    if (id) {
      const hit = this.find(id);
      if (!hit) throw new Error(`No asset "${id}" in the library.`);
      hit.root.catalog = { ...hit.root.catalog, roles: { ...hit.root.catalog.roles, [name]: id } };
      await this.write(hit.root);
    }
    this.broadcast();
  }

  /** Copies files in, each into its kind's folder ("Sounds", "Music", "Memes"); then catalogues them. */
  async add(files: readonly string[], scope: Scope): Promise<string[]> {
    const root = this.roots.get(scope);
    const dir = root?.dir;
    if (!dir) throw new Error(scope === "project" ? "Open a project first." : "The library isn't ready.");
    const added: string[] = [];
    for (const file of files) {
      if (!path.isAbsolute(file) || !mediaKind(file)) continue;
      const p = await probe(file).catch(() => null);
      if (!p) continue;
      const kind: AssetKind =
        p.kind === "audio" ? ((p.duration ?? 0) > MUSIC_SECONDS ? "music" : "sound") : "meme";
      const folder = path.join(dir, FOLDERS[kind]);
      await mkdir(folder, { recursive: true });
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      let target = path.join(folder, `${base}${ext}`);
      for (let n = 2; await stat(target).catch(() => null); n++)
        target = path.join(folder, `${base} ${n}${ext}`);
      await copyFile(file, target);
      added.push(path.relative(dir, target).split(path.sep).join("/"));
    }
    if (root) {
      this.watch(root);
      await this.scan(root);
    }
    return added;
  }

  /** The folder for a scope, made if missing (a project's assets/ is made on first use). */
  async folder(scope: Scope): Promise<string> {
    const root = this.roots.get(scope);
    if (!root) throw new Error(scope === "project" ? "Open a project first." : "The library isn't ready.");
    await mkdir(root.dir, { recursive: true });
    if (scope === "project") {
      for (const f of Object.values(FOLDERS)) await mkdir(path.join(root.dir, f), { recursive: true });
      this.watch(root);
    }
    return root.dir;
  }
}
