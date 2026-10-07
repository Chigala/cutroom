/**
 * Derived video files. Footage straight off a phone is 4K, HDR and long-GOP: lovely to keep, awful to
 * scrub. So every clip gets two copies, both cached under the project's .cache folder:
 *
 * - proxy: 540p, keyframe every half second. Seeking anywhere is instant; this is what the editor plays.
 * - master: full HD, SDR, high quality. What export renders from, so HDR never reaches the browser.
 */
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ffmpegProgress, run } from "./exec.ts";

export const HDR_TO_SDR =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

interface TranscodeOptions {
  readonly hdr: boolean;
  readonly duration: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

async function transcode(
  input: string,
  output: string,
  args: { pre?: string[]; vf: string[]; video: string[]; audio: string[] },
  o: TranscodeOptions,
) {
  await mkdir(path.dirname(output), { recursive: true });
  const ext = path.extname(output);
  // A name of its own: two runs making the same file (an app restarted mid-way, with the old one still
  // going) must never write into one file, or the copy comes out scrambled. The finished file is swapped
  // in whole.
  const tmp = `${output.slice(0, -ext.length)}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.part${ext}`;
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        ...(args.pre ?? []),
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        args.vf.filter(Boolean).join(","),
        ...args.video,
        ...args.audio,
        "-movflags",
        "+faststart",
        tmp,
      ],
      {
        ...(o.signal && { signal: o.signal }),
        ...(o.onProgress && { onStderr: ffmpegProgress(o.duration, o.onProgress) }),
      },
    );
    await rename(tmp, output);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

const SHORT_540 = "scale='if(gt(iw,ih),-2,540)':'if(gt(iw,ih),540,-2)'";

/**
 * Short side 540px, cheap to decode, seekable to any half second. Scaled before tonemapping (HDR maths
 * on a quarter of the pixels) and hardware encoded on macOS: a minute of 4K HDR takes seconds.
 */
export async function makeProxy(input: string, output: string, o: TranscodeOptions): Promise<void> {
  await makeProxyOnce(input, output, o);
  // A copy that doesn't decode would show a black picture: check it, and make it again once.
  if (await decodes(output, o.duration, o.signal)) return;
  console.warn("[proxy] preview copy didn't decode; making it again:", output);
  await rm(output, { force: true });
  await makeProxyOnce(input, output, o);
  if (!(await decodes(output, o.duration, o.signal))) {
    await rm(output, { force: true });
    throw new Error("The preview copy came out unreadable twice");
  }
}

/** Whether a video decodes cleanly at its start, middle and end (a broken file fails at once). */
export async function decodes(file: string, duration?: number, signal?: AbortSignal): Promise<boolean> {
  const at = duration && duration > 3 ? [0, duration / 2, Math.max(0, duration - 1.5)] : [0];
  for (const t of at) {
    try {
      const { stderr } = await run(
        "ffmpeg",
        ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "5", "-f", "null", "-"],
        signal ? { signal } : {},
      );
      if (/invalid nal|error splitting|missing picture|corrupt|decode_slice/i.test(stderr)) return false;
    } catch (err) {
      if (signal?.aborted) throw err;
      return false;
    }
  }
  return true;
}

async function makeProxyOnce(input: string, output: string, o: TranscodeOptions): Promise<void> {
  const vf = [SHORT_540, o.hdr ? HDR_TO_SDR : "", "format=yuv420p"];
  const audio = ["-c:a", "aac", "-b:a", "128k", "-ac", "2"];
  if (process.platform === "darwin") {
    try {
      return await transcode(
        input,
        output,
        {
          pre: ["-hwaccel", "videotoolbox"],
          vf,
          video: ["-c:v", "h264_videotoolbox", "-b:v", "2000k", "-g", "15"],
          audio,
        },
        o,
      );
    } catch (err) {
      if (o.signal?.aborted) throw err;
      // No hardware path for this file: fall through to software.
    }
  }
  await transcode(
    input,
    output,
    {
      vf,
      video: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-g", "15", "-sc_threshold", "0"],
      audio,
    },
    o,
  );
}

