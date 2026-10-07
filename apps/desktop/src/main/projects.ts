/**
 * Projects as things in a list: a thumbnail of each (a frame of its first shot, kept in its cache), and
 * copies of one, either of the edit or of just its footage.
 */
import { constants, existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { grabFrame } from "@vedit/media";
import {
  ATTACHMENTS_DIR,
  CACHE_DIR,
  type Collection,
  EXPORTS_DIR,
  fileForSection,
  Music,
  nextId,
  type Op,
  type ProjectDoc,
  type Scene,
  VERSIONS_DIR,
} from "@vedit/project";
import { cachePaths } from "./indexer.ts";

export const thumbFile = (dir: string) => path.join(dir, CACHE_DIR, "thumb.jpg");

type Timeline = Pick<ProjectDoc, "scenes" | "sources">;

/** Just the shots and clips of a project that isn't open: enough for its thumbnail. */
export async function readTimeline(dir: string): Promise<Timeline> {
  const part = async (section: "scenes" | "sources") => {
    const f = fileForSection(section);
    return f.parse(await readFile(path.join(dir, f.path), "utf8"));
  };
  const [scenes, sources] = await Promise.all([part("scenes"), part("sources")]);
  return { scenes: scenes.scenes ?? [], sources: sources.sources ?? [] };
}

/**
 * Writes the thumbnail: a small frame from early in the first shot. False when there's no footage (and
 * then any old one goes, so the list doesn't show footage the edit no longer has).
 */
export async function makeThumbnail(dir: string, doc: Timeline): Promise<boolean> {
  // Queued behind others, the project may have gone to the Trash meanwhile: don't bring its folder back.
  if (!existsSync(dir)) return false;
  for (const scene of doc.scenes) {
    const src = doc.sources.find((s) => s.id === scene.source);
    if (!src?.path || src.kind === "audio" || src.kind === "solid" || !existsSync(src.path)) continue;
    const proxy = cachePaths(dir, src.id).proxy;
    // A beat in, past a fade or a blink on the first frame.
    const t =
      src.kind === "image"
        ? 0
        : Math.max(0, Math.min(scene.in + Math.min(1, (scene.out - scene.in) / 2), src.duration - 0.05));
    const jpeg = await grabFrame(existsSync(proxy) ? proxy : src.path, t, 120);
    await mkdir(path.dirname(thumbFile(dir)), { recursive: true });
    await writeFile(thumbFile(dir), jpeg);
    return true;
  }
  await rm(thumbFile(dir), { force: true });
  return false;
}

/** What a copy leaves behind: the history and chat (a copy starts its own), old versions and exports. */
const NOT_COPIED = new Set([".history", VERSIONS_DIR, EXPORTS_DIR, ".git"]);

/** Copies a project folder, cache included (clones on APFS, so proxies cost no space). */
export async function copyProject(from: string, to: string): Promise<void> {
  await cp(from, to, {
    recursive: true,
    errorOnExist: true,
    force: false,
    mode: constants.COPYFILE_FICLONE,
    filter: (src) => !NOT_COPIED.has(path.relative(from, src).split(path.sep)[0]!),
  });
}

/** Whether `file` is inside `dir`, with either separator (Windows takes both, and joins with a backslash). */
const within = (dir: string, file: string) =>
  file.replaceAll("\\", "/").startsWith(`${dir.replaceAll("\\", "/")}/`);

/** A copy's sources that live in the original's folder, pointed at the copy's own files instead. */
export function relinkOps(doc: Pick<ProjectDoc, "sources">, from: string, to: string): Op[] {
  return doc.sources.flatMap((s): Op[] =>
    s.path && within(from, s.path)
      ? [{ op: "update", coll: "sources", id: s.id, patch: { path: to + s.path.slice(from.length) } }]
      : [],
  );
}

/** The doc as relinkOps leaves it (for what's worked out from it in the same commit). */
export function relinked(doc: ProjectDoc, from: string, to: string): ProjectDoc {
  return {
    ...doc,
    sources: doc.sources.map((s) =>
      s.path && within(from, s.path) ? { ...s, path: to + s.path.slice(from.length) } : s,
    ),
  };
}

/** Everything that's the edit rather than the footage or the taste: cleared to start again. */
const EDIT: readonly Collection[] = [
  "scenes",
  "zooms",
  "captions",
  "wordEdits",
  "titles",
  "visuals",
  "effects",
  "sfx",
  "musicCues",
  "musicClips",
  "voiceovers",
  "comments",
];

/**
 * The ops that take a project back to its footage: the edit cleared, the song unchosen, and each
 * imported clip on the timeline whole, as after an import. Stock clips and attachments stay in the
 * library; the analysis, looks and style files stay as they are.
 */
export function footageOps(dir: string, doc: ProjectDoc): Op[] {
  const ops: Op[] = EDIT.flatMap((coll) =>
    doc[coll].map((item): Op => ({ op: "remove", coll, id: item.id })),
  );
  // media/attachments holds both what was pasted into a request and imports dragged from a temporary
  // folder: one there counts as footage when the edit had it on the timeline.
  const attachments = path.join(dir, ATTACHMENTS_DIR);
  const onTimeline = new Set(doc.scenes.map((s) => s.source));
  const imported = doc.sources.filter(
    (s) => s.path && !s.origin && (!within(attachments, s.path) || onTimeline.has(s.id)),
  );
  const videos = imported.filter((s) => s.kind === "video");
  const clips = videos.length ? videos : imported.filter((s) => s.kind === "image");
  const scenes: Scene[] = [];
  for (const src of clips) {
    const length = src.kind === "image" ? 2 : src.duration;
    if (length <= 0.05) continue;
    const scene: Scene = {
      id: nextId("sc", scenes),
      source: src.id,
      in: 0,
      out: Math.round(length * 1000) / 1000,
      note: "",
      volume: 1,
    } as Scene;
    scenes.push(scene);
    ops.push({ op: "insert", coll: "scenes", item: scene });
  }
  // The cover's moment was picked in the old cut.
  ops.push({ op: "merge", key: "cover", patch: { at: null } });
  if (doc.music.source) {
    const { source: _s, label: _l, credit: _c, offset: _o, section: _sec, fitted: _f, ...style } = doc.music;
    ops.push({ op: "set", key: "music", value: Music.parse(style) });
  }
  return ops;
}
