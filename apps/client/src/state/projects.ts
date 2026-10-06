/**
 * The user's projects as the rail and the switcher show them: newest first, each with a thumbnail (a
 * frame of its first shot, made by the host). Opening one goes through openProject, which won't drop a
 * request Claude is still working on without asking.
 */
import type { ProjectSnapshot, RecentProject } from "@vedit/bridge";
import { create } from "zustand";
import { useUploads } from "../lib/attach.ts";
import { host } from "../lib/host.ts";
import { chatReady, firstCutPrompt, onFinishedAway, send } from "./chat.ts";
import { useJobs } from "./jobs.ts";
import { load, useProject } from "./project.ts";
import { setRange } from "./timeline.ts";
import { toast } from "./toast.ts";
import { setUi, useUi } from "./ui.ts";

interface ProjectsState {
  recent: RecentProject[];
  /** By folder: a data URL, null when it has no footage to show, missing while unknown. */
  thumbs: Record<string, string | null>;
}

export const useProjects = create<ProjectsState>()(() => ({ recent: [], thumbs: {} }));

const asking = new Set<string>();

/** Asks for a project's thumbnail once (or again, when the host says it changed). */
export function loadThumb(dir: string, again = false): void {
  if (asking.has(dir) || (!again && dir in useProjects.getState().thumbs)) return;
  asking.add(dir);
  void host.project
    .thumbnail(dir)
    .catch(() => null)
    .then((url) => useProjects.setState((s) => ({ thumbs: { ...s.thumbs, [dir]: url } })))
    .finally(() => asking.delete(dir));
}

export async function refreshProjects(): Promise<void> {
  const recent = await host.project.recent().catch(() => [] as RecentProject[]);
  useProjects.setState({ recent });
}

/** Keeps the list fresh: when the open project changes (or is renamed) and when a thumbnail is remade. */
export function connectProjects(): () => void {
  void refreshProjects();
  const offThumb = host.on("thumbnail", ({ dir }) => loadThumb(dir, true));
  // Claude finished in a project not on screen: said here (the app also sends a system notification
  // when it isn't in front), with the way there.
  const offFinished = onFinishedAway((dir, ok, text) => {
    const name = useProjects.getState().recent.find((r) => r.dir === dir)?.name ?? "a project";
    const said = text.replace(/\s+/g, " ").trim();
    toast(
      `${ok ? `Claude finished ${name}` : `Claude stopped in ${name}`}${said ? `: ${said.slice(0, 90)}${said.length > 90 ? "…" : ""}` : ""}`,
      ok ? "info" : "warn",
      { label: "Open", run: () => void openProject(() => host.project.open(dir)) },
    );
  });
  // Its system notification was clicked.
  const offFocus = host.on("focusProject", ({ dir }) => {
    if (dir !== useProject.getState().dir) void openProject(() => host.project.open(dir));
  });
  const offProject = useProject.subscribe((s, prev) => {
    // What was selected, pointed at, marked or being renamed belongs to the project it was in.
    if (s.dir !== prev.dir) {
      setUi({ selection: null, selectedScene: null, pointer: null, pointing: false, renaming: false });
      setRange(null);
      void refreshProjects();
      return;
    }
    // Renamed here: the list shows it at once (the host saves it to the list as it commits).
    const name = s.doc?.meta.name;
    if (s.dir && name && name !== prev.doc?.meta.name)
      useProjects.setState((p) => ({ recent: p.recent.map((r) => (r.dir === s.dir ? { ...r, name } : r)) }));
  });
  return () => {
    offThumb();
    offFinished();
    offFocus();
    offProject();
  };
}

/** The open in flight: one at a time (a double click, or ⌘2 then ⌘3, would race two switches). */
let opening: Promise<boolean> | null = null;

/**
 * Opens a project (from a path, the system picker, a copy) and switches the editor to it. Claude keeps
 * working in the one left (it carries on in the background); an export rendering would stop, so that
 * asks first. With an editor open (a graphic, a look, a style) it's closed first, so its unsaved work
 * isn't lost.
 */
export async function openProject(fn: () => Promise<ProjectSnapshot | null>): Promise<boolean> {
  if (opening) return false;
  if (useUploads.getState().count > 0) {
    toast("A file is still being attached to this project. Switch when it's in.", "warn");
    return false;
  }
  const ui = useUi.getState();
  if (ui.editingGraphic || ui.editingLook || ui.editingStyle) {
    toast("Close the editor first (save or discard what's in it).", "warn");
    return false;
  }
  if (useJobs.getState().export?.status === "running") {
    toast("An export is rendering. Switching stops it.", "warn", {
      label: "Stop and switch",
      run: () => void go(fn),
    });
    return false;
  }
  return go(fn);
}

function go(fn: () => Promise<ProjectSnapshot | null>): Promise<boolean> {
  if (opening) return Promise.resolve(false);
  opening = (async () => {
    try {
      const snap = await fn();
      if (!snap) return false;
      load(snap);
      return true;
    } catch (err) {
      toast((err as Error).message, "warn");
      return false;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

/**
 * Forks a project into a copy beside it, and opens the copy. "edit": the cut as it is, to take another
 * direction. "footage": the original clips with everything already worked out about them (transcripts,
 * shot analysis, preview copies), the edit cleared; Claude then makes a first cut in it straight away
 * (when first cuts are automatic), so only the edit is done again. The original can be gone back to
 * while Claude works: it carries on in the background.
 */
export async function forkProject(dir: string, from: "edit" | "footage"): Promise<void> {
  const name = useProjects.getState().recent.find((r) => r.dir === dir)?.name ?? "the project";
  if (!(await openProject(() => host.project.duplicate(dir, from)))) return;
  if (from === "edit") return toast(`Forked ${name}: the same cut, to try another direction.`);
  await chatReady();
  const { autoFirstCut } = await host.settings.get().catch(() => ({ autoFirstCut: false }));
  if (!autoFirstCut) return toast(`Forked ${name} from its original clips. Ask for a cut when you're ready.`);
  toast(`Forked ${name} from its original clips. Claude is making a first cut.`);
  void send(firstCutPrompt(), {}, "thorough");
}

/** "2h ago", "yesterday", "12 Sep". */
export function ago(at: number): string {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2 * 86400) return "yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Projects whose name or folder holds every word typed. */
export function matching(list: readonly RecentProject[], query: string): RecentProject[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((r) => words.every((w) => `${r.name} ${r.dir}`.toLowerCase().includes(w)));
}