/** Short side up to 1080px, SDR, visually lossless. What export renders from. */
/**
 * Whether a clip can be rendered as it is: SDR H.264 in 4:2:0 at 1080p or less, which headless Chrome
 * decodes well. Anything else (HDR, HEVC from phones, 4K, 10-bit) gets a master first.
 */
export async function renderableAsIs(file: string): Promise<boolean> {
  // A see-through clip (VP9 with alpha, as cutouts and keyed clips are): Chrome draws it as it is, and
  // a master would lose the transparency.
  if (await seeThrough(file)) return true;
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,pix_fmt,width,height,color_transfer",
      "-of",
      "json",
      file,
    ]);
    const v = (JSON.parse(stdout) as { streams?: Record<string, unknown>[] }).streams?.[0];
    if (!v) return false;
    const hdr = ["smpte2084", "arib-std-b67"].includes(String(v.color_transfer));
    return (
      v.codec_name === "h264" &&
      v.pix_fmt === "yuv420p" &&
      !hdr &&
      Math.min(Number(v.width), Number(v.height)) <= 1080
    );
  } catch {
    return false;
  }
}

/**
 * Whether a video is see-through: VP8/VP9 marked with alpha (WebM keeps it beside the picture), the kind
 * the browser draws with its transparency. A preview copy or master (H.264) would lose it.
 */
export async function seeThrough(file: string): Promise<boolean> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name:stream_tags=alpha_mode",
      "-of",
      "json",
      file,
    ]);
    const v = (JSON.parse(stdout) as { streams?: { codec_name?: string; tags?: Record<string, string> }[] })
      .streams?.[0];
    const tags = Object.fromEntries(Object.entries(v?.tags ?? {}).map(([k, x]) => [k.toLowerCase(), x]));
    return (v?.codec_name === "vp9" || v?.codec_name === "vp8") && tags.alpha_mode === "1";
  } catch {
    return false;
  }
}

export function makeMaster(input: string, output: string, o: TranscodeOptions): Promise<void> {
  return transcode(
    input,
    output,
    {
      vf: [
        "scale='if(gt(iw,ih),-2,min(1080,ih))':'if(gt(iw,ih),min(1080,ih),-2)'",
        o.hdr ? HDR_TO_SDR : "",
        "format=yuv420p",
      ],
      video: ["-c:v", "libx264", "-preset", "fast", "-crf", "16", "-g", "15"],
      audio: ["-c:a", "pcm_s16le", "-ar", "48000"],
    },
    o,
  );
}

/** A JPEG of one frame, for the agent to look at and for posters. */
export async function grabFrame(
  input: string,
  time: number,
  width = 512,
  signal?: AbortSignal,
): Promise<Buffer> {
  const { stdoutBuffer } = await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(Math.max(0, time)),
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:-2`,
      "-q:v",
      "4",
      "-f",
      "image2pipe",
      "-c:v",
      "mjpeg",
      "-",
    ],
    { binary: true, ...(signal && { signal }) },
  );
  if (!stdoutBuffer.length) throw new Error(`no frame at ${time.toFixed(2)}s`);
  return stdoutBuffer;
}

/** Times (seconds) where the picture cuts to a different shot. Run on the proxy: 10x faster, same answer. */
export async function detectShots(input: string, signal?: AbortSignal): Promise<number[]> {
  const { stderr } = await run(
    "ffmpeg",
    ["-v", "info", "-i", input, "-an", "-vf", "select='gt(scene,0.32)',showinfo", "-f", "null", "-"],
    signal ? { signal } : {},
  ).catch((err: Error) => ({ stderr: err.message }));
  const shots: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const t = Math.round(Number(m[1]) * 100) / 100;
    if (!shots.length || t - shots.at(-1)! > 0.5) shots.push(t);
  }
  return shots;
}
