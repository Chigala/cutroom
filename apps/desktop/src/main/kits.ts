/**
 * Brand kits on disk, shared by every project: <userData>/kits/<id>/kit.json, with the kit's font files
 * in fonts/ beside it. See kit.ts in @vedit/project for what a kit holds.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyOps,
  BrandKit,
  FONTS_DIR,
  type KitInfo,
  kitFromDoc,
  kitInfo,
  kitOps,
  LUTS_DIR,
  type ProjectDoc,
  rememberIn,
} from "@vedit/project";
import { app } from "electron";

const root = () => path.join(app.getPath("userData"), "kits");
const kitDir = (id: string) => path.join(root(), id);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "kit";

export async function listKits(): Promise<KitInfo[]> {
  const ids = await readdir(root()).catch(() => [] as string[]);
  const kits = await Promise.all(ids.map((id) => getKit(id)));
  return kits
    .filter((k): k is BrandKit => k !== null)
    .map(kitInfo)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function getKit(id: string): Promise<BrandKit | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  try {
    return BrandKit.parse(JSON.parse(await readFile(path.join(kitDir(id), "kit.json"), "utf8")));
  } catch {
    return null;
  }
}

async function writeKit(kit: BrandKit): Promise<void> {
  await mkdir(kitDir(kit.id), { recursive: true });
  await writeFile(path.join(kitDir(kit.id), "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
}

/** Saves a project's taste as a kit (a new one, or over the kit `id`), with its font files. */
export async function saveKit(
  doc: ProjectDoc,
  projectDir: string,
  name: string,
  id?: string,
): Promise<KitInfo> {
  let kitId = id && (await getKit(id)) ? id : slug(name);
  if (!id) for (let n = 2; existsSync(kitDir(kitId)); n++) kitId = `${slug(name)}-${n}`;
  const kit = kitFromDoc(doc, kitId, name.trim() || "My kit");
  for (const [dir, files] of kitFiles(kit)) {
    await mkdir(path.join(kitDir(kitId), dir), { recursive: true });
    for (const file of files) {
      const from = path.join(projectDir, dir, file);
      if (existsSync(from)) await copyFile(from, path.join(kitDir(kitId), dir, file));
    }
  }
  await writeKit(kit);
  return kitInfo(kit);
}

/** A kit's own files, by folder: its fonts and its LUTs. */
const kitFiles = (kit: BrandKit): [string, string[]][] => [
  [FONTS_DIR, kit.fonts.map((f) => f.file)],
  [LUTS_DIR, kit.luts.map((l) => l.file)],
];

/** Copies a kit's font and LUT files into a project's fonts/ and luts/ (the store picks them up there). */
export async function copyKitFiles(kit: BrandKit, projectDir: string): Promise<void> {
  for (const [dir, files] of kitFiles(kit)) {
    if (!files.length) continue;
    await mkdir(path.join(projectDir, dir), { recursive: true });
    for (const file of files) {
      const from = path.join(kitDir(kit.id), dir, file);
      const to = path.join(projectDir, dir, file);
      if (existsSync(from) && !existsSync(to)) await copyFile(from, to);
    }
  }
}

/** A new project's doc with a kit's taste in it (its fonts copied into the folder first). */
export async function withKit(doc: ProjectDoc, kitId: string, projectDir: string): Promise<ProjectDoc> {
  const kit = kitId ? await getKit(kitId) : null;
  if (!kit) return doc;
  await copyKitFiles(kit, projectDir);
  return { ...applyOps(doc, kitOps(doc, kit)).doc, fonts: kit.fonts, luts: kit.luts };
}

/** Adds a learned preference to a kit's STYLE.md. */
export async function rememberInKit(id: string, note: string): Promise<boolean> {
  const kit = await getKit(id);
  if (!kit) return false;
  await writeKit({ ...kit, style: rememberIn(kit.style, note) });
  return true;
}

export async function removeKit(id: string): Promise<void> {
  if (!(await getKit(id))) return;
  await rm(kitDir(id), { recursive: true, force: true });
}
