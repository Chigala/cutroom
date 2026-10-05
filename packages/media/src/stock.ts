/**
 * Stock footage from Pexels and Pixabay (free to use, commercial use included, no attribution
 * required): search both, show the candidates as one numbered contact sheet so the agent can look
 * before it picks, then download the one it chose. Each needs a free API key.
 */
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { run } from "./exec.ts";

/** The caller's signal, if any, plus a deadline: a stalled request fails instead of hanging the edit. */
const withTimeout = (signal: AbortSignal | undefined, ms: number) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

export interface StockKeys {
  readonly pexels?: string;
  readonly pixabay?: string;
}

export type StockKind = "video" | "photo";
export type StockOrientation = "portrait" | "landscape" | "any";

export interface StockCandidate {
  /** "pexels-123" or "pixabay-456" (photos: "pexels-photo-123"). */
  readonly id: string;
  readonly provider: "pexels" | "pixabay";
  readonly kind: StockKind;
  readonly width: number;
  readonly height: number;
  /** Seconds; 0 for photos. */
  readonly duration: number;
  /** What the site says it shows (tags or alt text). */
  readonly about: string;
  readonly thumb: string;
  readonly download: string;
  /** The page on the stock site, for credits. */
  readonly page: string;
  readonly author: string;
}

export const STOCK_LICENSE = {
  pexels: "Pexels License (free to use, no attribution required)",
  pixabay: "Pixabay Content License (free to use, no attribution required)",
} as const;

