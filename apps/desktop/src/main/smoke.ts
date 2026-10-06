/**
 * A packaged-app self-test: VEDIT_SMOKE=<clip> imports the clip into a fresh project, indexes it
 * (preview copy, audio, transcript), reads its picture (the words on screen: Apple's Vision on a Mac,
 * the open models elsewhere), converts a photo as an iPhone takes it (HEIC, smoke-photo.heic beside the
 * clip) to one the app can show, exports it and prints what happened as one JSON line (also written to
 * VEDIT_SMOKE_REPORT, when set), then quits. It runs with its own data folder, so it never touches the
 * user's projects or settings. No agent call. It also opens the editor's window, hidden, and checks it
 * shows the project. VEDIT_SMOKE_WHISPER picks a smaller speech model (a build machine's test).
 */
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExportEvent } from "@vedit/bridge";
import { findBinary, playableCopy, probe, run, seeClip } from "@vedit/media";
import type { ProjectService } from "./project-service.ts";

/**
 * A scripted graphic like the agent writes: it loads every library the runtime ships (gsap and its
 * plugins, three.js, lottie, d3, Chart.js, Rough.js) and the particles, and fills the frame green
 * (animated in by a gsap tween) only if all of them loaded; red if any didn't.
 */
const SMOKE_GRAPHIC = `<!-- graphic {"name":"Smoke test","description":"Checks the runtime's libraries","duration":3,"libs":["gsap","three","lottie","d3","chart","rough"]} -->
<style>.fill { position: absolute; inset: 0; opacity: 0; }</style>
<div class="fill" id="fill"></div>
<script>
  // Particles need no library: they draw behind the fill.
  graphic.particles({ preset: "confetti", behind: true });
  const fill = document.getElementById("fill");
  const loaded = typeof gsap !== "undefined" && typeof lottie !== "undefined" && typeof THREE !== "undefined"
    && new THREE.Color("#00ff00").g === 1 && typeof d3 !== "undefined" && typeof d3.scaleLinear === "function"
    && typeof Chart !== "undefined" && typeof rough !== "undefined" && typeof SplitText !== "undefined"
    && typeof DrawSVGPlugin !== "undefined" && typeof Physics2DPlugin !== "undefined";
  fill.style.background = loaded ? "#00ff00" : "#ff0000";
  gsap.to(fill, { opacity: 1, duration: 0.3 });
</script>`;

export async function runSmoke(
  service: ProjectService,
  clip: string,
  /** Opens the editor's window (hidden) and returns what its header shows. */
  ui: () => Promise<string>,
): Promise<boolean> {
  const t0 = Date.now();
  const dir = await mkdtemp(path.join(os.tmpdir(), "vedit-smoke-"));
  const report: Record<string, unknown> = { dir, tools: process.env.VEDIT_TOOLS ?? null };
  try {
    const imported = service.waitFor("importDone", () => true, 30 * 60_000);
    await service.benchProject(dir, [clip]);
    await imported;
    const doc = service.doc();
    const source = doc?.sources[0];
    report.indexMs = Date.now() - t0;
    report.source = source && { status: source.status, duration: source.duration, proxy: source.proxy };
    report.words = doc?.transcripts[0]?.words.length ?? 0;
    report.firstWords = doc?.transcripts[0]?.words
      .slice(0, 8)
      .map((w) => w.text)
      .join(" ");
    // The picture read (it runs in the background after indexing in the app; here, straight away).
    const seen = await seeClip(clip);
    report.seen = seen && { text: seen.text.map((t) => t.text), salient: seen.salient.length };
    report.readWords = (seen?.text ?? []).some((t) => /smoke|test|123/i.test(t.text));
    // A photo as an iPhone takes it (HEIC, in tiles): converted to one the app can show, and whole.
    const heic = path.join(path.dirname(clip), "smoke-photo.heic");
    if (existsSync(heic)) {
      const p = await probe(await playableCopy(heic, path.join(dir, "media", "converted")));
      report.photo = `${p.width}x${p.height}`;
    }
    // The scripted graphic, over the first shot from 0.5s to 3.5s.
    const scene = doc?.scenes[0];
    if (scene) {
      const added = await service.commit({
        message: "Smoke test graphic",
        parent: null,
        ops: [
          { op: "insert", coll: "graphics", item: { id: "smoke-libs", html: SMOKE_GRAPHIC } },
          {
            op: "insert",
            coll: "visuals",
            item: {
              id: "smoke-visual",
              anchor: { scene: scene.id, at: 0.5 },
              duration: 3,
              layout: "overlay",
              content: { kind: "graphic", graphic: "smoke-libs", params: {} },
            },
          },
        ],
      });
      report.graphic = added.ok ? "added" : added.error;
    }
    const t1 = Date.now();
    const { jobId } = service.exporter.start();
    const end = await service.waitFor(
      "export",
      (e: ExportEvent) => e.jobId === jobId && (e.type === "done" || e.type === "error"),
      30 * 60_000,
    );
    report.exportMs = Date.now() - t1;
    report.export = end;
    // The graphic's colour in the exported video at 2s: green when every library loaded and drew.
    if (end.type === "done") {
      const { stdoutBuffer } = await run(
        await findBinary("ffmpeg"),
        [
          "-v",
          "error",
          "-ss",
          "2",
          "-i",
          end.file,
          "-frames:v",
          "1",
          "-vf",
          "crop=8:8:iw/2:ih/2,scale=1:1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { binary: true },
      );
      const [r = 0, g = 0, b = 0] = stdoutBuffer;
      report.graphicPixel = [r, g, b];
      report.graphicDrew = g > 200 && r < 60 && b < 60;
    }
    report.ui = await ui();
    report.ok =
      end.type === "done" &&
      Number(report.words) > 0 &&
      report.graphicDrew === true &&
      report.readWords === true &&
      report.photo === "1600x1200";
  } catch (err) {
    report.ok = false;
    report.error = (err as Error).stack ?? String(err);
  }
  console.log(`[smoke] ${JSON.stringify(report)}`);
  if (process.env.VEDIT_SMOKE_REPORT)
    await writeFile(process.env.VEDIT_SMOKE_REPORT, JSON.stringify(report, null, 2)).catch(() => {});
  return report.ok === true;
}
