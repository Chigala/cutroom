/**
 * A loopback HTTP server that hands footage to the headless renderer. Chrome can't read the editor's
 * media:// protocol, so export serves the same keys over http://127.0.0.1 with range support. A random
 * token in the path keeps other local processes from reading through it.
 */

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { runtimeFile, runtimeHeaders } from "./runtime.ts";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface MediaServer {
  /** Prefix for media keys: `${base}${key}`. */
  readonly base: string;
  close(): Promise<void>;
}

export async function startMediaServer(
  resolve: (key: string) => Promise<string | null>,
): Promise<MediaServer> {
  const token = randomBytes(12).toString("hex");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const prefix = `/${token}/`;
      if (!url.pathname.startsWith(prefix)) return void res.writeHead(404).end();
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      // Scripted graphics run in a page served next to the media (see runtime.ts).
      const runtime = key.startsWith("runtime/") ? key.slice("runtime/".length) : null;
      const file = runtime !== null ? runtimeFile(runtime) : await resolve(key);
      // CORS headers on errors too, so the page sees a clean 404 instead of a CORS failure.
      if (!file) return void res.writeHead(404, { "access-control-allow-origin": "*" }).end();
      const { size } = await stat(file);
      const headers: Record<string, string> =
        runtime !== null
          ? runtimeHeaders(`http://${req.headers.host}`, runtime)
          : {
              "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
              "accept-ranges": "bytes",
              "access-control-allow-origin": "*",
            };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (!range) {
        res.writeHead(200, { ...headers, "content-length": String(size) });
        if (req.method === "HEAD") return void res.end();
        return void createReadStream(file).pipe(res);
      }
      const [, a, b] = range;
      const start = a ? Number(a) : Math.max(0, size - Number(b));
      const end = a && b ? Math.min(Number(b), size - 1) : size - 1;
      if (start >= size || start > end)
        return void res.writeHead(416, { "content-range": `bytes */${size}` }).end();
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      });
      if (req.method === "HEAD") return void res.end();
      createReadStream(file, { start, end }).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/${token}/`,
    // Cut every connection rather than wait for them: the warm browser leaves a video's response
    // half read (it stops reading once it has its frames), and a plain close would wait on it forever.
    close: () =>
      new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}
