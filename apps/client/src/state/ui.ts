import type { Point, Shape, StyleKind } from "@vedit/project";
import { create } from "zustand";

export type SideTab = "story" | "transcript" | "library" | "files" | "style";

/** A spot the user pointed at on the video, waiting for an instruction or a comment. */
export interface Pointer {
  readonly point: Point;
  readonly time: number;
}

/** Timeline items the inspector can edit. */
export type InspectableColl =
  | "scenes"
  | "zooms"
  | "titles"
  | "captions"
  | "visuals"
  | "effects"
  | "sfx"
  | "musicClips"
  | "musicCues";

/** What the inspector is showing: one item of a collection. */
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
  /** The item open in the inspector. */
  selection: Selection | null;
  /** Files are being dragged over the window (to import, or to attach on the text bar). */
  fileDrag: boolean;
  /** Full-screen views over the editor. */
  view: "editor" | "versions";
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

export const useUi = create<UiState>()(() => ({
  sideTab: "story",
  pointing: false,
  pointer: null,
  safeZones: true,
  selectedScene: null,
  selection: null,
  fileDrag: false,
  view: "editor",
  dialog: null,
  settingsSection: null,
  stage: "video",
  stageShape: null,
  editingGraphic: null,
  editingLook: null,
  editingStyle: null,
}));

export const setUi = useUi.setState;

/** Opens an item in the inspector (and keeps the scene highlight in step). */
export function select(selection: Selection | null): void {
  setUi({ selection, ...(selection?.coll === "scenes" ? { selectedScene: selection.id } : {}) });
}

/** Focus target for the composer, so shortcuts and "Point" can hand off to it. */
export const composerRef: { current: HTMLTextAreaElement | null } = { current: null };
