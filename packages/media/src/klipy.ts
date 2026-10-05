/**
 * Meme media from KLIPY (klipy.com, the GIF library that replaced Tenor's API): reaction GIFs,
 * see-through stickers, short clips and static meme images, searched by keyword. A candidate is
 * downloaded into the project when it's used, in a form the editor plays frame-exactly: GIFs and clips
 * as MP4, stickers as WebM with their transparency, memes as images.
 *
 * Attribution: KLIPY asks for "Search KLIPY" as the placeholder of any search box over its content, and
 * credits are written with the export (credits.txt). Their standard terms load media straight from their
 * servers; keeping copies in a project (needed to edit and export it) is for local development until
 * KLIPY approves this integration.
 */
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "./exec.ts";

export const MEME_KINDS = ["gif", "sticker", "clip", "meme"] as const;
export type MemeKind = (typeof MEME_KINDS)[number];

/** KLIPY's endpoint for each kind. */
const ENDPOINT: Record<MemeKind, string> = {
  gif: "gifs",
  sticker: "stickers",
  clip: "clips",
  meme: "static-memes",
};

export interface MemeCandidate {
  /** "klipy-gif-<slug>". */
  readonly id: string;
  readonly provider: "klipy";
  readonly kind: MemeKind;
  readonly slug: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  /** A small still for the contact sheet. */
  readonly thumb: string;
  /** The file to download, and its format. */
  readonly download: string;
  readonly format: "mp4" | "webm" | "gif" | "webp" | "jpg" | "png";
  /** Where it lives on KLIPY, for credits. */
  readonly page: string;
}

interface Rendition {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** Every {url, width, height} under a node, by format, largest tier first (hd, md, sm, xs). */
function renditions(file: unknown): Map<string, Rendition[]> {
  const out = new Map<string, Rendition[]>();
  const tiers = ["hd", "md", "sm", "xs"];
  const visit = (node: unknown, key: string) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n.url === "string" && /^https:\/\//.test(n.url)) {
      out.set(key, [
        ...(out.get(key) ?? []),
        { url: n.url, width: Number(n.width) || 0, height: Number(n.height) || 0 },
      ]);
      return;
    }
    const keys = Object.keys(n).sort((a, b) => {
      const ia = tiers.indexOf(a);
      const ib = tiers.indexOf(b);
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
    });
    for (const k of keys) visit(n[k], tiers.includes(k) ? key : k);
  };
  visit(file, "");
  return out;
}

/** What to download for each kind, in order of preference: MP4 plays best; stickers need transparency. */
const PREFER: Record<MemeKind, readonly MemeCandidate["format"][]> = {
  gif: ["mp4", "webm", "gif"],
  clip: ["mp4", "webm"],
  sticker: ["webm", "webp", "gif", "png"],
  meme: ["png", "jpg", "webp"],
};

/** Parses one KLIPY result item (exported for tests). */
export function memeCandidate(kind: MemeKind, item: unknown): MemeCandidate | null {
  if (!item || typeof item !== "object") return null;
  const it = item as Record<string, unknown>;
  // Ads come back mixed into results; only content has a slug and files.
  if (typeof it.slug !== "string" || it.type === "ad") return null;
  const r = renditions(it.file ?? it.files ?? it);
  const format = PREFER[kind].find((f) => r.get(f)?.length);
  if (!format) return null;
  const best = r.get(format)![0]!;
  const still = r.get("jpg") ?? r.get("png") ?? r.get("webp") ?? r.get("gif");
  // The smallest still is plenty for a contact sheet tile.
  const thumb = still?.at(-1)?.url ?? best.url;
  return {
    id: `klipy-${kind}-${it.slug}`.slice(0, 60),
    provider: "klipy",
    kind,
    slug: it.slug,
    title: String(it.title ?? it.slug).slice(0, 120),
    width: best.width,
    height: best.height,
    thumb,
    download: best.url,
    format,
    page: `https://klipy.com/${ENDPOINT[kind]}/${it.slug}`,
  };
}

/** Searches KLIPY. Throws with a readable message when the key is missing or wrong. */
export async function searchMemes(
  query: string,
  {
    kind = "gif",
    key,
    customerId,
    locale = "us",
    limit = 16,
    signal,
  }: {
    kind?: MemeKind;
    key: string;
    /** A stable, anonymous id for this user (KLIPY personalises and rate-limits by it). */
    customerId: string;
    locale?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<MemeCandidate[]> {
  if (!key) throw new Error("No KLIPY API key: add one in Settings (free at partner.klipy.com).");
  const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/${ENDPOINT[kind]}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", String(Math.max(8, Math.min(50, limit))));
  url.searchParams.set("customer_id", customerId);
  url.searchParams.set("locale", locale);
  url.searchParams.set("content_filter", "medium");
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) throw new Error("KLIPY didn't accept the API key.");
  if (res.status === 429)
    throw new Error("KLIPY's hourly limit for this key is used up (test keys allow 100 an hour).");
  if (!res.ok) throw new Error(`KLIPY search failed (${res.status}).`);
  const body = (await res.json()) as { result?: boolean; data?: { data?: unknown[] } };
  const items = body.data?.data ?? [];
  return items
    .map((it) => memeCandidate(kind, it))
    .filter((c): c is MemeCandidate => c !== null)
    .slice(0, limit);
}

/**
 * Downloads a candidate into `dir` as a file the editor plays exactly: an MP4 stays as it is; a GIF
 * becomes an MP4 (or, for a sticker, a WebM that keeps its transparency); images stay images.
 * Returns the file. A second download of the same candidate is free.
 */
export async function downloadMeme(c: MemeCandidate, dir: string, signal?: AbortSignal): Promise<string> {
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, c.id);
  const isImage = c.kind === "meme";
  const sticker = c.kind === "sticker";
  const final = isImage ? `${base}.${c.format}` : sticker ? `${base}.webm` : `${base}.mp4`;
  if ((await stat(final).catch(() => null))?.size) return final;
  const res = await fetch(c.download, { signal: signal ?? AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Couldn't download from KLIPY (${res.status}).`);
  const raw = `${base}.download.${c.format}`;
  await writeFile(raw, Buffer.from(await res.arrayBuffer()));
  try {
    if (isImage || (c.format === "mp4" && !sticker) || (c.format === "webm" && sticker)) {
      await rename(raw, final);
      return final;
    }
    // Animated GIF or WebP, or a WebM for a non-sticker: re-encode for the editor.
    const part = `${final}.part${path.extname(final)}`;
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-i",
        raw,
        // Even dimensions (the codecs need them), a steady frame rate, no audio (GIFs have none).
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
        "-an",
        ...(sticker
          ? ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-auto-alt-ref", "0"]
          : ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart"]),
        part,
      ],
      signal ? { signal } : {},
    );
    await rename(part, final);
    return final;
  } finally {
    await rm(raw, { force: true });
  }
}
