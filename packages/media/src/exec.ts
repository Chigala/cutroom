/** Running ffmpeg and friends: binary discovery, cancellation, and progress from ffmpeg's stderr. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

/** Apps launched from Finder get a minimal PATH, so look where package managers install tools too. */
export const SEARCH_PATH = [
  ...(process.env.PATH ?? "").split(path.delimiter),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
].filter(Boolean);

/**
 * A tool that ships inside the app: ffmpeg, ffprobe, whisper, the voice cleaner, the sound classifier.
 * VEDIT_TOOLS is the app's tools folder (set by the app at startup); null outside the app or when the
 * build doesn't carry this one, and the tool is looked for on the machine instead.
 */
export function bundledTool(...parts: string[]): string | null {
  const dir = process.env.VEDIT_TOOLS;
  if (!dir) return null;
  const file = path.join(dir, ...parts);
  if (existsSync(file)) return file;
  // Windows binaries carry .exe; callers name tools without it.
  return process.platform === "win32" && existsSync(`${file}.exe`) ? `${file}.exe` : null;
}

const found = new Map<string, Promise<string>>();

export function findBinary(name: string): Promise<string> {
  let hit = found.get(name);
  if (!hit) {
    hit = (async () => {
      const file = process.platform === "win32" ? `${name}.exe` : name;
      // The app's own copy first: the version it was tested with, whatever the machine has installed.
      const shipped = bundledTool(file);
      if (shipped) return shipped;
      for (const dir of SEARCH_PATH) {
        const candidate = path.join(dir, file);
        try {
          await access(candidate);
          return candidate;
        } catch {}
      }
      found.delete(name);
      throw new MissingToolError(name);
    })();
    found.set(name, hit);
  }
  return hit;
}

export class MissingToolError extends Error {
  constructor(readonly tool: string) {
    super(
      process.env.VEDIT_TOOLS
        ? `${tool} is missing from the app. Reinstall the app to restore it.`
        : tool === "ffmpeg" || tool === "ffprobe"
          ? "ffmpeg is not installed. Install it with: brew install ffmpeg"
          : `${tool} is not installed.`,
    );
    this.name = "MissingToolError";
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly onStderr?: (chunk: string) => void;
  /** Collect stdout as a Buffer instead of a string (for raw audio). */
  readonly binary?: boolean;
}

export async function run(
  tool: string,
  args: readonly string[],
  { signal, onStderr, binary }: RunOptions = {},
): Promise<{ stdout: string; stdoutBuffer: Buffer; stderr: string }> {
  const cmd = path.isAbsolute(tool) ? tool : await findBinary(tool);
  if (signal?.aborted) throw new CancelledError();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let stderr = "";
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      // Keep the tail only: ffmpeg can write megabytes of progress.
      stderr = (stderr + chunk).slice(-20_000);
      onStderr?.(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new CancelledError());
      const buffer = Buffer.concat(out);
      if (code === 0) resolve({ stdout: binary ? "" : buffer.toString(), stdoutBuffer: buffer, stderr });
      else reject(new Error(`${path.basename(cmd)} exited with ${code}\n${stderr.slice(-1500)}`));
    });
  });
}

/** Calls `onProgress(0..1)` as ffmpeg reports `time=` against a known duration. */
export function ffmpegProgress(duration: number, onProgress?: (fraction: number) => void) {
  if (!onProgress || duration <= 0) return undefined;
  return (chunk: string) => {
    const m = /time=(\d+):(\d+):([\d.]+)/.exec(chunk);
    if (m) onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / duration));
  };
}

let ffmpegVersion: Promise<number> | null = null;
/**
 * The major version of the ffmpeg in use (the app's own is 9; a Linux distribution's can be 4 to 6), for
 * options that changed between them. A build that doesn't say (a development snapshot) counts as new.
 */
export function ffmpegMajor(): Promise<number> {
  ffmpegVersion ??= run("ffmpeg", ["-hide_banner", "-version"])
    .then(({ stdout }) => {
      const m = /ffmpeg version n?(\d+)\./.exec(stdout);
      return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
    })
    .catch(() => Number.POSITIVE_INFINITY);
  return ffmpegVersion;
}
