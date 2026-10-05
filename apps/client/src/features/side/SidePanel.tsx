import { useState } from "react";
import { Segmented } from "../../components/ui.tsx";
import { setUi, useUi } from "../../state/ui.ts";
import { Inspector } from "../inspector/Inspector.tsx";
import { Checks } from "./Checks.tsx";
import { Files } from "./Files.tsx";
import { Library } from "./Library.tsx";
import { ShotLog } from "./ShotLog.tsx";
import { Story } from "./Story.tsx";
import { StyleEditor } from "./StyleEditor.tsx";
import { Transcript } from "./Transcript.tsx";

const TABS = [
  { value: "story", label: "Story" },
  { value: "transcript", label: "Words" },
  { value: "library", label: "Library" },
  { value: "files", label: "Files" },
  { value: "style", label: "Style" },
] as const;

export function SidePanel() {
  const tab = useUi((s) => s.sideTab);
  const inspecting = useUi((s) => s.selection !== null);
  return (
    <aside className="flex min-h-0 w-[320px] shrink-0 flex-col gap-3.5 border-l border-line bg-panel p-4">
      <Segmented value={tab} options={TABS} onChange={(sideTab) => setUi({ sideTab, selection: null })} />
      <div className="flex min-h-0 flex-1 flex-col">
        {inspecting ? (
          <Inspector />
        ) : (
          <>
            {tab === "story" && <Story />}
            {tab === "transcript" && <WordsTab />}
            {tab === "library" && <Library />}
            {tab === "files" && <Files />}
            {tab === "style" && <StyleEditor />}
          </>
        )}
      </div>
      {!inspecting && <Checks />}
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
