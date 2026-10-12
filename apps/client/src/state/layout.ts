/**
 * How the editor fits the window. Narrowed, the panels give way the way desktop editors' do: widths
 * dragged past the usual come back first, the side panel and then the chat narrow to their least, and
 * when that isn't enough the sidebar folds to its strip, then the side panel hides. The video always
 * keeps its room. Each panel's own open or closed choice is never touched: widen the window and they
 * come back as they were.
 */
import { type RefObject, useEffect } from "react";
import { useWindowSize, windowSize } from "../lib/viewport.ts";
import {
  CHAT_WIDTH,
  RAIL_WIDTH,
  SIDE_WIDTH,
  setRailOpen,
  setSideOpen,
  setUi,
  TIMELINE_HEIGHT,
  useUi,
} from "./ui.ts";

/** The least the preview keeps, across and down. */
export const PREVIEW_MIN = { width: 480, height: 340 } as const;
/** Below this width the preview hides its comments (a chip brings them back) to keep the video big. */
export const COMMENTS_ROOM = 520;
/** The title bar's height. */
export const HEADER_HEIGHT = 52;

interface Wanted {
  railOpen: boolean;
  railWidth: number;
  sideOpen: boolean;
  sideWidth: number;
  chatWidth: number;
  commentsOpen: boolean;
  timelineHeight: number;
}

export interface Layout {
  /** The sidebar: its width in the row, whether it shows names, and whether it folded for room. */
  rail: { width: number; open: boolean; folded: boolean; openWidth: number };
  /** The side panel: its width (0 hidden), and whether it hid for room. */
  side: { width: number; hidden: boolean };
  chat: number;
  /** What's left for the preview. */
  preview: number;
  /** The comments beside the stage show. */
  comments: boolean;
  timeline: number;
}

/** Where everything goes in a window this size, given what the user opened and dragged. */
export function fit(width: number, height: number, w: Wanted): Layout {
  // What the panels may take between them, leaving the preview its least.
  const room = width - PREVIEW_MIN.width;
  // Never more than a third of the window, however wide it was dragged in a bigger one.
  const openWidth = Math.min(w.railWidth, Math.max(RAIL_WIDTH.min, width / 3));
  // The sidebar folds when even the narrowest side panel and chat wouldn't fit beside it; then the
  // side panel hides when it wouldn't fit beside the narrowest chat.
  const folded = w.railOpen && openWidth + (w.sideOpen ? SIDE_WIDTH.min : 0) + CHAT_WIDTH.min > room;
  const rail = w.railOpen && !folded ? openWidth : RAIL_WIDTH.closed;
  const hidden = w.sideOpen && rail + SIDE_WIDTH.min + CHAT_WIDTH.min > room;
  let side = w.sideOpen && !hidden ? w.sideWidth : 0;
  let chat = w.chatWidth;
  // What's left over comes out of the widths: dragged past the usual first, then the side panel, the chat last.
  const over = () => rail + side + chat - room;
  if (over() > 0) chat = Math.max(Math.min(chat, CHAT_WIDTH.initial), chat - over());
  if (over() > 0 && side) side = Math.max(Math.min(side, SIDE_WIDTH.initial), side - over());
  if (over() > 0 && side) side = Math.max(SIDE_WIDTH.min, side - over());
  if (over() > 0) chat = Math.max(CHAT_WIDTH.min, chat - over());
  const preview = width - rail - side - chat;
  // Short windows: the timeline gives way before the video gets small.
  const tallest = Math.max(TIMELINE_HEIGHT.min, height - HEADER_HEIGHT - PREVIEW_MIN.height);
  return {
    rail: { width: rail, open: w.railOpen && !folded, folded, openWidth },
    side: { width: side, hidden },
    chat,
    preview,
    comments: w.commentsOpen && preview >= COMMENTS_ROOM,
    timeline: Math.min(w.timelineHeight, tallest),
  };
}

const wanted = (s: Wanted): Wanted => ({
  railOpen: s.railOpen,
  railWidth: s.railWidth,
  sideOpen: s.sideOpen,
  sideWidth: s.sideWidth,
  chatWidth: s.chatWidth,
  commentsOpen: s.commentsOpen,
  timelineHeight: s.timelineHeight,
});

/** The layout now (for handlers). */
export function layoutNow(): Layout {
  const { width, height } = windowSize();
  return fit(width, height, wanted(useUi.getState()));
}

/** The layout, following the window and the panels. */
export function useLayout(): Layout {
  const { width, height } = useWindowSize();
  const railOpen = useUi((s) => s.railOpen);
  const railWidth = useUi((s) => s.railWidth);
  const sideOpen = useUi((s) => s.sideOpen);
  const sideWidth = useUi((s) => s.sideWidth);
  const chatWidth = useUi((s) => s.chatWidth);
  const commentsOpen = useUi((s) => s.commentsOpen);
  const timelineHeight = useUi((s) => s.timelineHeight);
  return fit(width, height, {
    railOpen,
    railWidth,
    sideOpen,
    sideWidth,
    chatWidth,
    commentsOpen,
    timelineHeight,
  });
}

/** Whether a panel shows (docked, or over the edit for now). */
export function useShown(panel: "rail" | "side"): boolean {
  const layout = useLayout();
  const peek = useUi((s) => s.peek === panel);
  return peek || (panel === "rail" ? layout.rail.open : layout.side.width > 0);
}

/**
 * Shows or hides a panel (⌘B, ⇧⌘B, the title bar's buttons). Docked, that's its saved choice; with no
 * room to dock it, it shows over the edit instead and the saved choice stays as it was.
 */
export function togglePanel(panel: "rail" | "side"): void {
  const now = layoutNow();
  if (panel === "rail" ? now.rail.open : now.side.width > 0) {
    setUi({ peek: null });
    if (panel === "rail") setRailOpen(false);
    else setSideOpen(false);
    return;
  }
  if (useUi.getState().peek === panel) setUi({ peek: null });
  else showPanel(panel);
}

/** Shows a panel: docked if there's room, over the edit if not. */
export function showPanel(panel: "rail" | "side"): void {
  const { width, height } = windowSize();
  const opened = fit(width, height, {
    ...wanted(useUi.getState()),
    ...(panel === "rail" ? { railOpen: true } : { sideOpen: true }),
  });
  if (panel === "rail" ? opened.rail.open : opened.side.width > 0) {
    setUi({ peek: null });
    if (panel === "rail") setRailOpen(true);
    else setSideOpen(true);
  } else setUi({ peek: panel });
}

/** A panel shown over the edit goes again on a click anywhere else (its own button toggles it itself). */
export function usePeekDismiss(
  panel: "rail" | "side" | "comments",
  ref: RefObject<HTMLElement | null>,
  on: boolean,
): void {
  useEffect(() => {
    if (!on) return;
    const down = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (ref.current?.contains(el) || el?.closest(`[data-peek="${panel}"], dialog`)) return;
      setUi({ peek: null });
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [panel, ref, on]);
}
