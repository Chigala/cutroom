/**
 * The agent's own media processing: an ffmpeg filter graph it writes, run on the project's clips by the
 * ffmpeg the app ships. Two ways: make a new clip (reversed, keyed, a waveform, a changed voice), or
 * measure (colour levels, black frames, silences) and read the numbers back.
 *
 * What keeps it safe: no shell and no command line of its own (the arguments are built here), inputs
 * only from the project's clips, output only into the project's folder, and a filter graph checked
 * first: no filter that reads or writes files, reaches the network, loads code or a model, or only
 * exists on some machines' hardware.
 */
import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ffmpegProgress, run } from "./exec.ts";

/** Filters never run: files, the network, plugins and models, and hardware only some machines have. */
const BLOCKED_FILTERS = new Set([
  "movie",
  "amovie",
  "sendcmd",
  "asendcmd",
  "zmq",
  "azmq",
  "frei0r",
  "frei0r_src",
  "ladspa",
  "lv2",
  "lut1d",
  "lut3d",
  "subtitles",
  "ass",
  "drawtext",
  "ocr",
  "libvmaf",
  "vmafmotion",
  "signature",
  "whisper",
  "arnndn",
  "sofalizer",
  "nnedi",
  "lensfun",
  "vidstabdetect",
  "vidstabtransform",
  "coreimage",
  "coreimagesrc",
  "derain",
  "sr",
  "dnn_classify",
  "dnn_detect",
  "dnn_processing",
]);
/** Hardware-only variants (OpenCL, Vulkan, CUDA...): not on every machine, so not here. */
const HARDWARE =
  /_(opencl|vulkan|cuda|npp|qsv|vaapi|videotoolbox|amf|d3d11|d3d12|vpp)$|^(vpp|hw|program_opencl|openclsrc)/;
/** Options that name a file or a path, in any filter. */
const FILE_OPTIONS = new Set([
  "file",
  "filename",
  "textfile",
  "fontfile",
  "fontsdir",
  "stats_file",
  "log_path",
  "model",
  "model_path",
  "weights",
  "dumpfile",
  "dump",
  "sofa",
  "db_path",
  "datapath",
  "result",
  "input",
  "destination",
  "path",
]);

/** Splits `text` on `sep` outside quotes, brackets and backslash escapes (ffmpeg's graph syntax). */
function splitTop(text: string, seps: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote = false;
  let bracket = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length) {
      cur += ch + text[++i];
      continue;
    }
    if (ch === "'") quote = !quote;
    else if (!quote && ch === "[") bracket++;
    else if (!quote && ch === "]") bracket = Math.max(0, bracket - 1);
    if (!quote && bracket === 0 && seps.includes(ch)) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

export interface GraphFilter {
  readonly name: string;
  readonly args: string;
}

/** The filters of a graph, in order: name (without @instance) and its arguments. */
export function graphFilters(graph: string): GraphFilter[] {
  return splitTop(graph, ";,")
    .map((f) => f.trim().replace(/^(\s*\[[^\]]*\]\s*)+/, ""))
    .filter(Boolean)
    .map((f) => {
      const eq = f.indexOf("=");
      const head = (eq < 0 ? f : f.slice(0, eq)).replace(/(\s*\[[^\]]*\]\s*)+$/, "").trim();
      const args = eq < 0 ? "" : f.slice(eq + 1).replace(/(\s*\[[^\]]*\]\s*)+$/, "");
      return { name: head.split("@")[0]!.trim(), args };
    });
}

/** A readable reason a graph can't run here, or null. */
export function checkGraph(graph: string, available?: ReadonlySet<string>): string | null {
  if (!graph.trim()) return "the filter graph is empty";
  if (graph.length > 4000) return "the filter graph is too long (4000 characters at most)";
  const filters = graphFilters(graph);
  if (filters.length > 64) return "too many filters (64 at most)";
  for (const { name, args } of filters) {
    if (!/^[a-z0-9_]+$/.test(name)) return `"${name}" isn't a filter name`;
    if (BLOCKED_FILTERS.has(name) || HARDWARE.test(name))
      return `the ${name} filter isn't allowed here (it reads or writes files, reaches outside the project, or needs hardware only some machines have)`;
    if (available && !available.has(name)) return `this ffmpeg has no ${name} filter`;
    for (const part of splitTop(args, ":")) {
      const key = /^\s*([a-z_]+)\s*=/.exec(part)?.[1];
      if (key && FILE_OPTIONS.has(key))
        return `the ${name} filter's ${key} option names a file, which isn't allowed here`;
    }
  }
  return null;
}

