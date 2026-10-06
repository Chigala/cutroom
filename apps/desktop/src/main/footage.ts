/**
 * Steadied and slowed shots, made in the background like cutouts: a steadied shot's camera path (how
 * the camera shook, so the composition can cancel it) and a slowed shot's smooth version (in-between
 * frames, so slow motion doesn't stutter). Each is made once, cached, and recorded in its clip's
 * analysis, which is what switches it on; until then the shot plays as it is.
 */
import { existsSync } from "node:fs";
import { derivationInput, derivedPaths, makeRamp, makeSlow, once, trackCamera } from "@vedit/media";
import {
  type Analysis,
  type CameraPath,
  cameraPathCovering,
  cutoutRange,
  flowHash,
  flowRange,
  needsFlow,
  type Op,
  type ProjectDoc,
  timelineOf,
} from "@vedit/project";

export async function makeNeededFootage(
  projectDir: string,
  doc: ProjectDoc,
  {
    signal,
    onProgress,
  }: {
    signal?: AbortSignal;
    onProgress?: (source: string, fraction: number, label: string) => void;
  } = {},
): Promise<Op[]> {
  const tl = timelineOf(doc);
  const fps = doc.meta.format.fps;
  const paths = derivedPaths(projectDir);
  const tracked = new Map<string, CameraPath[]>();
  const flowed = new Map<string, string[]>();
  const add = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const scene of doc.scenes) {
    const src = doc.sources.find((s) => s.id === scene.source);
    if (src?.kind !== "video") continue;
    const analysis = doc.analyses.find((a) => a.id === scene.source);
    // Steadied: the camera's path over what shows of the shot (into a transition either side too).
    if (scene.stabilize) {
      const want = cutoutRange(scene, tl, src.duration);
      const have =
        cameraPathCovering(analysis, want.from, want.to) ??
        cameraPathCovering({ cameraPaths: tracked.get(src.id) ?? [] }, want.from, want.to);
      if (!have) {
        const input = await derivationInput(projectDir, src);
        if (input) {
          const path = await trackCamera(input, want.from, want.to, {
            fps: src.fps ?? 30,
            ...(signal && { signal }),
            onProgress: (f) => onProgress?.(src.id, f, "Steadying the shot"),
          });
          add(tracked, src.id, path);
        }
      }
    }
    // Slowed past its frames: the smooth version.
    if (needsFlow(scene, src, fps)) {
      const range = flowRange(scene, tl, src.duration);
      const hash = flowHash(scene, range, fps);
      const file = paths.flow(src.id, hash);
      const recorded = analysis?.flows?.includes(hash) || flowed.get(src.id)?.includes(hash);
      if (recorded && existsSync(file)) continue;
      if (!existsSync(file)) {
        const input = await derivationInput(projectDir, src);
        if (!input) continue;
        onProgress?.(src.id, 0, "Smoothing the slow motion");
        await once(file, () =>
          scene.ramp?.length
            ? makeRamp(input, { in: scene.in, out: scene.out, ramp: scene.ramp }, file, {
                fps,
                sourceFps: src.fps ?? 30,
                interpolate: true,
                ...(signal && { signal }),
              })
            : makeSlow(input, { ...range, speed: scene.speed ?? 1 }, file, {
                fps,
                ...(signal && { signal }),
              }),
        );
      }
      if (!recorded) add(flowed, src.id, hash);
    }
  }
  const sources = new Set([...tracked.keys(), ...flowed.keys()]);
  return [...sources].map((source): Op => {
    const existing = doc.analyses.find((a) => a.id === source);
    const patch: Pick<Analysis, "cameraPaths" | "flows"> = {};
    if (tracked.has(source)) patch.cameraPaths = [...(existing?.cameraPaths ?? []), ...tracked.get(source)!];
    if (flowed.has(source)) patch.flows = [...new Set([...(existing?.flows ?? []), ...flowed.get(source)!])];
    return existing
      ? { op: "update", coll: "analyses", id: source, patch }
      : { op: "insert", coll: "analyses", item: { id: source, silences: [], ...patch } };
  });
}
