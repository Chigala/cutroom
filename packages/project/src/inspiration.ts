/**
 * Inspirations: editing styles to borrow, the way an editor is told "cut it like this one". Each is a
 * recipe, not a mood board:
 *
 *   inspiration.md      a brief for the agent in plain words (the structure, the pacing, how captions,
 *                       motion, visuals and sound behave, what to avoid), under a JSON header:
 *
 *   <!-- inspiration {"name": "Punchy explainer", "description": "...", "bestFor": ["..."], "energy": 4,
 *                     "settings": {"checkRules": {"maxShot": 2.5}, "captionStyle": {"maxWords": 3}},
 *                     "files": ["captionLooks/punchy-pop"]} -->
 *
 * The settings are concrete values (so "fast" means the same thing every time), merged into the
 * project's own; the files (caption looks, graphics, effects, transitions, grades) come along into the
 * project, where they're ordinary files. Applying one is one undoable commit, and the project keeps a
 * copy in inspirations/<id>.md, which the agent reads with every request.
 *
 * A brand kit is who you are (fonts, colours, your caption look); an inspiration is how this video is
 * edited. So an inspiration never touches STYLE.md, and when the project has a brand kit its look
 * (caption look, colours, grade) can be kept: only the pattern applies.
 *
 * They come from three places: built in (starter-inspirations.ts), the user's own (in their library
 * folder, made from a video they love or saved from a project), and the copy in the project.
 */
import type { Op } from "./ops.ts";
import {
  CaptionStyle,
  CheckRules,
  type Inspiration,
  type ItemOf,
  Look,
  Mix,
  Music,
  type ProjectDoc,
} from "./schema.ts";

/** The project settings an inspiration can set. */
export const INSPIRATION_SETTINGS = {
  captionStyle: CaptionStyle,
  checkRules: CheckRules,
  mix: Mix,
  music: Music,
  look: Look,
} as const;
export type InspirationSetting = keyof typeof INSPIRATION_SETTINGS;

/**
 * Fields that aren't style: the track, where the video is going, the source's own framing. An
 * inspiration that sets them is told so.
 */
const NOT_STYLE: Readonly<Record<InspirationSetting, readonly string[]>> = {
  captionStyle: [],
  checkRules: ["platform", "safeZone", "castCorrection", "maxCast", "faceHeight", "maxReframe"],
  mix: ["stereo"],
  music: ["source", "label", "credit", "offset", "section", "fitted"],
  look: ["reframe", "fit", "fitBackdrop", "follow"],
};

/** The look: kept from the brand kit when the user says so, so only the pattern applies. */
export const LOOK_FIELDS: Readonly<Partial<Record<InspirationSetting, readonly string[]>>> = {
  captionStyle: ["look", "font", "color", "accent", "uppercase", "size"],
  look: ["grade", "vignette", "vignetteStrength", "accent", "font", "background"],
};

/** The collections whose files an inspiration can bring. */
export const INSPIRATION_FILES = [
  "graphics",
  "captionLooks",
  "effectKinds",
  "transitionKinds",
  "grades",
] as const;
export type InspirationFileColl = (typeof INSPIRATION_FILES)[number];

export interface InspirationMeta {
  readonly name: string;
  /** One line: what it feels like. */
  readonly description: string;
  /** The kinds of video it's made for: "Talking to camera", "Podcast clips"... */
  readonly bestFor: readonly string[];
  /** 1 calm to 5 relentless. */
  readonly energy: number;
  /** Typical length: "15-45s". */
  readonly length: string;
  readonly tags: readonly string[];
  /** For one made from a video: what it was made from. */
  readonly reference: string;
  readonly version: number;
  readonly settings: Readonly<Partial<Record<InspirationSetting, Readonly<Record<string, unknown>>>>>;
  /** "captionLooks/punchy-pop": files it brings, by collection and id. */
  readonly files: readonly string[];
}

/** An inspiration with the files it brings, ready to apply or to save. */
export interface InspirationPack {
  readonly id: string;
  readonly md: string;
  readonly files: { readonly [C in InspirationFileColl]?: readonly ItemOf<C>[] };
}

/** Built in, the user's own (their library folder), or only in this project (made on another machine). */
export type InspirationOrigin = "builtin" | "mine" | "project";

/** For lists: the header, where it comes from, and the settings in a few words. */
export interface InspirationInfo extends InspirationMeta {
  readonly id: string;
  readonly origin: InspirationOrigin;
  /** "Cuts every 2.5s at most", "3 words a caption"... */
  readonly traits: readonly string[];
}

const HEADER = /^\s*<!--\s*inspiration\s+(\{[\s\S]*?\})\s*-->/;
const FILE_REF = /^(graphics|captionLooks|effectKinds|transitionKinds|grades)\/([A-Za-z0-9_-]{1,64})$/;

