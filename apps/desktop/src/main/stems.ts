/**
 * Clips whose sound is split into the voice and the music under it, made in the background like cutouts:
 * for every clip a shot takes some of its own music out of (scene.ownMusic). Each is made once, cached,
 * and recorded in its clip's analysis (stems: the model), which is what switches it on; until then the
 * shot plays its sound as recorded.
 */
import { canSeparate, makeStems, STEMS_MODEL } from "@vedit/media";
import { type Op, type ProjectDoc, splitsSound } from "@vedit/project";

export async function makeNeededStems(
  projectDir: string,
  doc: ProjectDoc,
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (source: string, fraction: number) => void } = {},
): Promise<Op[]> {
  const wanted = new Set(doc.scenes.filter(splitsSound).map((s) => s.source));
  const ops: Op[] = [];
  for (const id of wanted) {
    if (signal?.aborted) break;
    const src = doc.sources.find((s) => s.id === id);
    if (!src?.path || !src.hasAudio || (src.kind !== "video" && src.kind !== "audio")) continue;
    if (!canSeparate()) throw new Error("Taking music out of a clip isn't available on this computer.");
    const analysis = doc.analyses.find((a) => a.id === id);
    const current = analysis?.stems === STEMS_MODEL;
    await makeStems(projectDir, src, {
      current,
      ...(signal && { signal }),
      onProgress: (f) => onProgress?.(id, f),
    });
    if (current) continue;
    ops.push(
      analysis
        ? { op: "update", coll: "analyses", id, patch: { stems: STEMS_MODEL } }
        : { op: "insert", coll: "analyses", item: { id, silences: [], stems: STEMS_MODEL } },
    );
  }
  return ops;
}