let filterList: Promise<Set<string>> | null = null;

/** The filters the app's ffmpeg has (builds differ from platform to platform). */
export function availableFilters(): Promise<Set<string>> {
  filterList ??= run("ffmpeg", ["-hide_banner", "-filters"])
    .then(({ stdout }) => {
      const names = new Set<string>();
      for (const line of stdout.split("\n")) {
        const m = /^\s*[.A-Z|]{2,4}\s+([a-z0-9_]+)\s+\S+->\S+/.exec(line);
        if (m) names.add(m[1]!);
      }
      return names;
    })
    .catch((err: unknown) => {
      filterList = null;
      throw err;
    });
  return filterList;
}

export interface ProcessInput {
  /** The clip's file. */
  readonly path: string;
  readonly kind: "video" | "image" | "audio";
  /** Seconds into the clip; the whole clip when unset. */
  readonly in?: number | undefined;
  readonly out?: number | undefined;
}

export type ProcessKind = "video" | "audio" | "image";

export interface MakeOptions {
  readonly inputs: readonly ProcessInput[];
  readonly graph: string;
  readonly kind: ProcessKind;
  /** A see-through video (after a key): VP9 with alpha in WebM, as cutouts are. */
  readonly alpha?: boolean;
  /** The folder the result goes in. */
  readonly dir: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

/** The longest clip it makes, seconds. */
export const MAX_SECONDS = 600;

/** ffmpeg's input arguments: trimmed, a photo held for its length when it has one. */
function inputArgs(inputs: readonly ProcessInput[]): string[] {
  return inputs.flatMap((i) => {
    const from = i.in ?? 0;
    const length = i.out !== undefined ? Math.max(0.04, i.out - from) : undefined;
    if (i.kind === "image")
      return length !== undefined ? ["-loop", "1", "-t", length.toFixed(3), "-i", i.path] : ["-i", i.path];
    return [
      ...(from > 0 ? ["-ss", from.toFixed(3)] : []),
      ...(length !== undefined ? ["-t", length.toFixed(3)] : []),
      "-i",
      i.path,
    ];
  });
}

/** Outputs the graph labels: [v] for the picture, [a] for the sound. */
const labels = (graph: string) => ({
  v: /\[v\]\s*(;|$)/.test(graph.trim()),
  a: /\[a\]\s*(;|$)/.test(graph.trim()),
});

/** A file name for what a recipe makes: the same recipe, the same file. */
export function processedName(o: Pick<MakeOptions, "inputs" | "graph" | "kind" | "alpha">): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([o.inputs, o.graph, o.kind, !!o.alpha]))
    .digest("hex")
    .slice(0, 16);
  const ext = o.kind === "image" ? "png" : o.kind === "audio" ? "m4a" : o.alpha ? "webm" : "mp4";
  return `${hash}.${ext}`;
}

/** The ffmpeg arguments for making a clip (the output path last). */
export function makeArgs(o: Pick<MakeOptions, "inputs" | "graph" | "kind" | "alpha">, out: string): string[] {
  const l = labels(o.graph);
  // A picture only for a photo, a sound only for audio.
  const maps = [
    ...(l.v && o.kind !== "audio" ? ["-map", "[v]"] : []),
    ...(l.a && o.kind !== "image" ? ["-map", "[a]"] : []),
  ];
  const encode =
    o.kind === "image"
      ? ["-frames:v", "1", "-c:v", "png"]
      : o.kind === "audio"
        ? ["-vn", "-c:a", "aac", "-b:a", "256k"]
        : o.alpha
          ? [
              "-c:v",
              "libvpx-vp9",
              "-pix_fmt",
              "yuva420p",
              "-b:v",
              "0",
              "-crf",
              "24",
              "-row-mt",
              "1",
              "-c:a",
              "libopus",
              "-b:a",
              "192k",
            ]
          : [
              "-c:v",
              "libx264",
              "-crf",
              "16",
              "-preset",
              "fast",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-b:a",
              "256k",
              "-movflags",
              "+faststart",
            ];
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    ...inputArgs(o.inputs),
    "-filter_complex",
    o.graph,
    ...maps,
    ...(o.kind === "image" ? [] : ["-t", String(MAX_SECONDS)]),
    ...encode,
    out,
  ];
}

