/** What the app is downloading for itself (speech recognition, the open models), kept up to date by the host. */
import type { DownloadState } from "@vedit/bridge";
import { create } from "zustand";
import { host } from "../lib/host.ts";

export const useDownloads = create<{ list: DownloadState[] }>()(() => ({ list: [] }));

let following = false;
export function followDownloads(): void {
  if (following) return;
  following = true;
  host.on("downloads", (list) => useDownloads.setState({ list }));
  void host.downloads.state().then((list) => useDownloads.setState({ list }));
}

/** "1.6 GB", "330 MB": a download's size as people read it. */
export function size(bytes: number): string {
  if (!bytes) return "";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
