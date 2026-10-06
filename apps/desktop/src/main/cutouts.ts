/**
 * Cutouts on demand: whenever a shot needs the person separated from the background (a background
 * change, or a graphic or title marked behind the subject), the stretch of its clip is cut out once,
 * cached, and recorded in the clip's analysis, which is what switches the subject layer on.
 */
import { existsSync } from "node:fs";
import {
  cutoutsAvailable,
  derivationInput,
  derivedPaths,
  makeBlurPlate,
  makeCutout,
  once,
} from "@vedit/media";
import {
  cutoutCovering,
  cutoutRange,
  keepTag,
  type Op,
  type ProjectDoc,
  type Scene,
  scenesNeedingCutout,
  timelineOf,
} from "@vedit/project";

/**
 * Makes every cutout `doc` needs that isn't on disk yet. Returns the ops that record new ones in the
 * clips' analyses (none when everything was already there).
 */
export async function makeNeededCutouts(
  projectDir: string,
  doc: ProjectDoc,
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (source: string, fraction: number) => void } = {},
): Promise<Op[]> {
  if (!cutoutsAvailable()) return [];
  const tl = timelineOf(doc);
  const starts = new Map(tl.scenes.map((p) => [p.scene.id, { start: p.start, end: p.start + p.duration }]));
  const paths = derivedPaths(projectDir);
  // Cutouts made now, by clip: each with what it keeps with the person (keepTag; "" for the person).
  type Made = { from: number; to: number; keep?: string };
  const added = new Map<string, Made[]>();
  const madeCovering = (scene: Scene, keep: string) =>
    added
      .get(scene.source)
      ?.find((c) => c.from <= scene.in + 1e-3 && c.to >= scene.out - 1e-3 && (c.keep ?? "") === keep) ?? null;
  for (const scene of scenesNeedingCutout(doc, starts)) {
    const keep = keepTag(scene);
    const analysis = doc.analyses.find((a) => a.id === scene.source);
    const covered = cutoutCovering(analysis, scene.in, scene.out, keep) ?? madeCovering(scene, keep);
    if (covered && existsSync(paths.cutout(scene.source, covered.from, covered.to, keep))) continue;
    const src = doc.sources.find((s) => s.id === scene.source);
    if (!src) continue;
    const input = await derivationInput(projectDir, src);
    if (!input) continue;
    const range = covered ?? cutoutRange(scene);
    const made: Made = { ...range, ...(keep && { keep }) };
    const file = paths.cutout(scene.source, range.from, range.to, keep);
    // Already on disk (made before, then undone and redone): just record it again.
    if (existsSync(file)) {
      if (!covered) added.set(scene.source, [...(added.get(scene.source) ?? []), made]);
      continue;
    }
    await once(file, () =>
      makeCutout(input, range.from, range.to, file, {
        ...(scene.keep && { keep: scene.keep }),
        ...(scene.person && { person: scene.person }),
        ...(signal && { signal }),
        onProgress: (f) => onProgress?.(scene.source, f),
      }),
    );
    if (!covered) added.set(scene.source, [...(added.get(scene.source) ?? []), made]);
  }
  // Blurred backgrounds: the background blurred without the person in it, so no halo forms around them.
  const plates = new Map<string, { from: number; to: number; amount: number; keep: string }[]>();
  const W = doc.meta.format.width;
  const H = doc.meta.format.height;
  for (const scene of scenesNeedingCutout(doc, starts)) {
    if (scene.background?.kind !== "blur") continue;
    const amount = scene.background.amount ?? 18;
    const keep = keepTag(scene);
    const c =
      cutoutCovering(
        doc.analyses.find((a) => a.id === scene.source),
        scene.in,
        scene.out,
        keep,
      ) ?? madeCovering(scene, keep);
    const src = doc.sources.find((s) => s.id === scene.source);
    if (!c || !src?.width || !src.height) continue;
    const file = paths.blur(scene.source, c.from, c.to, amount, keep);
    if (!existsSync(file)) {
      const input = await derivationInput(projectDir, src);
      if (!input) continue;
      // The blur in the clip's own pixels: the frame shows it scaled up (or down) to cover.
      const shown = Math.max(W / src.width, H / src.height) * (scene.framing?.scale ?? 1);
      await once(file, () =>
        makeBlurPlate(input, paths.cutout(scene.source, c.from, c.to, keep), c.from, c.to, file, {
          radius: amount / shown,
          ...(signal && { signal }),
        }),
      );
    }
    if (!(c as { blurs?: number[] }).blurs?.includes(amount))
      plates.set(scene.source, [
        ...(plates.get(scene.source) ?? []),
        { from: c.from, to: c.to, amount, keep },
      ]);
  }
  const sources = new Set([...added.keys(), ...plates.keys()]);
  return [...sources].flatMap((source): Op[] => {
    const existing = doc.analyses.find((a) => a.id === source);
    if (!existing) return [];
    const cutouts = [...(existing.cutouts ?? []), ...(added.get(source) ?? [])].map((c) => {
      const more = (plates.get(source) ?? [])
        .filter((p) => p.from === c.from && p.to === c.to && p.keep === (c.keep ?? ""))
        .map((p) => p.amount);
      return more.length
        ? { ...c, blurs: [...new Set([...((c as { blurs?: number[] }).blurs ?? []), ...more])] }
        : c;
    });
    return [{ op: "update", coll: "analyses", id: source, patch: { cutouts } }];
  });
}