const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const strs = (v: unknown, n: number, max: number) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string")
        .slice(0, n)
        .map((x) => x.slice(0, max))
    : [];
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The header of an inspiration, or null when there isn't one or it isn't valid JSON. */
export function inspirationMeta(md: string): InspirationMeta | null {
  const m = HEADER.exec(md);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]!);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const settings: Partial<Record<InspirationSetting, Record<string, unknown>>> = {};
  if (isRecord(raw.settings))
    for (const key of Object.keys(INSPIRATION_SETTINGS) as InspirationSetting[]) {
      const value = raw.settings[key];
      if (isRecord(value)) settings[key] = value;
    }
  const energy = typeof raw.energy === "number" ? Math.round(raw.energy) : 3;
  return {
    name: str(raw.name, 60) || "Inspiration",
    description: str(raw.description, 240),
    bestFor: strs(raw.bestFor, 8, 40),
    energy: Math.min(5, Math.max(1, energy)),
    length: str(raw.length, 30),
    tags: strs(raw.tags, 12, 30),
    reference: str(raw.reference, 300),
    version: typeof raw.version === "number" ? Math.max(1, Math.round(raw.version)) : 1,
    settings,
    files: strs(raw.files, 40, 100).filter((f) => FILE_REF.test(f)),
  };
}

/** The brief: the markdown after the header, which is what the agent reads. */
export function inspirationBrief(md: string): string {
  return md.replace(HEADER, "").trim();
}

/** A readable problem with an inspiration (its header, settings or files), or null. */
export function validateInspiration(md: string, files: InspirationPack["files"] = {}): string | null {
  const m = HEADER.exec(md);
  if (!m)
    return 'Start with a header comment: <!-- inspiration {"name": "...", "description": "...", "settings": {...}} -->';
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]!);
  } catch (err) {
    return `The header isn't valid JSON: ${(err as Error).message}`;
  }
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim()) return "The header needs a name";
  const brief = inspirationBrief(md);
  if (brief.length < 600 || (brief.match(/^## /gm) ?? []).length < 4)
    return "The brief is too thin to edit from: write sections (## The idea, ## Structure, ## Pacing, ## Captions, ## Motion, ## Visuals, ## Sound, ## Look, ## Avoid, ## How to tell it's working) with specifics";
  if (raw.settings !== undefined && !isRecord(raw.settings)) return "settings must be an object";
  for (const [key, patch] of Object.entries(isRecord(raw.settings) ? raw.settings : {})) {
    if (!(key in INSPIRATION_SETTINGS))
      return `settings.${key} isn't something an inspiration sets (it can set ${Object.keys(INSPIRATION_SETTINGS).join(", ")})`;
    if (!isRecord(patch)) return `settings.${key} must be an object of fields`;
    const setting = key as InspirationSetting;
    const schema = INSPIRATION_SETTINGS[setting];
    for (const field of Object.keys(patch)) {
      if (!(field in schema.shape)) return `settings.${key}.${field} isn't a field of ${key}`;
      if (NOT_STYLE[setting].includes(field))
        return `settings.${key}.${field} belongs to the video, not the style: leave it out`;
    }
    const checked = schema.safeParse(deepMerge(schema.parse({}), patch));
    if (!checked.success)
      return `settings.${key}: ${checked.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
  }
  for (const ref of strs(raw.files, 100, 200)) {
    const hit = FILE_REF.exec(ref);
    if (!hit) return `files: "${ref}" should be like "captionLooks/my-look" or "graphics/my-graphic"`;
    const [, coll, id] = hit;
    if (!(files[coll as InspirationFileColl] ?? []).some((f) => f.id === id))
      return `files: ${ref} isn't included with the inspiration`;
  }
  return null;
}

/** `patch` laid over `base`, objects merged key by key (a partial `pauses` keeps the rest). */
export function deepMerge<T>(base: T, patch: Readonly<Record<string, unknown>>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k];
    out[k] = isRecord(v) && isRecord(prev) ? deepMerge(prev, v) : v;
  }
  return out as T;
}

export interface ApplyOptions {
  /**
   * Keep the project's look (its caption look, colours, font and grade, usually from a brand kit):
   * only the pattern applies.
   */
  readonly keepLook?: boolean;
}

/** The settings an inspiration applies, without the look when it's kept. */
export function inspirationSettings(
  meta: InspirationMeta,
  options: ApplyOptions = {},
): Partial<Record<InspirationSetting, Record<string, unknown>>> {
  const out: Partial<Record<InspirationSetting, Record<string, unknown>>> = {};
  for (const [key, patch] of Object.entries(meta.settings) as [
    InspirationSetting,
    Record<string, unknown>,
  ][]) {
    const skip = new Set([...NOT_STYLE[key], ...(options.keepLook ? (LOOK_FIELDS[key] ?? []) : [])]);
    const kept = Object.fromEntries(Object.entries(patch).filter(([field]) => !skip.has(field)));
    if (Object.keys(kept).length) out[key] = kept;
  }
  return out;
}

