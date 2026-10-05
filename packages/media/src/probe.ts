import path from "node:path";
import type { Source } from "@vedit/project";
import { run } from "./exec.ts";

const VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mts"]);
const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".tif", ".tiff"]);
const AUDIO = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".aif", ".aiff"]);

export function mediaKind(file: string): Source["kind"] | null {
  const ext = path.extname(file).toLowerCase();
  return VIDEO.has(ext) ? "video" : IMAGE.has(ext) ? "image" : AUDIO.has(ext) ? "audio" : null;
}

export const isMedia = (file: string) => mediaKind(file) !== null;

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  color_transfer?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

export type Probed = Pick<
  Source,
  "kind" | "label" | "path" | "duration" | "width" | "height" | "fps" | "hdr" | "hasAudio"
>;

export async function probe(file: string): Promise<Probed> {
  const kind = mediaKind(file) ?? "video";
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: ProbeStream[] };
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (kind === "video" && !video) throw new Error(`${path.basename(file)} has no video stream`);
  const [num, den] = (video?.avg_frame_rate ?? "0/1").split("/").map(Number);
  // Phone footage is usually stored landscape with a rotation flag.
  const rotation = Math.abs(
    Number(
      video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0,
    ),
  );
  const swap = rotation === 90 || rotation === 270;
  const transfer = video?.color_transfer ?? "";
  return {
    kind,
    // Upload tools often prefix a timestamp ("1790591104170-IMG_3415"); it's noise in a label.
    label: path.basename(file, path.extname(file)).replace(/^\d{10,}[-_ ]/, ""),
    path: file,
    duration: kind === "image" ? 0 : Math.max(0, Number(info.format?.duration ?? 0)),
    ...(video?.width &&
      video.height && {
        width: swap ? video.height : video.width,
        height: swap ? video.width : video.height,
      }),
    ...(num && den && kind === "video" && { fps: Math.round((num / den) * 100) / 100 }),
    hdr: transfer === "arib-std-b67" || transfer === "smpte2084",
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}
