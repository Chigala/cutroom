/**
 * Before exporting other shapes (or following the person): every shot of a video clip gets its faces
 * tracked, once, so each shape can be framed on the person in that shot rather than on where the clip's
 * face usually is. Recorded in the clips' analyses like the track tool's tracks.
 */
import { derivationInput, trackRange } from "@vedit/media";
import type { Op, ProjectDoc } from "@vedit/project";

/** Shots that need reframing and have no face tracked over them yet. */
export function shotsToTrack(doc: ProjectDoc) {
  if (!doc.exportSettings.formats.length && doc.look.reframe !== "follow") return [];
  return doc.scenes.filter((s) => {
    const src = doc.sources.find((x) => x.id === s.source);
    if (src?.kind !== "video" || !src.path) return false;
    const tracks = doc.analyses.find((a) => a.id === s.source)?.tracks ?? [];
    return !tracks.some((t) => t.start <= s.in + 0.25 && t.end >= s.out - 0.25);
  });
}

export async function trackForReframe(
  projectDir: string,
  doc: ProjectDoc,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<Op[]> {
  const todo = shotsToTrack(doc);
  const bySource = new Map<string, NonNullable<ProjectDoc["analyses"][number]["tracks"]>>();
  for (const [i, s] of todo.entries()) {
    if (signal?.aborted) break;
    onProgress?.(i / todo.length);
    const src = doc.sources.find((x) => x.id === s.source)!;
    const analysis = doc.analyses.find((a) => a.id === s.source);
    if (!analysis) continue;
    const input = await derivationInput(projectDir, src);
    if (!input) continue;
    const found = await trackRange(input, s.in, s.out, {
      cuts: analysis.shots,
      idPrefix: `t${Math.round(s.in * 10)}_`,
      ...(signal && { signal }),
    });
    const before = bySource.get(s.source) ?? analysis.tracks ?? [];
    // New tracks replace any earlier ones over the same stretch (as the track tool does).
    bySource.set(s.source, [
      ...before.filter((t) => t.end < s.in || t.start > s.out),
      ...found.map((t) => ({ ...t, points: [...t.points] })),
    ]);
  }
  return [...bySource].map(
    ([id, tracks]) => ({ op: "update", coll: "analyses", id, patch: { tracks } }) as Op,
  );
}
