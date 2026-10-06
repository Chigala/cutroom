/**
 * The user's own inspirations, in their library folder (Cutroom Library/Inspirations/ unless Settings
 * moved it), where they can see, share and edit them like any other file:
 *
 *   Inspirations/
 *     punchy-but-calmer/
 *       inspiration.md            the brief and its settings (see inspiration.ts in @vedit/project)
 *       files/captions/looks/…    the files it brings, laid out like a project's folders
 *       files/graphics/…
 *
 * Built-in ones live in the app; one saved under a built-in's id is the user's version of it.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  INSPIRATION_FILES,
  type InspirationInfo,
  type InspirationPack,
  inspirationInfo,
  PROJECT_DIRS,
  type ProjectDir,
} from "@vedit/project";

export const INSPIRATIONS_FOLDER = "Inspirations";
const BRIEF = "inspiration.md";
const FILES = "files";
const ABOUT = "About this folder.txt";
const ABOUT_TEXT = `Your inspirations: editing styles Cutroom can follow.

Each folder is one style. inspiration.md is the brief the editor follows (the structure, pacing,
captions, motion, sound and look) with the settings it applies at the top; files/ holds what it brings
along (caption looks, graphics, effects, transitions, grades).

Make one from a video you love by attaching it in Cutroom and asking it to learn the style, or save the
one a project follows. Edit them here, or copy a folder to share it.
`;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The folders an inspiration's files go in, the same as a project's. */
const DIRS = PROJECT_DIRS.filter((d) => (INSPIRATION_FILES as readonly string[]).includes(d.section));

export class InspirationStore {
  /** `folder` resolves the library folder (it can move in Settings). */
  constructor(private readonly folder: () => Promise<string>) {}

  /** The inspirations folder, made (with a note on what it is) if missing. */
  async dir(): Promise<string> {
    const dir = path.join(await this.folder(), INSPIRATIONS_FOLDER);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, ABOUT), ABOUT_TEXT).catch(() => {});
    }
    return dir;
  }

  async list(): Promise<InspirationInfo[]> {
    const dir = await this.dir();
    const ids = (await readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && SAFE_ID.test(e.name))
      .map((e) => e.name);
    const infos = await Promise.all(
      ids.map(async (id) => {
        try {
          return inspirationInfo(id, await readFile(path.join(dir, id, BRIEF), "utf8"), "mine");
        } catch {
          return null;
        }
      }),
    );
    return infos.filter((i): i is InspirationInfo => i !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<InspirationPack | null> {
    if (!SAFE_ID.test(id)) return null;
    const root = path.join(await this.dir(), id);
    let md: string;
    try {
      md = await readFile(path.join(root, BRIEF), "utf8");
    } catch {
      return null;
    }
    const files: Record<string, unknown[]> = {};
    for (const d of DIRS) {
      const folder = path.join(root, FILES, d.dir);
      const names = await readdir(folder).catch(() => [] as string[]);
      for (const name of names.sort()) {
        if (!name.endsWith(d.ext)) continue;
        const fileId = name.slice(0, -d.ext.length);
        if (!SAFE_ID.test(fileId)) continue;
        try {
          const item = (d as ProjectDir).parse(fileId, await readFile(path.join(folder, name), "utf8"));
          files[d.section] = [...(files[d.section] ?? []), item];
        } catch (err) {
          console.warn(`[inspirations] ${id}: skipped ${d.dir}/${name}: ${(err as Error).message}`);
        }
      }
    }
    return { id, md, files: files as InspirationPack["files"] };
  }

  /** Writes one (over one with the same id: the brief, and its files folder afresh). */
  async save(pack: InspirationPack): Promise<InspirationInfo> {
    if (!SAFE_ID.test(pack.id)) throw new Error(`"${pack.id}" isn't a valid inspiration id`);
    const info = inspirationInfo(pack.id, pack.md, "mine");
    if (!info) throw new Error("The inspiration has no valid header");
    const root = path.join(await this.dir(), pack.id);
    await rm(path.join(root, FILES), { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, BRIEF), pack.md.endsWith("\n") ? pack.md : `${pack.md}\n`);
    for (const d of DIRS) {
      const items = (pack.files as Record<string, readonly { id: string }[] | undefined>)[d.section] ?? [];
      if (!items.length) continue;
      const folder = path.join(root, FILES, d.dir);
      await mkdir(folder, { recursive: true });
      for (const item of items)
        await writeFile(path.join(folder, `${item.id}${d.ext}`), (d as ProjectDir).serialize(item as never));
    }
    return info;
  }

  async remove(id: string): Promise<void> {
    if (!SAFE_ID.test(id)) return;
    await rm(path.join(await this.dir(), id), { recursive: true, force: true });
  }
}
