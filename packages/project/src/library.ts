/**
 * The asset library: sounds, music and memes the user keeps for their edits. One shared library folder
 * (Cutroom Library in the videos folder by default) and, optionally, each project's own assets/ folder. Each
 * folder has a catalogue, library.json, written by the app as files arrive (what the sound classifier
 * heard, a track's tempo, what a meme shows) and edited by the user or the agent (names, tags, notes),
 * plus roles: the asset to use for "impact", "sting.awkward", "sticker.kai"...
 */
import { z } from "zod";

export const ASSET_KINDS = ["sound", "music", "meme"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** library.json in a library folder, or assets/library.json in a project. */
export const CATALOG_FILE = "library.json";
/** A project's own assets. */
export const PROJECT_ASSETS_DIR = "assets";

export const LibraryAsset = z.object({
  /** "sounds/vine-boom" in the shared library, "project/sounds/vine-boom" in a project's assets/. */
  id: z.string().min(1).max(200),
  /** The file, relative to its folder. */
  file: z.string().min(1).max(500),
  kind: z.enum(ASSET_KINDS),
  name: z.string().max(120),
  description: z.string().max(400).default(""),
  tags: z.array(z.string().max(40)).max(24).default([]),
  /** Seconds (sounds, music, moving memes). */
  duration: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Music: beats per minute. */
  bpm: z.number().positive().optional(),
  /** Has see-through parts (a sticker): shows without a card. */
  alpha: z.boolean().optional(),
  /** Named, described or tagged by a person or the agent: the app's own guesses no longer replace it. */
  edited: z.boolean().default(false),
  /** Size and modification time when it was catalogued: a changed file is looked at again. */
  size: z.number().int().nonnegative(),
  mtime: z.number().nonnegative(),
});
export type LibraryAsset = z.infer<typeof LibraryAsset>;

export const LibraryCatalog = z.object({
  version: z.literal(1).default(1),
  assets: z.array(LibraryAsset).default([]),
  /** Role → asset id: "impact" → "sounds/vine-boom". */
  roles: z.record(z.string().max(60), z.string().max(200)).default({}),
});
export type LibraryCatalog = z.infer<typeof LibraryCatalog>;

/** An asset as the editor and the agent see it: where it lives, and the roles it fills. */
export interface AssetEntry extends LibraryAsset {
  readonly scope: "library" | "project";
  readonly roles: readonly string[];
}

/** "vine_boom-final.wav" → "vine boom final". */
export function nameFromFile(file: string): string {
  const base = file.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** A stable id from a file's place in its folder: "Sounds/Vine Boom.wav" → "sounds/vine-boom". */
export function assetId(file: string, scope: "library" | "project"): string {
  const slug = file
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .split("/")
    .map((part) =>
      part
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
  return `${scope === "project" ? "project/" : ""}${slug || "asset"}`.slice(0, 200);
}

/** What kind a file is from the folder it's in ("Sounds/", "SFX/", "Music/", "Memes/", "Stickers/"). */
export function kindFromFolder(file: string): AssetKind | null {
  const top = file.split("/")[0]?.toLowerCase() ?? "";
  if (!file.includes("/")) return null;
  if (/sound|sfx|effect|sting|foley/.test(top)) return "sound";
  if (/music|song|track|beat|bed/.test(top)) return "music";
  if (/meme|sticker|gif|image|reaction|picture|photo/.test(top)) return "meme";
  return null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);

/**
 * Assets that match a search, best first: every word of the query is looked for in the name, roles,
 * tags and description (the name and roles count most). An empty query lists everything.
 */
export function searchAssets(assets: readonly AssetEntry[], query: string, kind?: AssetKind): AssetEntry[] {
  const q = words(query);
  const scored = assets
    .filter((a) => !kind || a.kind === kind)
    .map((a) => {
      if (!q.length) return { a, score: 1 };
      const name = words(a.name);
      const roles = a.roles.flatMap(words);
      const tags = a.tags.flatMap(words);
      const about = words(a.description);
      let score = 0;
      for (const w of q) {
        const hit = (list: string[]) => list.some((x) => x === w || (w.length > 3 && x.startsWith(w)));
        if (hit(roles)) score += 4;
        if (hit(name)) score += 3;
        if (hit(tags)) score += 2;
        if (hit(about)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
  return scored.map((x) => x.a);
}

/** Longest a video can be and still go in the library (a reaction clip, not footage). */
export const KEEPABLE_VIDEO_SECONDS = 30;

/** A project clip that belongs in a library: a song, a sound, an image or meme, a short clip. */
export function keepable(s: {
  kind: string;
  duration?: number | undefined;
  path?: string | undefined;
}): boolean {
  if (!s.path) return false;
  return (
    s.kind === "audio" ||
    s.kind === "image" ||
    (s.kind === "video" && (s.duration ?? Infinity) <= KEEPABLE_VIDEO_SECONDS)
  );
}

/** One line per asset, as the agent reads them. */
export function assetLine(a: AssetEntry): string {
  const bits = [
    a.kind,
    a.duration !== undefined ? `${a.duration.toFixed(a.duration < 10 ? 1 : 0)}s` : "",
    a.bpm ? `${Math.round(a.bpm)} BPM` : "",
    a.alpha ? "see-through" : "",
    a.width && a.height ? `${a.width}x${a.height}` : "",
  ].filter(Boolean);
  const roles = a.roles.length ? ` · role: ${a.roles.join(", ")}` : "";
  const tags = a.tags.length ? ` · ${a.tags.slice(0, 8).join(", ")}` : "";
  const about = a.description ? ` · ${a.description}` : "";
  return `[${a.id}] "${a.name}" (${bits.join(", ")})${roles}${tags}${about}`;
}
