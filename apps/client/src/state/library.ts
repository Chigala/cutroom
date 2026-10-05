/** The asset library as the Library tab shows it, kept up to date by the host's `library` event. */
import type { LibraryState } from "@vedit/bridge";
import { keepable, type Source } from "@vedit/project";
import { create } from "zustand";
import { host, MEDIA_BASE } from "../lib/host.ts";
import { useProject } from "./project.ts";
import { toast } from "./toast.ts";

export const useLibrary = create<{ state: LibraryState | null }>()(() => ({ state: null }));

let following = false;
export function followLibrary(): void {
  if (following) return;
  following = true;
  host.on("library", (state) => useLibrary.setState({ state }));
  void host.library.state().then((state) => useLibrary.setState({ state }));
}

/** Where the editor's window can load an asset from (for previews). */
export const assetUrl = (id: string) => `${MEDIA_BASE}lib/${encodeURIComponent(id)}`;

/** Screenshots and pasted images are instructions, not assets: no offer to keep those. */
const SCREENSHOT = /^(screenshot|screen shot|cleanshot|image|pasted|clipboard)\b/i;

/** Keeps project clips in the shared library, and says so. */
export function keepInLibrary(ids: readonly string[]): void {
  void host.library.keep([...ids]).then(
    (kept) =>
      toast(`Kept ${kept.length === 1 ? "it" : `${kept.length} files`} in your library, for every project`),
    (err: Error) => toast(err.message, "warn"),
  );
}

/**
 * After a drop or an attachment: songs, sounds, memes and short clips get a one-click offer to keep them
 * in the shared library (footage and screenshots don't). Waits a moment for the clips to arrive.
 */
export function offerToKeep(ids: readonly string[], tries = 8): void {
  if (!ids.length || !window.editor) return;
  const doc = useProject.getState().doc;
  const found = ids.flatMap((id) => doc?.sources.find((s) => s.id === id) ?? []);
  if (found.length < ids.length && tries > 0) {
    setTimeout(() => offerToKeep(ids, tries - 1), 250);
    return;
  }
  const keep = found.filter((s: Source) => keepable(s) && !SCREENSHOT.test(s.label));
  if (!keep.length) return;
  const what =
    keep.length === 1 ? `"${keep[0]!.label.replace(/\.[^.]+$/, "")}"` : `these ${keep.length} files`;
  toast(`Keep ${what} in your library for other projects?`, "info", {
    label: "Keep",
    run: () => keepInLibrary(keep.map((s) => s.id)),
  });
}
