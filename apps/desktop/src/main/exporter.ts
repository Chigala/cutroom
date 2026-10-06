/** Export jobs: one at a time per window, cancellable, progress streamed to the UI. */

import { existsSync } from "node:fs";
import path from "node:path";
import type { ExportEvent } from "@vedit/bridge";
import { CancelledError } from "@vedit/media";
import { newId } from "@vedit/project";
import type { ProjectStore } from "@vedit/project/node";
import { exportVideo } from "@vedit/render";
import { settle } from "./indexer.ts";
import { here } from "./protocols.ts";
import { shotsToTrack, trackForReframe } from "./reframe.ts";
import { paths } from "./settings.ts";

declare const __RENDER_ENTRY__: string;

/** The packaged app ships a prebuilt Remotion bundle; development bundles the source on first export. */
export function entry() {
  const prebuilt = path.join(here, "../remotion");
  if (existsSync(path.join(prebuilt, "index.html"))) return { kind: "bundle" as const, dir: prebuilt };
  return { kind: "source" as const, path: __RENDER_ENTRY__, outDir: paths.remotionBundle() };
}

export class Exporter {
  private job: { id: string; controller: AbortController } | null = null;

  constructor(
    private readonly store: () => ProjectStore | null,
    private readonly emit: (e: ExportEvent) => void,
  ) {}

  start(): { jobId: string } {
    const store = this.store();
    if (!store) throw new Error("no project is open");
    if (this.job) return { jobId: this.job.id };
    const id = newId("exp");
    const controller = new AbortController();
    this.job = { id, controller };
    const started = Date.now();
    this.running = store
      .flush()
      .then(async () => {
        // Other shapes are framed on the person in each shot: find them first (cheap, and kept).
        if (shotsToTrack(store.doc).length) {
          this.emit({
            jobId: id,
            type: "progress",
            stage: "masters",
            label: "Finding the person in each shot",
            fraction: 0,
          });
          const ops = await trackForReframe(store.dir, store.doc, {
            signal: controller.signal,
            onProgress: (f) =>
              this.emit({
                jobId: id,
                type: "progress",
                stage: "masters",
                label: "Finding the person in each shot",
                fraction: f * 0.05,
              }),
          });
          if (controller.signal.aborted) throw new CancelledError();
          if (ops.length)
            store.commitAndBroadcast({ author: "index", message: "Tracked faces to reframe", ops });
        }
      })
      .then(() =>
        exportVideo({
          doc: store.doc,
          projectDir: store.dir,
          entry: entry(),
          cacheDir: paths.cache(),
          cleanerDir: paths.cleaner(),
          signal: controller.signal,
          onProgress: (p) =>
            this.emit({ jobId: id, type: "progress", stage: p.stage, label: p.label, fraction: p.fraction }),
        }),
      )
      .then((file) => this.emit({ jobId: id, type: "done", file, elapsedMs: Date.now() - started }))
      .catch((err: unknown) =>
        this.emit({
          jobId: id,
          type: "error",
          message:
            err instanceof CancelledError
              ? "Cancelled"
              : (err as Error).message.split("\n")[0]!.slice(0, 400),
        }),
      )
      .finally(() => {
        if (this.job?.id === id) this.job = null;
      });
    return { jobId: id };
  }

  /** The export under way, if any: what settled() waits for. */
  private running: Promise<unknown> = Promise.resolve();

  /** Resolves once a stopped export has wound down (before its project's folder goes away). */
  settled(): Promise<void> {
    return settle([this.running]);
  }

  cancel(jobId: unknown): void {
    if (this.job && this.job.id === jobId) this.job.controller.abort();
  }

  stop(): void {
    this.job?.controller.abort();
  }
}
