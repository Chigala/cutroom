/**
 * Sound effects from Freesound's half a million recordings, the ones licensed for any use (CC0, or
 * CC BY with a credit): searched through Freesound's API with a key, or through Openverse (which
 * indexes Freesound and needs none). The agent picks by title, length and licence, the file comes into
 * the project as an audio clip, and where it hits hardest is measured so the hit can land on the moment.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { PEAKS_PER_SECOND, waveformPeaks } from "./audio.ts";

const withTimeout = (signal: AbortSignal | undefined, ms: number) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

export interface SoundCandidate {
  /** "fs-123456" (the Freesound id). */
  readonly id: string;
  readonly title: string;
  /** Seconds. */
  readonly duration: number;
  /** "CC0" or "CC BY 4.0". */
  readonly license: string;
  /** Needs a credit (CC BY). */
  readonly credit: boolean;
  readonly author: string;
  /** The audio (an MP3 preview at about 128 kbps). */
  readonly url: string;
  /** Its page, for credits. */
  readonly page: string;
  readonly tags: readonly string[];
}

const Freesound = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      duration: z.number(),
      license: z.string(),
      username: z.string(),
      url: z.string(),
      tags: z.array(z.string()).default([]),
      previews: z.record(z.string(), z.string()),
    }),
  ),
});

const Openverse = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      duration: z.number().nullable().optional(),
      license: z.string(),
      license_version: z.string().nullable().optional(),
      creator: z.string().nullable().optional(),
      url: z.string(),
      foreign_landing_url: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      tags: z
        .array(z.object({ name: z.string() }))
        .nullable()
        .optional(),
    }),
  ),
});

/** Freesound's licence URL or Openverse's code, as a short name; null for licences that don't allow any use. */
function licenseOf(code: string, version?: string | null): { license: string; credit: boolean } | null {
  const c = code.toLowerCase();
  if (c === "cc0" || c.includes("publicdomain/zero") || c === "pdm") return { license: "CC0", credit: false };
  if (c === "by" || /licenses\/by\/\d/.test(c)) {
    const v = version ?? /by\/([\d.]+)/.exec(c)?.[1] ?? "4.0";
    return { license: `CC BY ${v}`, credit: true };
  }
  return null;
}

const fsId = (page: string) => /sounds\/(\d+)/.exec(page)?.[1];

/** Sounds for `query` up to `maxSeconds` long, best matches first. */
export async function findSounds(
  query: string,
  {
    freesoundKey,
    maxSeconds = 8,
    signal,
  }: { freesoundKey?: string; maxSeconds?: number; signal?: AbortSignal } = {},
): Promise<SoundCandidate[]> {
  if (freesoundKey) {
    const url = new URL("https://freesound.org/apiv2/search/text/");
    url.searchParams.set("query", query);
    url.searchParams.set("fields", "id,name,duration,license,username,url,tags,previews");
    url.searchParams.set(
      "filter",
      `duration:[0 TO ${maxSeconds}] license:("Creative Commons 0" OR "Attribution")`,
    );
    url.searchParams.set("page_size", "15");
    url.searchParams.set("token", freesoundKey);
    const res = await fetch(url, { signal: withTimeout(signal, 15_000) });
    if (!res.ok) throw new Error(`Freesound answered ${res.status}`);
    return Freesound.parse(await res.json()).results.flatMap((r) => {
      const lic = licenseOf(r.license);
      const audio = r.previews["preview-hq-mp3"] ?? r.previews["preview-lq-mp3"];
      return lic && audio
        ? [
            {
              id: `fs-${r.id}`,
              title: r.name,
              duration: Math.round(r.duration * 100) / 100,
              ...lic,
              author: r.username,
              url: audio,
              page: r.url,
              tags: r.tags.slice(0, 8),
            },
          ]
        : [];
    });
  }
  const url = new URL("https://api.openverse.org/v1/audio/");
  url.searchParams.set("q", query);
  url.searchParams.set("license", "cc0,by,pdm");
  url.searchParams.set("source", "freesound");
  url.searchParams.set("page_size", "20");
  const res = await fetch(url, { signal: withTimeout(signal, 20_000) });
  if (!res.ok) throw new Error(`Openverse answered ${res.status}`);
  return Openverse.parse(await res.json())
    .results.flatMap((r) => {
      const lic = licenseOf(r.license, r.license_version);
      const seconds = (r.duration ?? 0) / 1000;
      const page = r.foreign_landing_url ?? "";
      const id = fsId(page);
      if (!lic || !id || !seconds || seconds > maxSeconds) return [];
      return [
        {
          id: `fs-${id}`,
          title: (r.title ?? "untitled").replace(/\.(wav|mp3|aiff?|flac|ogg)$/i, ""),
          duration: Math.round(seconds * 100) / 100,
          ...lic,
          author: r.creator ?? "",
          url: r.url,
          page,
          tags: (r.tags ?? []).map((t) => t.name).slice(0, 8),
        },
      ];
    })
    .slice(0, 15);
}

/** Downloads a sound into `dir` (once). */
export async function downloadSound(c: SoundCandidate, dir: string, signal?: AbortSignal): Promise<string> {
  await mkdir(dir, { recursive: true });
  const ext = path.extname(new URL(c.url).pathname).toLowerCase() || ".mp3";
  const file = path.join(dir, `${c.id}${ext}`);
  if ((await stat(file).catch(() => null))?.size) return file;
  const res = await fetch(c.url, { signal: withTimeout(signal, 60_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const partial = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(partial));
  await rename(partial, file);
  return file;
}

/**
 * Where a sound hits hardest (its loudest moment, seconds in) and where it has faded to a whisper
 * (20 dB under the hit): place it so the hit lands on the moment, and give it until the tail.
 */
export async function soundHit(file: string, signal?: AbortSignal): Promise<{ hit: number; tail: number }> {
  const peaks = await waveformPeaks(file, signal);
  let at = 0;
  for (let i = 1; i < peaks.length; i++) if (peaks[i]! > peaks[at]!) at = i;
  // Peaks are square-root scaled: 20 dB under is a tenth of the amplitude, about a third of the peak value.
  const floor = peaks[at]! * Math.sqrt(0.1);
  let end = peaks.length - 1;
  while (end > at && peaks[end]! < floor) end--;
  return {
    hit: Math.round((at / PEAKS_PER_SECOND) * 100) / 100,
    tail: Math.round(((end + 1) / PEAKS_PER_SECOND) * 100) / 100,
  };
}
