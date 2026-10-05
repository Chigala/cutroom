/**
 * What the media package downloads on first use (speech recognition, the open models), for the app to
 * show: one reporter the app sets, told about each download as it goes. Files already in place are never
 * reported, so this only ever describes real waiting.
 */
export interface DownloadState {
  /** "whisper:large-v3-turbo", "model:sounds"... */
  readonly id: string;
  /** What it's for, as the user would put it: "Speech recognition". */
  readonly label: string;
  /** Total size in bytes; 0 when unknown. */
  readonly bytes: number;
  readonly fraction: number;
  readonly state: "running" | "done" | "failed";
  readonly error?: string;
}

let reporter: ((d: DownloadState) => void) | null = null;

/** Where downloads are reported (the app's download list). */
export function onDownload(fn: ((d: DownloadState) => void) | null): void {
  reporter = fn;
}

/** Reports a download's progress, at most once per percent so a fast connection doesn't flood the window. */
export function downloadReporter(id: string, label: string, bytes: number) {
  let last = -1;
  return {
    progress(fraction: number) {
      const pct = Math.floor(fraction * 100);
      if (pct === last) return;
      last = pct;
      reporter?.({ id, label, bytes, fraction: Math.min(1, fraction), state: "running" });
    },
    done() {
      reporter?.({ id, label, bytes, fraction: 1, state: "done" });
    },
    failed(err: unknown) {
      reporter?.({
        id,
        label,
        bytes,
        fraction: 0,
        state: "failed",
        error: (err as Error).message?.slice(0, 200),
      });
    },
  };
}

/**
 * Downloads `url` to `dest`, streamed to disk and hashed on the way, reporting as it goes; the file only
 * takes its name once its SHA-256 matches. Throws (and leaves nothing behind) when it doesn't.
 */
export async function downloadVerified(
  url: string,
  dest: string,
  sha256: string,
  report: ReturnType<typeof downloadReporter>,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const { createHash } = await import("node:crypto");
  const { createWriteStream } = await import("node:fs");
  const { mkdir, rename, rm } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { once } = await import("node:events");
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`The download failed (${res.status})`);
    const total = Number(res.headers.get("content-length")) || 0;
    const hash = createHash("sha256");
    const out = createWriteStream(part);
    let got = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, "drain");
      got += chunk.length;
      if (total) {
        report.progress(got / total);
        onProgress?.(got / total);
      }
    }
    out.end();
    await once(out, "finish");
    if (hash.digest("hex") !== sha256)
      throw new Error("The download didn't match its checksum; not using it");
    await rename(part, dest);
    report.done();
  } catch (err) {
    await rm(part, { force: true });
    report.failed(err);
    throw err;
  }
}