const getJson = async (url: string, headers: Record<string, string> = {}, signal?: AbortSignal) => {
  const res = await fetch(url, { headers, signal: withTimeout(signal, 15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json() as Promise<unknown>;
};

const PexelsVideos = z.object({
  videos: z.array(
    z.object({
      id: z.number(),
      width: z.number(),
      height: z.number(),
      duration: z.number(),
      url: z.string(),
      image: z.string(),
      user: z.object({ name: z.string() }).optional(),
      video_files: z.array(
        z.object({
          link: z.string(),
          file_type: z.string().nullable().optional(),
          width: z.number().nullable().optional(),
          height: z.number().nullable().optional(),
        }),
      ),
    }),
  ),
});

const PexelsPhotos = z.object({
  photos: z.array(
    z.object({
      id: z.number(),
      width: z.number(),
      height: z.number(),
      url: z.string(),
      alt: z.string().nullable().optional(),
      photographer: z.string().optional(),
      src: z.object({ large2x: z.string(), medium: z.string(), original: z.string() }),
    }),
  ),
});

const PixabayVideos = z.object({
  hits: z.array(
    z.object({
      id: z.number(),
      duration: z.number(),
      tags: z.string(),
      pageURL: z.string(),
      user: z.string().optional(),
      videos: z.record(
        z.string(),
        z.object({
          url: z.string(),
          width: z.number(),
          height: z.number(),
          thumbnail: z.string().optional(),
        }),
      ),
    }),
  ),
});

const PixabayPhotos = z.object({
  hits: z.array(
    z.object({
      id: z.number(),
      tags: z.string(),
      pageURL: z.string(),
      user: z.string().optional(),
      imageWidth: z.number(),
      imageHeight: z.number(),
      webformatURL: z.string(),
      largeImageURL: z.string(),
    }),
  ),
});

/** The rendition closest to 1080 on its short side: sharp enough, not a 4K download. */
const nearest1080 = <T extends { width?: number | null; height?: number | null }>(files: T[]) =>
  [...files].sort(
    (a, b) =>
      Math.abs(Math.min(a.width ?? 0, a.height ?? 0) - 1080) -
      Math.abs(Math.min(b.width ?? 0, b.height ?? 0) - 1080),
  )[0];

async function pexels(
  query: string,
  kind: StockKind,
  orientation: StockOrientation,
  key: string,
  signal?: AbortSignal,
): Promise<StockCandidate[]> {
  const o = orientation === "any" ? "" : `&orientation=${orientation}`;
  if (kind === "video") {
    const data = PexelsVideos.parse(
      await getJson(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}${o}&per_page=12`,
        { Authorization: key },
        signal,
      ),
    );
    return data.videos.flatMap((v) => {
      const file = nearest1080(
        v.video_files.filter((f) => f.file_type === "video/mp4" && (f.width ?? 0) >= 540),
      );
      if (!file) return [];
      return [
        {
          id: `pexels-${v.id}`,
          provider: "pexels" as const,
          kind,
          width: file.width ?? v.width,
          height: file.height ?? v.height,
          duration: v.duration,
          about: decodeURIComponent(v.url.split("/").filter(Boolean).at(-1) ?? "")
            .replace(/-\d+$/, "")
            .replace(/-/g, " "),
          thumb: v.image,
          download: file.link,
          page: v.url,
          author: v.user?.name ?? "",
        },
      ];
    });
  }
  const data = PexelsPhotos.parse(
    await getJson(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}${o}&per_page=12`,
      { Authorization: key },
      signal,
    ),
  );
  return data.photos.map((p) => ({
    id: `pexels-photo-${p.id}`,
    provider: "pexels" as const,
    kind,
    width: p.width,
    height: p.height,
    duration: 0,
    about: p.alt ?? "",
    thumb: p.src.medium,
    download: p.src.large2x,
    page: p.url,
    author: p.photographer ?? "",
  }));
}

async function pixabay(
  query: string,
  kind: StockKind,
  orientation: StockOrientation,
  key: string,
  signal?: AbortSignal,
): Promise<StockCandidate[]> {
  const q = `key=${encodeURIComponent(key)}&q=${encodeURIComponent(query.slice(0, 100))}&per_page=12&safesearch=true`;
  if (kind === "video") {
    const data = PixabayVideos.parse(await getJson(`https://pixabay.com/api/videos/?${q}`, {}, signal));
    return data.hits.flatMap((h) => {
      const renditions = Object.values(h.videos).filter((v) => v.url && v.width > 0);
      const file = nearest1080(renditions);
      if (!file) return [];
      const portrait = file.height > file.width;
      if (orientation !== "any" && portrait !== (orientation === "portrait")) return [];
      return [
        {
          id: `pixabay-${h.id}`,
          provider: "pixabay" as const,
          kind,
          width: file.width,
          height: file.height,
          duration: h.duration,
          about: h.tags,
          thumb: renditions.find((v) => v.thumbnail)?.thumbnail ?? "",
          download: file.url,
          page: h.pageURL,
          author: h.user ?? "",
        },
      ];
    });
  }
  const o =
    orientation === "portrait"
      ? "&orientation=vertical"
      : orientation === "landscape"
        ? "&orientation=horizontal"
        : "";
  const data = PixabayPhotos.parse(
    await getJson(`https://pixabay.com/api/?${q}&image_type=photo${o}`, {}, signal),
  );
  return data.hits.map((h) => ({
    id: `pixabay-photo-${h.id}`,
    provider: "pixabay" as const,
    kind,
    width: h.imageWidth,
    height: h.imageHeight,
    duration: 0,
    about: h.tags,
    thumb: h.webformatURL,
    download: h.largeImageURL,
    page: h.pageURL,
    author: h.user ?? "",
  }));
}

/**
 * Searches every site there's a key for, interleaving their results (best of each first). A site that
 * fails is skipped; with no keys at all, it throws so the agent can say what's missing.
 */
export async function searchStock(
  query: string,
  {
    kind = "video",
    orientation = "any",
    keys,
    limit = 12,
    signal,
  }: {
    kind?: StockKind;
    orientation?: StockOrientation;
    keys: StockKeys;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<StockCandidate[]> {
  const searches = [
    keys.pexels ? pexels(query, kind, orientation, keys.pexels, signal) : null,
    keys.pixabay ? pixabay(query, kind, orientation, keys.pixabay, signal) : null,
  ].filter((s) => s !== null);
  if (!searches.length)
    throw new Error("No stock footage keys: add a Pexels or Pixabay API key in Settings.");
  const settled = await Promise.allSettled(searches);
  const lists = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (!lists.length)
    throw new Error((settled[0] as PromiseRejectedResult).reason?.message ?? "Stock search failed");
  const out: StockCandidate[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++)
    for (const l of lists) if (l[i] && out.length < limit) out.push(l[i]!);
  return out;
}

/**
 * The candidates as one JPEG: thumbnails in a grid, left to right and top to bottom in the order of
 * the list, each the same size so portrait and landscape read at a glance.
 */
export async function stockSheet(
  /** Stock, or anything else with a thumbnail URL (meme candidates use it too). */
  candidates: readonly { readonly thumb: string }[],
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-stock-"));
  try {
    const files = await Promise.all(
      candidates.map(async (c, i) => {
        if (!c.thumb) return null;
        const res = await fetch(c.thumb, { signal: withTimeout(signal, 10_000) }).catch(() => null);
        if (!res?.ok) return null;
        const raw = path.join(dir, `raw-${i}`);
        await writeFile(raw, Buffer.from(await res.arrayBuffer()));
        // Letterbox into a square tile so every candidate keeps its shape.
        const tile = path.join(dir, `${String(i).padStart(3, "0")}.jpg`);
        await run(
          "ffmpeg",
          [
            "-v",
            "error",
            "-y",
            "-i",
            raw,
            "-vf",
            "scale=300:300:force_original_aspect_ratio=decrease,pad=300:300:(ow-iw)/2:(oh-ih)/2:color=0x202020",
            "-frames:v",
            "1",
            tile,
          ],
          signal ? { signal } : {},
        ).catch(() => null);
        return (await stat(tile).catch(() => null)) ? tile : null;
      }),
    );
    // Missing thumbnails become blank tiles so positions still match the numbers.
    const blank = path.join(dir, "blank.jpg");
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x202020:s=300x300",
      "-frames:v",
      "1",
      blank,
    ]);
    const list = path.join(dir, "list.txt");
    await writeFile(list, files.map((f) => `file '${f ?? blank}'`).join("\n"));
    const cols = 4;
    const rows = Math.ceil(files.length / cols);
    const out = path.join(dir, "sheet.jpg");
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-vf",
        `tile=${cols}x${rows}:padding=6:margin=6:color=black`,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        out,
      ],
      signal ? { signal } : {},
    );
    return await readFile(out);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Downloads a candidate into `dir` (once: an existing file is reused). */
export async function downloadStock(c: StockCandidate, dir: string, signal?: AbortSignal): Promise<string> {
  await mkdir(dir, { recursive: true });
  const ext =
    c.kind === "video" ? ".mp4" : path.extname(new URL(c.download).pathname).toLowerCase() || ".jpg";
  const file = path.join(dir, `${c.id}${ext}`);
  if ((await stat(file).catch(() => null))?.size) return file;
  const res = await fetch(c.download, { signal: withTimeout(signal, 180_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const partial = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(partial));
  await rename(partial, file);
  return file;
}
