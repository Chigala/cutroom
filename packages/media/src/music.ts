/**
 * Music beds by mood, ported from tiktok-studio's cli/music.ts: free instrumentals from Openverse
 * (Creative Commons CC0 or CC BY, so a credit line is all they ask), filtered to tracks that work under
 * a voice, and checked for a usable beat before they are offered.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type BeatMap, beatMap } from "./beats.ts";

const OpenverseResults = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      creator: z.string().nullable(),
      url: z.string(),
      foreign_landing_url: z.string().nullable(),
      license: z.string(),
      license_version: z.string().nullable(),
      duration: z.number().nullable(),
      tags: z.array(z.object({ name: z.string() })).default([]),
    }),
  ),
});
type Candidate = z.infer<typeof OpenverseResults>["results"][number];

/** What to search for each mood, and whether the edit wants a clear beat under it. */
export const MOODS: Record<string, { queries: string[]; speeds: string[]; beat: boolean }> = {
  upbeat: {
    queries: ["upbeat instrumental", "happy upbeat", "pop instrumental"],
    speeds: ["speed_medium", "speed_high"],
    beat: true,
  },
  tech: {
    queries: ["electronic instrumental", "synthwave", "tech house"],
    speeds: ["speed_medium", "speed_high"],
    beat: true,
  },
  lofi: { queries: ["lofi", "chillhop", "lofi hip hop"], speeds: ["speed_low", "speed_medium"], beat: true },
  chill: {
    queries: ["chill instrumental", "chillhop", "downtempo"],
    speeds: ["speed_low", "speed_medium"],
    beat: true,
  },
  hiphop: {
    queries: ["hip hop instrumental", "hip hop beat", "trap instrumental"],
    speeds: ["speed_medium"],
    beat: true,
  },
  afrobeats: {
    queries: ["afrobeat instrumental", "afro house", "afrobeats"],
    speeds: ["speed_medium"],
    beat: true,
  },
  tense: {
    queries: ["suspense", "tension", "dark electronic"],
    speeds: ["speed_medium", "speed_low"],
    beat: false,
  },
  cinematic: { queries: ["cinematic", "epic orchestral", "trailer"], speeds: ["speed_medium"], beat: false },
  emotional: {
    queries: ["emotional piano", "inspirational", "ambient piano"],
    speeds: ["speed_low"],
    beat: false,
  },
  corporate: {
    queries: ["corporate", "motivational", "upbeat instrumental"],
    speeds: ["speed_medium"],
    beat: true,
  },
};

const moodSpec = (mood: string) => {
  const m = mood.toLowerCase().replace(/[^a-z]/g, "");
  const known = Object.entries(MOODS).find(([key]) => m.includes(key) || key.includes(m));
  return known?.[1] ?? { queries: [`${mood} instrumental`, mood], speeds: [], beat: true };
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function search(query: string, cacheDir: string): Promise<Candidate[]> {
  const cached = path.join(cacheDir, "music", "search", `${slug(query)}.json`);
  if (existsSync(cached)) return OpenverseResults.parse(JSON.parse(await readFile(cached, "utf8"))).results;
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&category=music&license=cc0,by&page_size=20`;
  const res = await fetch(url, { headers: { "User-Agent": "ai-native-videoeditor/0.1" } });
  if (!res.ok) throw new Error(`Openverse ${res.status}`);
  const body: unknown = await res.json();
  const data = OpenverseResults.parse(body);
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, JSON.stringify(body));
  return data.results;
}

const tagsOf = (c: Candidate) => new Set(c.tags.map((t) => t.name.toLowerCase()));

// Anything sung fights the voiceover.
const isInstrumental = (c: Candidate) => {
  const tags = tagsOf(c);
  const sung = ["vocal", "vocals", "voice", "singer", "song", "rap", "lyrics"].some((t) => tags.has(t));
  return !sung && (tags.has("instrumental") || /instrumental/i.test(c.title));
};

async function download(c: Candidate, dir: string): Promise<string | null> {
  const target = path.join(dir, `${slug(c.title).slice(0, 40) || "track"}-${c.id.slice(0, 8)}.mp3`);
  if (existsSync(target)) return target;
  const res = await fetch(c.url).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("audio")) return null;
  await mkdir(dir, { recursive: true });
  const tmp = `${target}.part`;
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await rename(tmp, target);
  return target;
}

const creditOf = (c: Candidate) => {
  const license =
    c.license === "cc0"
      ? "CC0"
      : `CC ${c.license.toUpperCase()}${c.license_version ? ` ${c.license_version}` : ""}`;
  return `"${c.title}" by ${c.creator ?? "Unknown"} (${license})${c.foreign_landing_url ? ` ${c.foreign_landing_url}` : ""}`;
};

export interface FoundTrack {
  readonly file: string;
  readonly title: string;
  readonly credit: string;
  readonly beats: BeatMap;
}

/**
 * The `variant`-th track for a mood that works under a voice: instrumental, 45s to 7min, and with a
 * clear pulse when the mood wants one. Downloads into `targetDir` (the project's music folder).
 */
export async function findMusic(
  mood: string,
  { targetDir, cacheDir, variant = 0 }: { targetDir: string; cacheDir: string; variant?: number },
): Promise<FoundTrack | null> {
  const spec = moodSpec(mood);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const query of spec.queries) {
    for (const c of await search(query, cacheDir).catch(() => [])) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      candidates.push(c);
    }
  }
  const usable = candidates
    .filter((c) => isInstrumental(c) && (c.duration ?? 0) >= 45_000 && (c.duration ?? 0) <= 420_000)
    .map((c, n) => ({ c, rank: n - (spec.speeds.some((s) => tagsOf(c).has(s)) ? 100 : 0) }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.c);

  let accepted = 0;
  for (const c of usable.slice(0, variant + 8)) {
    const file = await download(c, targetDir);
    if (!file) continue;
    const beats = await beatMap(file, cacheDir).catch(() => null);
    if (!beats || (spec.beat && (beats.bpm === null || beats.pulse < 1.6))) continue;
    if (accepted++ === variant) return { file, title: c.title, credit: creditOf(c), beats };
  }
  return null;
}
