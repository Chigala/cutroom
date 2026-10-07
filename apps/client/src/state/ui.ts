import type { AgentContext } from "@vedit/bridge";
import type { Point, Shape, StyleKind } from "@vedit/project";
import { create } from "zustand";

export type SideTab = "story" | "transcript" | "library" | "files" | "export";

/** A spot the user pointed at on the video, waiting for an instruction or a comment. */
export interface Pointer {
  readonly point: Point;
  readonly time: number;
}

/** Timeline items that can be selected. */
export type InspectableColl =
  | "scenes"
  | "zooms"
  | "titles"
  | "captions"
  | "visuals"
  | "effects"
  | "sfx"
  | "musicClips"
  | "voiceovers"
  | "musicCues";

/** What's selected on the timeline: one item of a collection. */
export interface Selection {
  readonly coll: InspectableColl;
  readonly id: string;
}

interface UiState {
  sideTab: SideTab;
  pointing: boolean;
  pointer: Pointer | null;
  safeZones: boolean;
  selectedScene: string | null;
  /** The item selected on the timeline (what "this" means in the next request). */
  selection: Selection | null;
  /** Files are being dragged over the window (to import, or to attach on the text bar). */
  fileDrag: boolean;
  /** Full-screen views over the editor. */
  view: "editor" | "inspirations";
  /** ⌥ is held: drag on the timeline marks a stretch, a click marks a frame or points on the video. */
  marking: boolean;
  /** The project rail shows names (⌘B), or just thumbnails. */
  railOpen: boolean;
  /** The sidebar's width when open, in pixels (dragged). */
  railWidth: number;
  /** Projects folded shut in the sidebar, by folder. */
  folded: string[];
  /** The comments beside the stage are showing (hidden, a chip brings them back). */
  commentsOpen: boolean;
  /** The side panel (story, words, library, files, export) is showing (⇧⌘B). */
  sideOpen: boolean;
  /** The project's name is being edited in the title bar. */
  renaming: boolean;
  dialog: "export" | "settings" | "projects" | null;
  /** The Settings section to open on (Help → Diagnostics opens on its own), or null for the first. */
  settingsSection: "diagnostics" | null;
  /** What the stage shows: the video, or its cover image; and in which shape (null: the project's own). */
  stage: "video" | "cover";
  stageShape: Shape | null;
  /** A graphic open in the graphic editor (its id). */
  editingGraphic: string | null;
  /** A caption look open in the look editor (its id). */
  editingLook: string | null;
  /** An effect, transition or grade file open in its editor. */
  editingStyle: { kind: StyleKind; id: string } | null;
}

/** Where the panels' open or closed states are remembered (declared before the store reads them). */
const RAIL_KEY = "cutroom.railOpen";
const COMMENTS_KEY = "cutroom.commentsOpen";
const SIDE_KEY = "cutroom.sideOpen";
const RAIL_WIDTH_KEY = "cutroom.railWidth";
const FOLDED_KEY = "cutroom.foldedProjects";

/** The sidebar's width when open: dragged between these, never so wide it squeezes the edit. */
export const RAIL_WIDTH = { min: 200, max: 400, initial: 248, closed: 60 } as const;

export const useUi = create<UiState>()(() => ({
  sideTab: "story",
  pointing: false,
  pointer: null,
  safeZones: true,
  selectedScene: null,
  selection: null,
  fileDrag: false,
  view: "editor",
  marking: false,
  railOpen: remembered(RAIL_KEY, false),
  railWidth: rememberedNumber(RAIL_WIDTH_KEY, RAIL_WIDTH.initial),
  folded: rememberedList(FOLDED_KEY),
  commentsOpen: remembered(COMMENTS_KEY, true),
  sideOpen: remembered(SIDE_KEY, true),
  renaming: false,
  dialog: null,
  settingsSection: null,
  stage: "video",
  stageShape: null,
  editingGraphic: null,
  editingLook: null,
  editingStyle: null,
}));

export const setUi = useUi.setState;

/** Whether a panel was open last time (the rail starts closed, when the editor needs the room more). */
function remembered(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function rememberedNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function rememberedList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered: it's only a convenience.
  }
}

/** The open sidebar's width, kept inside its limits. */
export function setRailWidth(width: number, save = true): void {
  const railWidth = Math.round(Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, width)));
  setUi({ railWidth });
  if (save) keep(RAIL_WIDTH_KEY, String(railWidth));
}

/** Folds a project in the sidebar, or unfolds it. */
export function toggleFolded(dir: string): void {
  const now = useUi.getState().folded;
  const folded = now.includes(dir) ? now.filter((d) => d !== dir) : [...now, dir];
  setUi({ folded });
  keep(FOLDED_KEY, JSON.stringify(folded));
}

export function setRailOpen(railOpen: boolean): void {
  setUi({ railOpen });
  remember(RAIL_KEY, railOpen);
}

function remember(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // Not remembered: it's only a convenience.
  }
}

export function toggleRail(): void {
  const railOpen = !useUi.getState().railOpen;
  setUi({ railOpen });
  remember(RAIL_KEY, railOpen);
}

export function setSideOpen(sideOpen: boolean): void {
  setUi({ sideOpen });
  remember(SIDE_KEY, sideOpen);
}

export function toggleSide(): void {
  setSideOpen(!useUi.getState().sideOpen);
}

export function setCommentsOpen(commentsOpen: boolean): void {
  setUi({ commentsOpen });
  remember(COMMENTS_KEY, commentsOpen);
}

/** Selects an item on the timeline (and keeps the scene highlight in step). */
export function select(selection: Selection | null): void {
  setUi({ selection, ...(selection?.coll === "scenes" ? { selectedScene: selection.id } : {}) });
}

/** The item selected on the timeline, for a request about it ("slow this down"). */
export function selectionContext(): Pick<AgentContext, "selection" | "scenes"> {
  const sel = useUi.getState().selection;
  if (!sel) return {};
  return { selection: sel, ...(sel.coll === "scenes" && { scenes: [sel.id] }) };
}

/** Focus target for the composer, so shortcuts and "Point" can hand off to it. */
export const composerRef: { current: HTMLTextAreaElement | null } = { current: null };
