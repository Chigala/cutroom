/**
 * How a ProjectDoc maps onto files in the project folder. Pure: no fs here, so the renderer can show the
 * folder tree and the main process can read and write it with the same definitions.
 *
 *   My Video/
 *     project.json              meta: name, format
 *     STYLE.md                  the taste file, loaded into every agent request
 *     look.json                 color grade
 *     sources/index.json        imported clips (written by import and indexing)
 *     sources/transcripts.json  every word said in every clip, with timings
 *     sources/shots.json        what every clip shows, shot by shot (the visual transcript)
 *     sources/analysis.json     silences, shot changes, beats
 *     timeline/scenes.json      the cut, in playback order
 *     captions/captions.json    caption style, word fixes and emphasis, manual segments
 *     motion/zooms.json         punch-ins and pushes
 *     overlays/titles.json      hook and on-screen titles
 *     audio/music.json          the track, volume, ducking
 *     audio/sfx.json            sound effects
 *     comments/comments.json    notes pinned to moments
 *     exports/                  rendered videos
 *     .history/log.jsonl        every commit, append-only (restore points)
 *     .cache/                   preview proxies, waveforms, render masters (safe to delete)
 */
import { z } from "zod";
import { captionLookMeta, STARTER_CAPTION_LOOKS } from "./caption-looks.ts";
import { FONTS_DIR } from "./fonts.ts";
import { LUTS_DIR } from "./grading.ts";
import { inspirationMeta } from "./inspiration.ts";
import {
  Analysis,
  Caption,
  CaptionLook,
  CaptionStyle,
  CheckRules,
  Comment,
  Cover,
  Design,
  Effect,
  ExportSettings,
  Graphic,
  Inspiration,
  type ItemOf,
  Look,
  Meta,
  Mix,
  Music,
  MusicClip,
  MusicCue,
  type ProjectDoc,
  Scene,
  Sfx,
  ShotLog,
  Source,
  StyleFile,
  Title,
  Transcript,
  Visual,
  Voiceover,
  WordEdit,
  Zoom,
} from "./schema.ts";
import { STARTER_GRAPHICS } from "./starter-graphics.ts";
import { STARTER_EFFECTS, STARTER_GRADES, STARTER_TRANSITIONS, styleMeta } from "./styles.ts";

type Section = keyof ProjectDoc;