/**
 * The ops that make a project follow an inspiration: its settings merged in, its files brought along
 * (an older copy of one updated), its brief copied to inspirations/<id>.md, and the project linked.
 */
export function inspirationOps(doc: ProjectDoc, pack: InspirationPack, options: ApplyOptions = {}): Op[] {
  const meta = inspirationMeta(pack.md);
  if (!meta) throw new Error(`inspiration ${pack.id} has no valid header`);
  const ops: Op[] = [];
  for (const coll of INSPIRATION_FILES) {
    for (const item of pack.files[coll] ?? []) {
      const own = (doc[coll] as readonly { id: string }[]).find((x) => x.id === item.id);
      if (!own) ops.push({ op: "insert", coll, item } as Op);
      else if (JSON.stringify(own) !== JSON.stringify(item)) {
        const { id: _id, ...patch } = item as { id: string } & Record<string, unknown>;
        ops.push({ op: "update", coll, id: item.id, patch } as Op);
      }
    }
  }
  // Merges (nested objects merged key by key), so only what the style decides changes.
  for (const [key, patch] of Object.entries(inspirationSettings(meta, options)) as [
    InspirationSetting,
    Record<string, unknown>,
  ][]) {
    const prev = doc[key] as Record<string, unknown>;
    const merged = Object.fromEntries(
      Object.entries(patch).map(([field, v]) => {
        const was = prev[field];
        return [field, isRecord(v) && isRecord(was) ? deepMerge(was, v) : v];
      }),
    );
    ops.push({ op: "merge", key, patch: merged } as Op);
  }
  const copy: Inspiration = { id: pack.id, md: pack.md };
  const own = doc.inspirations.find((i) => i.id === pack.id);
  if (!own) ops.push({ op: "insert", coll: "inspirations", item: copy });
  else if (own.md !== pack.md)
    ops.push({ op: "update", coll: "inspirations", id: pack.id, patch: { md: pack.md } });
  if (doc.meta.inspiration !== pack.id)
    ops.push({ op: "merge", key: "meta", patch: { inspiration: pack.id } });
  return ops;
}

/** The ops that stop following an inspiration (its settings and files stay: they're the project's now). */
export function stopInspirationOps(doc: ProjectDoc): Op[] {
  if (!doc.meta.inspiration) return [];
  const { inspiration: _gone, ...meta } = doc.meta;
  return [{ op: "set", key: "meta", value: meta }];
}

/** The inspiration the project follows, if its copy is there. */
export function activeInspiration(doc: ProjectDoc): Inspiration | null {
  const id = doc.meta.inspiration;
  return (id && doc.inspirations.find((i) => i.id === id)) || null;
}

/** A project's copy, with the files it names from the project as they are now: to save it as the user's. */
export function packFromProject(doc: ProjectDoc, id: string): InspirationPack | null {
  const copy = doc.inspirations.find((i) => i.id === id);
  if (!copy) return null;
  const files: Record<string, { id: string }[]> = {};
  for (const ref of inspirationMeta(copy.md)?.files ?? []) {
    const [, coll, fileId] = FILE_REF.exec(ref)!;
    const item = (doc[coll as InspirationFileColl] as readonly { id: string }[]).find((x) => x.id === fileId);
    if (item) files[coll!] = [...(files[coll!] ?? []), item];
  }
  return { id, md: copy.md, files: files as InspirationPack["files"] };
}

const seconds = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}s`;

/** The settings in a few words, for cards: what someone would notice. */
export function inspirationTraits(meta: InspirationMeta): string[] {
  const s = meta.settings;
  const out: string[] = [];
  const maxShot = s.checkRules?.maxShot;
  if (typeof maxShot === "number") out.push(`Shots under ${seconds(maxShot)}`);
  const pace = s.checkRules?.pace;
  if (typeof pace === "number") out.push(`Something new every ${seconds(pace)}`);
  const words = s.captionStyle?.maxWords;
  if (typeof words === "number") out.push(words === 1 ? "One word at a time" : `${words} words a caption`);
  if (s.captionStyle?.speech === false) out.push("No speech captions");
  if (s.captionStyle?.uppercase === true) out.push("Uppercase captions");
  if (s.look?.drift === false) out.push("Locked-off frame");
  const lufs = s.mix?.loudness;
  if (typeof lufs === "number") out.push(lufs >= -12 ? "Loud mix" : lufs <= -16 ? "Quiet mix" : "");
  if (s.mix?.entrySounds === false) out.push("No pops on graphics");
  return out.filter(Boolean).slice(0, 4);
}

export function inspirationInfo(id: string, md: string, origin: InspirationOrigin): InspirationInfo | null {
  const meta = inspirationMeta(md);
  return meta ? { ...meta, id, origin, traits: inspirationTraits(meta) } : null;
}

/** A file id for a new inspiration from its name. */
export const inspirationId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "inspiration";
