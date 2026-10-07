/**
 * Projects: folders on disk that hold several videos (each video is its own edit folder, as before). A
 * folder is one by the small file in it, so it stays one when it's moved, synced or opened elsewhere,
 * and a video belongs to the project whose folder it sits in. Ordinary folders (Movies, Desktop) never
 * become projects by accident.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** The file that makes a folder a project. */
export const PROJECT_MARK = ".cutroom-project.json";

export interface FolderEntry {
  readonly dir: string;
  readonly name: string;
  readonly addedAt: number;
  readonly pinned?: boolean;
}

export const isProjectFolder = (dir: string) => existsSync(path.join(dir, PROJECT_MARK));

/** A video's edit folder: it has the project file every edit has. */
const isVideo = (dir: string) => existsSync(path.join(dir, "project.json"));

/** The same folder, however it was written (separators, a trailing slash, case on Mac and Windows). */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p);
    return process.platform === "linux" ? r : r.toLowerCase();
  };
  return norm(a) === norm(b);
}

/** The project a video belongs to: the one whose folder it's in. */
export function projectOf<F extends { dir: string }>(video: string, folders: readonly F[]): F | undefined {
  return folders.find((f) => samePath(path.dirname(video), f.dir));
}

export const cleanName = (name: string) =>
  name
    .replace(/[/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled";

/** `dir`, or "dir 2", "dir 3"… if it's taken. */
export async function freeDir(dir: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? dir : `${dir} ${i}`;
    if (!(await stat(candidate).catch(() => null))) return candidate;
  }
}

/** A new project folder in `parent`, named for the project. */
export async function makeProjectFolder(parent: string, name: string): Promise<FolderEntry> {
  const clean = cleanName(name);
  const dir = await freeDir(path.join(parent, clean));
  await mkdir(dir, { recursive: true });
  const addedAt = Date.now();
  await writeFile(
    path.join(dir, PROJECT_MARK),
    `${JSON.stringify({ name: clean, createdAt: addedAt }, null, 2)}\n`,
  );
  return { dir, name: clean, addedAt };
}

/** The project's name: from its file (renamed there), else its folder. */
export async function projectName(dir: string): Promise<string> {
  try {
    const mark = JSON.parse(await readFile(path.join(dir, PROJECT_MARK), "utf8")) as { name?: unknown };
    if (typeof mark.name === "string" && mark.name.trim()) return mark.name.trim().slice(0, 80);
  } catch {}
  return path.basename(dir);
}

/**
 * The videos in a project folder, made on this computer or not: each edit folder directly inside it,
 * with its name and when it last changed.
 */
export async function videosIn(dir: string): Promise<{ dir: string; name: string; changedAt: number }[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const videos = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .slice(0, 300)
      .map(async (e) => {
        const video = path.join(dir, e.name);
        if (!isVideo(video)) return null;
        const file = path.join(video, "project.json");
        let name = e.name;
        try {
          const meta = JSON.parse(await readFile(file, "utf8")) as { name?: unknown };
          if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
        } catch {}
        const changedAt = await stat(path.join(video, ".history", "log.jsonl"))
          .then((s) => s.mtimeMs)
          .catch(() =>
            stat(file).then(
              (s) => s.mtimeMs,
              () => 0,
            ),
          );
        return { dir: video, name, changedAt };
      }),
  );
  return videos.filter((v) => v !== null);
}

/**
 * Moves a video's folder into `to` (a project, or anywhere), keeping its name unless that's taken.
 * Returns where it went. Across drives a folder can't simply be renamed: that's said plainly.
 */
export async function moveVideo(video: string, to: string): Promise<string> {
  if (samePath(path.dirname(video), to)) return video;
  const target = await freeDir(path.join(to, path.basename(video)));
  try {
    await rename(video, target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") throw new Error("That project is on another drive: copy the video there instead.");
    if (code === "EBUSY" || code === "EPERM")
      throw new Error(
        "Something is still using that video's files. Close it (or wait for Claude) and try again.",
      );
    throw err;
  }
  return target;
}

/** Renames a project: the name in its file (the folder keeps its own, so its videos' paths hold). */
export async function renameProject(dir: string, name: string): Promise<string> {
  const file = path.join(dir, PROJECT_MARK);
  let mark: Record<string, unknown> = {};
  try {
    mark = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {}
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled project";
  await writeFile(file, `${JSON.stringify({ ...mark, name: clean }, null, 2)}\n`);
  return clean;
}
