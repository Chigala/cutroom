/**
 * The starter pack: public-domain (CC0) sound effects and music beds that ship with the app
 * (resources/starter-library), copied into the shared library once so the first edit has sounds before
 * anyone adds their own. Each arrives named, described and tagged (pack.json), in its own "Starter pack"
 * folders. Files already there are left alone, and a pack that was added once isn't added again (so what
 * someone deleted stays deleted); a newer pack adds only what's new.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AssetKind, assetId, type LibraryCatalog } from "@vedit/project";
import { app } from "electron";
import { getSettings, setSettings } from "./settings.ts";

interface PackItem {
  /** Where it goes in the library: "Sounds/Starter pack/Whoosh.mp3". */
  readonly file: string;
  readonly kind: AssetKind;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  /** The pack it arrived in: a newer pack adds only the items newer than what was added before. */
  readonly since: number;
}

interface Pack {
  readonly version: number;
  readonly items: readonly PackItem[];
  /** Who made each sound, for the credits file. */
  readonly credits: string;
}

const CREDITS_FILE = "Starter pack credits.txt";

/** Shipped beside the app once packaged; in resources/ when run from the repo. */
export function starterDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "starter-library")
    : path.join(app.getAppPath(), "resources", "starter-library");
}

/**
 * Copies what's new in the pack into the library folder and catalogues it (named, described, tagged; the
 * scan that follows measures each file). The catalogue as it should be, or null when nothing was added.
 */
export async function addStarterPack(dir: string, catalog: LibraryCatalog): Promise<LibraryCatalog | null> {
  const src = starterDir();
  if (!existsSync(path.join(src, "pack.json"))) return null;
  const pack = JSON.parse(await readFile(path.join(src, "pack.json"), "utf8")) as Pack;
  const had = (await getSettings()).starterPack;
  if (had >= pack.version) return null;
  const known = new Set(catalog.assets.map((a) => a.file));
  const assets = [...catalog.assets];
  for (const item of pack.items) {
    if (item.since <= had) continue;
    const dest = path.join(dir, ...item.file.split("/"));
    if (!existsSync(dest)) {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(path.join(src, ...item.file.split("/")), dest);
    }
    if (known.has(item.file)) continue;
    assets.push({
      id: assetId(item.file, "library"),
      file: item.file,
      kind: item.kind,
      name: item.name,
      description: item.description,
      tags: [...item.tags, "starter"],
      // Named by us: the scan measures the file (it hasn't seen it: size 0) and keeps these words.
      edited: true,
      size: 0,
      mtime: 0,
    });
  }
  await writeFile(path.join(dir, CREDITS_FILE), pack.credits);
  await setSettings({ starterPack: pack.version });
  console.log(`[library] added the starter pack (v${pack.version}) to ${dir}`);
  return { ...catalog, assets };
}
