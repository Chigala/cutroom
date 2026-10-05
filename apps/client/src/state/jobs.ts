/** Background work the host is doing for us: indexing clips and exporting. Driven by host events. */
import type { ExportEvent, IndexEvent } from "@vedit/bridge";
import { create } from "zustand";
import { host } from "../lib/host.ts";
import { toast } from "./toast.ts";

interface JobsState {
  /** Latest progress per clip that is indexing. Cleared when a clip is ready. */
  indexing: Record<string, IndexEvent>;
  export: {
    jobId: string;
    status: "running" | "done" | "error";
    label: string;
    fraction: number;
    file?: string;
    error?: string;
    elapsedMs?: number;
  } | null;
}

export const useJobs = create<JobsState>()(() => ({ indexing: {}, export: null }));

export async function startExport(): Promise<void> {
  const current = useJobs.getState().export;
  if (current?.status === "running") return;
  const { jobId } = await host.exporter.start();
  useJobs.setState({ export: { jobId, status: "running", label: "Starting", fraction: 0 } });
}

export function cancelExport(): void {
  const job = useJobs.getState().export;
  if (job?.status === "running") void host.exporter.cancel(job.jobId);
}

export const dismissExport = () => useJobs.setState({ export: null });

function onExport(e: ExportEvent): void {
  useJobs.setState((s) => {
    if (s.export && s.export.jobId !== e.jobId) return s;
    switch (e.type) {
      case "progress":
        return { export: { jobId: e.jobId, status: "running", label: e.label, fraction: e.fraction } };
      case "done":
        return {
          export: {
            jobId: e.jobId,
            status: "done",
            label: "Exported",
            fraction: 1,
            file: e.file,
            elapsedMs: e.elapsedMs,
          },
        };
      case "error":
        return {
          export: { jobId: e.jobId, status: "error", label: e.message, fraction: 0, error: e.message },
        };
    }
  });
}

export function connectJobs(): () => void {
  const offIndex = host.on("index", (e) => {
    useJobs.setState((s) => {
      const indexing = { ...s.indexing };
      if (e.stage === "ready") delete indexing[e.source];
      else indexing[e.source] = e;
      return { indexing };
    });
    if (e.stage === "failed") toast(`Couldn't index a clip: ${e.error ?? "unknown error"}`, "warn");
  });
  const offExport = host.on("export", onExport);
  return () => {
    offIndex();
    offExport();
  };
}

/** Waveform envelopes, fetched once per clip. */
const peaks = new Map<string, Promise<Uint8Array | null>>();
export function peaksOf(source: string): Promise<Uint8Array | null> {
  let hit = peaks.get(source);
  if (!hit) {
    hit = host.index.peaks(source).catch(() => null);
    peaks.set(source, hit);
    void hit.then((p) => {
      if (!p) peaks.delete(source); // not measured yet: ask again later
    });
  }
  return hit;
}
