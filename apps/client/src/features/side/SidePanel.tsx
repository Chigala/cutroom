import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Splitter } from "../../components/Splitter.tsx";
import { Segmented } from "../../components/ui.tsx";
import { swap } from "../../lib/motion.ts";
import { layoutNow, PREVIEW_MIN, useLayout, usePeekDismiss } from "../../state/layout.ts";
import { SIDE_WIDTH, setSideWidth, setUi, useUi } from "../../state/ui.ts";
import { Checks } from "./Checks.tsx";
import { ExportSettings } from "./ExportSettings.tsx";
import { Files } from "./Files.tsx";
import { Library } from "./Library.tsx";
import { ShotLog } from "./ShotLog.tsx";
import { Story } from "./Story.tsx";
import { Transcript } from "./Transcript.tsx";

const TABS = [
  { value: "story", label: "Story" },
  { value: "transcript", label: "Words" },
  { value: "library", label: "Library" },
  { value: "files", label: "Files" },
  { value: "export", label: "Export" },
] as const;

export function SidePanel() {
  const tab = useUi((s) => s.sideTab);
  const docked = useLayout().side.width;
  const width = useUi((s) => s.sideWidth);
  // Hidden for room, its button shows it over the preview for a moment instead.
  const peeking = useUi((s) => s.peek === "side") && !docked;
  const aside = useRef<HTMLElement>(null);
  usePeekDismiss("side", aside, peeking);
  if (!docked && !peeking) return null;
  return (
    <aside
      ref={aside}
      style={{ width: docked || width }}
      className={clsx(
        "flex min-h-0 shrink-0 flex-col gap-3.5 border-l border-line bg-panel p-4",
        peeking ? "absolute inset-y-0 right-0 z-30 shadow-2xl" : "relative",
      )}
    >
      {!peeking && (
        <Splitter
          edge="left"
          label="Resize the side panel"
          value={docked}
          initial={SIDE_WIDTH.initial}
          // Never so wide the preview loses its room.
          limits={() => {
            const now = layoutNow();
            return {
              min: SIDE_WIDTH.min,
              max: Math.min(SIDE_WIDTH.max, now.side.width + now.preview - PREVIEW_MIN.width),
            };
          }}
          onChange={setSideWidth}
        />
      )}
      <Segmented value={tab} options={TABS} onChange={(sideTab) => setUi({ sideTab })} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={swap}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === "story" && <Story />}
          {tab === "transcript" && <WordsTab />}
          {tab === "library" && <Library />}
          {tab === "files" && <Files />}
          {tab === "export" && <ExportSettings />}
        </motion.div>
      </AnimatePresence>
      <Checks />
    </aside>
  );
}

/** What's said, and what's shown: the transcript and the shot log, side by side as two views. */
function WordsTab() {
  const [view, setView] = useState<"said" | "shown">("said");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex gap-1 self-start rounded-md bg-button p-0.5 text-[11.5px]">
        {(
          [
            ["said", "What's said"],
            ["shown", "What's shown"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={
              view === v
                ? "rounded bg-selected px-2 py-0.5 text-fg"
                : "rounded px-2 py-0.5 text-muted hover:text-fg-2"
            }
          >
            {label}
          </button>
        ))}
      </div>
      {view === "said" ? <Transcript /> : <ShotLog />}
    </div>
  );
}
