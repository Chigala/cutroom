/**
 * Two custom schemes:
 *
 * - app://bundle/...  serves the built UI. A real origin (unlike file://) so CSP, fetch and storage
 *   behave like the web, and nothing else on disk is reachable from the page.
 * - media://<project>/<key>  streams footage for the open project (the host names the project, so
 *   two projects' clips never share an address in the renderer's caches), with HTTP range support so the
 *   player can seek inside multi-GB files without reading them. Keys are source ids, "music" or
 *   "sfx/<id>"; the page can never name a path, so it can only read files the project references.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { runtimeFile, runtimeHeaders } from "@vedit/render/runtime";
import { protocol } from "electron";

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    {
      scheme: "media",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

export const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

const notFound = () => new Response("not found", { status: 404 });

export function registerAppProtocol(rendererDir: string): void {
  const root = path.resolve(rendererDir);
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(root + path.sep)) return notFound();
    try {
      const info = await stat(file);
      if (!info.isFile()) return notFound();
      const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
      return new Response(body, {
        headers: {
          "content-type": mimeOf(file),
          "content-length": String(info.size),
          "x-content-type-options": "nosniff",
          // Only enforceable as a header, not in the page's CSP meta tag.
          "content-security-policy": "frame-ancestors 'none'",
        },
      });
    } catch {
      return notFound();
    }
  });
}

export function registerMediaProtocol(resolve: (key: string, query: string) => Promise<string | null>): void {
  protocol.handle("media", async (request) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));
    // Scripted graphics run in a sandboxed page served next to the media, with its own CSP.
    if (key.startsWith("runtime/")) {
      const rel = key.slice("runtime/".length);
      const file = runtimeFile(rel);
      if (!file) return notFound();
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        // URL.origin is "null" for custom schemes.
        headers: runtimeHeaders(`${url.protocol}//${url.host}`, rel),
      });
    }
    const file = await resolve(key, url.search.slice(1));
    if (!file) return notFound();
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return notFound();
    }
    const headers: Record<string, string> = {
      "content-type": mimeOf(file),
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range, content-length, accept-ranges",
      "cache-control": "no-cache",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (!range) {
      headers["content-length"] = String(size);
      if (request.method === "HEAD") return new Response(null, { headers });
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
    }
    const [, a, b] = range;
    // "bytes=-500" means the last 500 bytes.
    const start = a ? Number(a) : Math.max(0, size - Number(b));
    const end = a && b ? Math.min(Number(b), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    }
    headers["content-range"] = `bytes ${start}-${end}/${size}`;
    headers["content-length"] = String(end - start + 1);
    if (request.method === "HEAD") return new Response(null, { status: 206, headers });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers,
    });
  });
}

export const here = path.dirname(fileURLToPath(import.meta.url));