export interface ProjectFile {
  /** Path relative to the project folder, always with forward slashes. */
  readonly path: string;
  readonly sections: readonly Section[];
  readonly describe: string;
  serialize(doc: ProjectDoc): string;
  parse(text: string): Partial<ProjectDoc>;
  /** Value when the file doesn't exist yet (projects made by an older version). Absent = required. */
  fallback?(): Partial<ProjectDoc>;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function jsonFile<K extends Section>(
  path: string,
  key: K,
  schema: z.ZodType<ProjectDoc[K]>,
  describe: string,
  fallback?: () => ProjectDoc[K],
): ProjectFile {
  return {
    path,
    sections: [key],
    describe,
    serialize: (doc) => json(doc[key]),
    parse: (text) => ({ [key]: schema.parse(JSON.parse(text)) }) as Partial<ProjectDoc>,
    ...(fallback && { fallback: () => ({ [key]: fallback() }) as Partial<ProjectDoc> }),
  };
}

const CaptionsFile = z.object({
  style: CaptionStyle,
  words: z.array(WordEdit).default([]),
  segments: z.array(Caption).default([]),
});

const empty = () => [];

export const PROJECT_FILES: readonly ProjectFile[] = [
  jsonFile("project.json", "meta", Meta, "Name and output format"),
  {
    path: "STYLE.md",
    sections: ["style"],
    describe: "Your taste, in plain words. The agent follows it on every edit.",
    serialize: (doc) => (doc.style.endsWith("\n") ? doc.style : `${doc.style}\n`),
    parse: (text) => ({ style: text }),
    fallback: () => ({ style: "" }),
  },
  jsonFile("look.json", "look", Look, "Color grade", () => Look.parse({})),
  jsonFile("design.json", "design", Design, "This video's own design: palette, type, motion", () =>
    Design.parse({}),
  ),
  jsonFile("sources/index.json", "sources", z.array(Source), "Imported clips and what is in them", empty),
  jsonFile(
    "sources/transcripts.json",
    "transcripts",
    z.array(Transcript),
    "Every word said, with timings",
    empty,
  ),
  jsonFile("sources/shots.json", "shotLogs", z.array(ShotLog), "What each clip shows, shot by shot", empty),
  jsonFile("sources/analysis.json", "analyses", z.array(Analysis), "Silences, shot changes and beats", empty),
  jsonFile("timeline/scenes.json", "scenes", z.array(Scene), "The cut, in playback order", empty),
  {
    path: "captions/captions.json",
    sections: ["captionStyle", "wordEdits", "captions"],
    describe: "Caption style, word fixes and emphasis, manual captions",
    serialize: (doc) => json({ style: doc.captionStyle, words: doc.wordEdits, segments: doc.captions }),
    parse: (text) => {
      const { style, words, segments } = CaptionsFile.parse(JSON.parse(text));
      return { captionStyle: style, wordEdits: words, captions: segments };
    },
    fallback: () => ({ captionStyle: CaptionStyle.parse({}), wordEdits: [], captions: [] }),
  },
  jsonFile("motion/zooms.json", "zooms", z.array(Zoom), "Zoom ins and pushes", empty),
  jsonFile("overlays/titles.json", "titles", z.array(Title), "Hook and on-screen text", empty),
  jsonFile("overlays/visuals.json", "visuals", z.array(Visual), "Motion graphics and cutaways", empty),
  jsonFile("motion/effects.json", "effects", z.array(Effect), "Shakes, whips, flashes", empty),
  jsonFile("audio/music.json", "music", Music, "Music track, volume and ducking", () => Music.parse({})),
  jsonFile("audio/mix.json", "mix", Mix, "How the sound is finished: voice, loudness, levels", () =>
    Mix.parse({}),
  ),
  jsonFile("export.json", "exportSettings", ExportSettings, "Codec, quality and file name", () =>
    ExportSettings.parse({}),
  ),
  jsonFile("cover.json", "cover", Cover, "The cover image: frame, headline, background", () =>
    Cover.parse({}),
  ),
  jsonFile("checks.json", "checkRules", CheckRules, "What the quality checks hold the edit to", () =>
    CheckRules.parse({}),
  ),
  jsonFile("audio/sfx.json", "sfx", z.array(Sfx), "Sound effects", empty),
  jsonFile(
    "audio/music-cues.json",
    "musicCues",
    z.array(MusicCue),
    "Music volume over stretches of the cut",
    empty,
  ),
  jsonFile("audio/music-clips.json", "musicClips", z.array(MusicClip), "More music placed in the cut", empty),
  jsonFile(
    "audio/voiceovers.json",
    "voiceovers",
    z.array(Voiceover),
    "Recordings laid over the cut as the voice",
    empty,
  ),
  jsonFile("comments/comments.json", "comments", z.array(Comment), "Notes pinned to moments", empty),
];

/**
 * A folder where every file is one item of a collection: graphics/<id>.html. Folders, not one big JSON
 * file, because these are documents people open and edit one at a time, like pages of a website.
 */
export type DirSection =
  | "graphics"
  | "captionLooks"
  | "effectKinds"
  | "transitionKinds"
  | "grades"
  | "inspirations";

export interface ProjectDir<S extends DirSection = DirSection> {
  readonly dir: string;
  readonly ext: string;
  readonly section: S;
  readonly describe: string;
  serialize(item: ItemOf<S>): string;
  parse(id: string, text: string): ItemOf<S>;
  /** The name shown in file lists, from the file's header. */
  name(item: ItemOf<S>): string | undefined;
  /** What a new project's folder starts with. */
  readonly starters: readonly ItemOf<S>[];
}

/** An item of any folder collection. */
export type DirItem = ItemOf<DirSection>;

const withNewline = (text: string) => (text.endsWith("\n") ? text : `${text}\n`);

const dir = <S extends DirSection>(d: ProjectDir<S>) => d as unknown as ProjectDir;

const styleDir = (
  folder: string,
  section: "effectKinds" | "transitionKinds" | "grades",
  describe: string,
  starters: readonly StyleFile[],
) =>
  dir({
    dir: folder,
    ext: ".css",
    section,
    describe,
    serialize: (f) => withNewline(f.css),
    parse: (id, text) => StyleFile.parse({ id, css: text }),
    name: (f) => styleMeta(f.css)?.name,
    starters,
  });

export const PROJECT_DIRS: readonly ProjectDir[] = [
  dir({
    dir: "graphics",
    ext: ".html",
    section: "graphics",
    describe: "Motion graphics, as HTML and CSS",
    serialize: (g) => withNewline(g.html),
    parse: (id, text) => Graphic.parse({ id, html: text }),
    name: (g) => graphicMeta(g.html)?.name,
    starters: STARTER_GRAPHICS,
  }),
  dir({
    dir: "captions/looks",
    ext: ".css",
    section: "captionLooks",
    describe: "Caption looks, as CSS",
    serialize: (l) => withNewline(l.css),
    parse: (id, text) => CaptionLook.parse({ id, css: text }),
    name: (l) => captionLookMeta(l.css)?.name,
    starters: STARTER_CAPTION_LOOKS,
  }),
  styleDir("effects", "effectKinds", "Effects, as CSS", STARTER_EFFECTS),
  styleDir("transitions", "transitionKinds", "Transitions between shots, as CSS", STARTER_TRANSITIONS),
  styleDir("grades", "grades", "Colour grades, as CSS", STARTER_GRADES),
  dir({
    dir: "inspirations",
    ext: ".md",
    section: "inspirations",
    describe: "Editing styles this video follows: the recipe in words, with its settings",
    serialize: (i) => withNewline(i.md),
    parse: (id, text) => Inspiration.parse({ id, md: text }),
    name: (i) => inspirationMeta(i.md)?.name,
    // Only the ones applied to it: the library is the user's, not each project's.
    starters: [],
  }),
];

/** "graphics/callout.html" -> its folder and item id, if the path is an item of a project folder. */
export function dirItem(rel: string): { dir: ProjectDir; id: string } | null {
  for (const dir of PROJECT_DIRS) {
    const prefix = `${dir.dir}/`;
    if (!rel.startsWith(prefix) || !rel.endsWith(dir.ext)) continue;
    const id = rel.slice(prefix.length, -dir.ext.length);
    if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { dir, id };
  }
  return null;
}

export const HISTORY_LOG = ".history/log.jsonl";
export const CHAT_LOG = ".history/chat.json";
/** Where older projects saved whole alternatives of the edit (no longer made; left out of copies). */
export const VERSIONS_DIR = "versions";
export const EXPORTS_DIR = "exports";
export const CACHE_DIR = ".cache";
/** Media pasted into a request (screenshots): files the project owns, unlike imports. */
export const ATTACHMENTS_DIR = "media/attachments";

const fileBySection = new Map<Section, ProjectFile>(
  PROJECT_FILES.flatMap((f) => f.sections.map((s) => [s, f] as const)),
);

export function fileForSection(section: Section): ProjectFile {
  return fileBySection.get(section)!;
}

/** Files whose content differs between two docs, by reference (docs share structure). */
export function changedFiles(prev: ProjectDoc | null, next: ProjectDoc): ProjectFile[] {
  if (!prev) return [...PROJECT_FILES];
  return PROJECT_FILES.filter((f) => f.sections.some((s) => prev[s] !== next[s]));
}

/** Entry for the Files panel: path, what it holds, and how many items. */
export interface FileEntry {
  readonly path: string;
  readonly describe: string;
  readonly count: number | null;
}

export function fileEntries(doc: ProjectDoc): FileEntry[] {
  const files = PROJECT_FILES.map((f) => {
    const value = doc[f.sections.at(-1)!];
    return { path: f.path, describe: f.describe, count: Array.isArray(value) ? value.length : null };
  });
  const dirs = PROJECT_DIRS.flatMap((d) =>
    doc[d.section].map((item) => ({
      path: `${d.dir}/${item.id}${d.ext}`,
      describe: d.name(item) ?? d.describe,
      count: null,
    })),
  );
  const fonts = doc.fonts.map((f) => ({
    path: `${FONTS_DIR}/${f.file}`,
    describe: `${f.family} ${f.weight}${f.style === "italic" ? " italic" : ""}`,
    count: null,
  }));
  const luts = doc.luts.map((l) => ({ path: `${LUTS_DIR}/${l.file}`, describe: "Colour LUT", count: null }));
  return [...files, ...dirs, ...fonts, ...luts];
}

/** The JSON header comment of a graphic: `<!-- graphic {...} -->`. */
export function graphicMeta(html: string): { name?: string; description?: string } | null {
  const m = /<!--\s*graphic\s+(\{[\s\S]*?\})\s*-->/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as { name?: string; description?: string };
  } catch {
    return null;
  }
}
