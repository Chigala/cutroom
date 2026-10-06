/**
 * Photos and sounds the app's browser can't show or play (an iPhone's HEIC, TIFF; AIFF, Apple Lossless),
 * converted once into a copy it can: a JPEG, or AAC audio. What's imported points at the copy and the
 * original stays where it was. Video doesn't need this: clips get preview and export copies of their own
 * (transcode.ts).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { run } from "./exec.ts";
import { mediaKind } from "./probe.ts";

/** Photos Chromium draws as they are. */
const PHOTOS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]);
/** Sound Chromium plays as it is, by codec (the container hardly matters). */
const SOUNDS = new Set([
  "mp3",
  "aac",
  "opus",
  "vorbis",
  "flac",
  "pcm_u8",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
]);

async function soundCodec(file: string): Promise<string | null> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "csv=p=0",
      file,
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Whether `file` needs converting before the app can show or play it. */
export async function needsConverting(file: string): Promise<boolean> {
  const kind = mediaKind(file);
  if (kind === "image") return !PHOTOS.has(path.extname(file).toLowerCase());
  if (kind === "audio") {
    const codec = await soundCodec(file);
    return codec !== null && !SOUNDS.has(codec);
  }
  return false;
}

/**
 * `file` as the app can show or play it: the file itself, or a copy converted into `dir` (made once:
 * the same file gives the same copy). Throws a readable error when it can't be converted.
 */
export async function playableCopy(file: string, dir: string): Promise<string> {
  if (!(await needsConverting(file))) return file;
  const photo = mediaKind(file) === "image";
  const stem =
    path
      .basename(file, path.extname(file))
      .replace(/[^\w .-]+/g, "")
      .trim()
      .slice(0, 60) || "file";
  const hash = createHash("sha1").update(path.resolve(file)).digest("hex").slice(0, 8);
  const out = path.join(dir, `${stem}-${hash}.${photo ? "jpg" : "m4a"}`);
  if (existsSync(out)) return out;
  await mkdir(dir, { recursive: true });
  const part = `${out}.part${path.extname(out)}`;
  try {
    if (photo && process.platform === "darwin")
      // macOS reads every photo format a Mac or iPhone makes (HEIC's tiles, depth, orientation).
      await run("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", file, "--out", part]);
    else if (photo)
      // ffmpeg 7.1 and later put HEIC's tiles back together into the whole photo.
      await run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        file,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-q:v",
        "2",
        part,
      ]);
    else await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-c:a", "aac", "-b:a", "256k", part]);
    if (!existsSync(part)) throw new Error("nothing was written");
    await rename(part, out);
    return out;
  } catch (err) {
    await rm(part, { force: true });
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(
      `Couldn't convert ${path.basename(file)} to a ${photo ? "photo" : "sound"} the app can use: ${why}`,
    );
  }
}
