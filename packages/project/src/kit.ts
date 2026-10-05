/**
 * Brand kits: a project's taste, saved to carry into the next one. Everything about how the videos look,
 * move and sound (the look and grade, captions and their looks, effects, transitions, graphics, fonts,
 * the mix, the checks, export settings, the cover's style, music levels) and STYLE.md, the taste in
 * words. Applying a kit is one undoable commit; nothing about the footage or the cut is in one.
 */
import { z } from "zod";
import type { Op } from "./ops.ts";
import {
  CaptionLook,
  CaptionStyle,
  CheckRules,
  Cover,
  ExportSettings,
  FontFile,
  Graphic,
  Id,
  Look,
  Mix,
  Music,
  type ProjectDoc,
  StyleFile,
} from "./schema.ts";

/** The music settings that are taste, not a track. */
const MUSIC_TASTE = [
  "volume",
  "duckUnderSpeech",
  "duckTo",
  "fadeIn",
  "fadeOut",
  "duckRamp",
  "lockToBeat",
  "loop",
] as const;

export const BrandKit = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  savedAt: z.number(),
  /** The project it was saved from. */
  from: z.string().max(200).default(""),
  look: Look,
  captionStyle: CaptionStyle,
  mix: Mix,
  checkRules: CheckRules,
  exportSettings: ExportSettings,
  /** The cover's style: everything but its moment and words. */
  cover: Cover.omit({ at: true, text: true }),
  music: Music.pick(
    Object.fromEntries(MUSIC_TASTE.map((k) => [k, true])) as { [K in (typeof MUSIC_TASTE)[number]]: true },
  ),
  style: z.string().max(20_000).default(""),
  captionLooks: z.array(CaptionLook).default([]),
  effectKinds: z.array(StyleFile).default([]),
  transitionKinds: z.array(StyleFile).default([]),
  grades: z.array(StyleFile).default([]),
  graphics: z.array(Graphic).default([]),
  /** Font files, kept in the kit's own fonts/ folder. */
  fonts: z.array(FontFile).default([]),
});
export type BrandKit = z.infer<typeof BrandKit>;

/** A summary for lists. */
export interface KitInfo {
  readonly id: string;
  readonly name: string;
  readonly savedAt: number;
  readonly from: string;
  readonly graphics: number;
  readonly fonts: readonly string[];
}

export const kitInfo = (k: BrandKit): KitInfo => ({
  id: k.id,
  name: k.name,
  savedAt: k.savedAt,
  from: k.from,
  graphics: k.graphics.length,
  fonts: [...new Set(k.fonts.map((f) => f.family))],
});

/** A kit of a project's taste. */
export function kitFromDoc(doc: ProjectDoc, id: string, name: string): BrandKit {
  const { at: _at, text: _text, ...cover } = doc.cover;
  return BrandKit.parse({
    id,
    name,
    savedAt: Date.now(),
    from: doc.meta.name,
    look: doc.look,
    captionStyle: doc.captionStyle,
    mix: doc.mix,
    checkRules: doc.checkRules,
    exportSettings: { ...doc.exportSettings, fileName: "" },
    cover,
    music: Object.fromEntries(MUSIC_TASTE.map((k) => [k, doc.music[k]])),
    style: doc.style,
    captionLooks: doc.captionLooks,
    effectKinds: doc.effectKinds,
    transitionKinds: doc.transitionKinds,
    grades: doc.grades,
    graphics: doc.graphics,
    fonts: doc.fonts,
  });
}

/** STYLE.md with a kit's lines added: the project's own notes stay, lines it already has aren't repeated. */
export function mergeStyle(project: string, kit: string): string {
  if (!kit.trim()) return project;
  if (!project.trim()) return kit;
  const have = new Set(
    project
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const add = kit.split("\n").filter((l) => !l.trim() || !have.has(l.trim()));
  const extra = add.join("\n").trim();
  return extra ? `${project.trimEnd()}\n\n${extra}\n` : project;
}

/** The ops that bring a kit's taste into a project (its fonts are copied separately). */
export function kitOps(doc: ProjectDoc, kit: BrandKit): Op[] {
  const files = <C extends "captionLooks" | "effectKinds" | "transitionKinds" | "grades" | "graphics">(
    coll: C,
    items: readonly { id: string }[],
  ): Op[] =>
    items.map((item) => {
      const own = (doc[coll] as readonly { id: string }[]).find((x) => x.id === item.id);
      if (!own) return { op: "insert", coll, item } as Op;
      const { id: _id, ...patch } = item as { id: string } & Record<string, unknown>;
      return { op: "update", coll, id: item.id, patch } as Op;
    });
  return [
    { op: "set", key: "look", value: kit.look },
    { op: "set", key: "captionStyle", value: kit.captionStyle },
    { op: "set", key: "mix", value: kit.mix },
    { op: "set", key: "checkRules", value: kit.checkRules },
    {
      op: "set",
      key: "exportSettings",
      value: { ...kit.exportSettings, fileName: doc.exportSettings.fileName },
    },
    { op: "set", key: "cover", value: { ...doc.cover, ...kit.cover } },
    { op: "merge", key: "music", patch: kit.music },
    { op: "set", key: "style", value: mergeStyle(doc.style, kit.style) },
    { op: "merge", key: "meta", patch: { kit: kit.id } },
    ...files("captionLooks", kit.captionLooks),
    ...files("effectKinds", kit.effectKinds),
    ...files("transitionKinds", kit.transitionKinds),
    ...files("grades", kit.grades),
    ...files("graphics", kit.graphics),
  ];
}

/** Where learned taste goes in STYLE.md. */
export const LEARNED_HEADING = "## Learned from you";

/** STYLE.md with a preference added under its learned section (made if missing), once. */
export function rememberIn(style: string, note: string): string {
  const line = `- ${note.trim().replace(/^[-*]\s*/, "")}`;
  if (style.split("\n").some((l) => l.trim() === line)) return style;
  const i = style.indexOf(LEARNED_HEADING);
  if (i < 0) return `${style.trimEnd()}${style.trim() ? "\n\n" : ""}${LEARNED_HEADING}\n${line}\n`;
  const end = style.indexOf("\n## ", i + LEARNED_HEADING.length);
  const head = end < 0 ? style.trimEnd() : style.slice(0, end).trimEnd();
  const rest = end < 0 ? "" : style.slice(end);
  return `${head}\n${line}\n${rest}`;
}