/** Makes the clip a recipe describes, in `dir`: its file (made once; the same recipe reuses it). */
export async function makeProcessed(o: MakeOptions): Promise<string> {
  const problem = checkGraph(o.graph, await availableFilters());
  if (problem) throw new Error(problem);
  await mkdir(o.dir, { recursive: true });
  const out = path.join(o.dir, processedName(o));
  const part = `${out}.part${path.extname(out)}`;
  const longest = Math.max(1, ...o.inputs.map((i) => (i.out !== undefined ? i.out - (i.in ?? 0) : 0)));
  try {
    await run("ffmpeg", makeArgs(o, part), {
      ...(o.signal && { signal: o.signal }),
      ...(o.onProgress && { onStderr: ffmpegProgress(longest, o.onProgress) }),
    });
    await rename(part, out);
  } catch (err) {
    await rm(part, { force: true });
    throw new Error(readableError(err));
  }
  return out;
}

/** The ffmpeg arguments for measuring: the graph run to nowhere, its filters' reports kept. */
export function measureArgs(o: Pick<MakeOptions, "inputs" | "graph">): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-loglevel",
    "info",
    ...inputArgs(o.inputs),
    "-filter_complex",
    o.graph,
    "-t",
    String(MAX_SECONDS),
    "-f",
    "null",
    "-",
  ];
}

/** The address ffmpeg logs after a context's name: "@ 0x7f8a..." on macOS and Linux, "@ 000001F2..." on Windows. */
const ADDRESS = / @ (?:0x)?[0-9a-fA-F]+\]/;

/** Lines of a measurement it hands back at most. */
const MAX_LINES = 300;

/**
 * What a graph's filters report (metadata=print, blackdetect, silencedetect, astats, ebur128...): their
 * lines, without ffmpeg's own about the inputs and outputs, and capped.
 */
export async function measureProcessed(o: Pick<MakeOptions, "inputs" | "graph" | "signal">): Promise<string> {
  const problem = checkGraph(o.graph, await availableFilters());
  if (problem) throw new Error(problem);
  let all = "";
  try {
    await run("ffmpeg", measureArgs(o), {
      ...(o.signal && { signal: o.signal }),
      onStderr: (chunk) => {
        all += chunk;
      },
    });
  } catch (err) {
    throw new Error(readableError(err));
  }
  return filterReport(
    all,
    graphFilters(o.graph).map((f) => f.name),
  );
}

/**
 * The filters' own lines from ffmpeg's log. A filter logs as [Parsed_<name>_<n> @ ...] or by its own
 * name ([blackdetect @ ...]); a few go on in plain lines (an ebur128 summary). ffmpeg's blocks about the
 * inputs and outputs, decoders, muxers and progress go.
 */
export function filterReport(log: string, filters: readonly string[] = []): string {
  const names = new Set(filters);
  const ours = (l: string) => {
    const m = /^\[([A-Za-z0-9_]+) @ (?:0x)?[0-9a-fA-F]+\]/.exec(l);
    return !!m && (m[1]!.startsWith("Parsed_") || names.has(m[1]!));
  };
  const kept: string[] = [];
  let skipping = false;
  for (const l of log.split(/\r?\n/)) {
    if (!l.trim()) continue;
    if (/^(Input #|Output #|Stream mapping|Press \[q\])/.test(l)) {
      skipping = true;
      continue;
    }
    // ffmpeg's blocks run on in indented lines; a filter's summary follows its own line.
    if (/^\s/.test(l)) {
      if (!skipping && kept.length) kept.push(l);
      continue;
    }
    skipping = false;
    if (ours(l)) kept.push(l.replace(ADDRESS, "]"));
  }
  if (!kept.length)
    return "(the filters reported nothing: add metadata=print, or a filter that reports, such as blackdetect or silencedetect)";
  if (kept.length <= MAX_LINES) return kept.join("\n");
  return [
    ...kept.slice(0, MAX_LINES - 50),
    `... ${kept.length - MAX_LINES} lines left out (measure fewer frames: fps=1 or select before metadata=print) ...`,
    ...kept.slice(-50),
  ].join("\n");
}

/** ffmpeg's complaint, short: the lines that say what went wrong. */
function readableError(err: unknown): string {
  const text = (err as Error).message ?? String(err);
  const useful = text
    .split("\n")
    .filter((l) =>
      /error|invalid|no such|not found|unable|cannot|failed|unknown|mismatch|matches no streams|undefined/i.test(
        l,
      ),
    )
    .map((l) => l.replace(ADDRESS, "]").trim())
    .slice(-6);
  return useful.length ? useful.join("\n") : text.slice(-800);
}
