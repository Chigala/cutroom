import { UploadSimpleIcon } from "@phosphor-icons/react";
import { sceneAt, splitSceneOps, timelineOf } from "@vedit/project";
import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { ChatPanel } from "./features/chat/ChatPanel.tsx";
import { ExportDialog } from "./features/export/ExportDialog.tsx";
import { GraphicEditor } from "./features/graphics/GraphicEditor.tsx";
import { Header } from "./features/header/Header.tsx";
import { LookEditor } from "./features/looks/LookEditor.tsx";
import { Onboarding } from "./features/onboarding/Onboarding.tsx";
import { Preview } from "./features/preview/Preview.tsx";
import { openProject, ProjectsDialog } from "./features/projects/ProjectsDialog.tsx";
import { SettingsDialog } from "./features/settings/SettingsDialog.tsx";
import { SidePanel } from "./features/side/SidePanel.tsx";
import { KindEditor } from "./features/styles/KindEditor.tsx";
import { Timeline } from "./features/timeline/Timeline.tsx";
import { VersionsView } from "./features/versions/VersionsView.tsx";
import { host } from "./lib/host.ts";
import { connectChat } from "./state/chat.ts";
import { connectJobs } from "./state/jobs.ts";
import { offerToKeep } from "./state/library.ts";
import { currentTime, holdStep, releaseStep, seekTime, togglePlay } from "./state/playback.ts";
import { connectHost, edit, receive, redo, undo, useProject } from "./state/project.ts";
import { loadSettings, useSettings } from "./state/settings.ts";
import { fitTimeline, setRange, zoomBy } from "./state/timeline.ts";
import { dismissToast, toast, useToasts } from "./state/toast.ts";
import { composerRef, setUi, useUi } from "./state/ui.ts";

/** In development, ?onboarding shows the first-launch screens in the browser too, to work on them. */
const PREVIEW_ONBOARDING = import.meta.env.DEV && new URLSearchParams(location.search).has("onboarding");

export function App() {
  const status = useProject((s) => s.status);
  const error = useProject((s) => s.error);
  const view = useUi((s) => s.view);
  const dialog = useUi((s) => s.dialog);
  const editingGraphic = useUi((s) => s.editingGraphic);
  const editingLook = useUi((s) => s.editingLook);
  const editingStyle = useUi((s) => s.editingStyle);

  const onboarded = useSettings((s) => s.settings?.onboarded);
  useEffect(() => {
    void loadSettings();
    const offs = [connectHost(), connectChat(), connectJobs()];
    return () => {
      for (const off of offs) off();
    };
  }, []);
  useHotkeys();
  useAppMenu();

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-fg-2">
        Could not open the project: {error}
      </div>
    );
  }
  // The window shows only once painted, so render the frame even while loading: no flash.
  return (
    <div className="flex h-full flex-col">
      {status === "ready" ? (
        <>
          <Header />
          <div className="flex min-h-0 flex-1">
            <ChatPanel />
            <Preview />
            <SidePanel />
          </div>
          <Timeline />
          <DropTarget />
          {view === "versions" && <VersionsView />}
          {editingGraphic && <GraphicEditor key="graphic-editor" />}
          {editingLook && <LookEditor key="look-editor" />}
          {editingStyle && <KindEditor key="kind-editor" />}
          {dialog === "export" && <ExportDialog />}
          {dialog === "settings" && <SettingsDialog />}
          {dialog === "projects" && <ProjectsDialog />}
        </>
      ) : (
        <div className="drag-region h-[52px] border-b border-line" />
      )}
      {/* First launch (desktop only: the browser demo has nothing to set up). */}
      {((onboarded === false && window.editor) || PREVIEW_ONBOARDING) && <Onboarding />}
      <Toasts />
    </div>
  );
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** The app menu's Settings…, Diagnostics…, Open Project… and All Projects…. */
function useAppMenu(): void {
  useEffect(
    () =>
      host.on("menu", ({ action }) => {
        if (action === "settings") setUi({ dialog: "settings", settingsSection: null });
        else if (action === "diagnostics") setUi({ dialog: "settings", settingsSection: "diagnostics" });
        else if (action === "projects") setUi({ dialog: "projects" });
        else if (action === "openProject") void openProject(() => host.project.open());
      }),
    [],
  );
}

function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !typing(e.target)) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        composerRef.current?.focus();
        return;
      }
      if (typing(e.target) || mod || e.altKey) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
        case "ArrowRight":
          // A tap steps; held, the playhead runs and speeds up (holdStep).
          e.preventDefault();
          holdStep(e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
          break;
        case "ArrowUp":
        case "ArrowDown": {
          // To the cut before or after the playhead.
          e.preventDefault();
          const doc = useProject.getState().doc;
          if (!doc) break;
          const tl = timelineOf(doc);
          const cuts = [...tl.scenes.map((p) => p.start), tl.duration];
          const now = currentTime();
          const to =
            e.key === "ArrowUp"
              ? [...cuts].reverse().find((t) => t < now - 0.02)
              : cuts.find((t) => t > now + 0.02);
          if (to !== undefined) seekTime(Math.min(to, Math.max(0, tl.duration - 0.01)));
          break;
        }
        case "z":
          fitTimeline();
          break;
        case "=":
        case "+":
          zoomBy(1.6, currentTime());
          break;
        case "-":
          zoomBy(1 / 1.6, currentTime());
          break;
        case "/":
          e.preventDefault();
          composerRef.current?.focus();
          break;
        case "p":
          setUi((s) => ({ pointing: !s.pointing }));
          break;
        case "s": {
          // Split the shot under the playhead.
          const doc = useProject.getState().doc;
          if (!doc) break;
          const t = currentTime();
          const placed = sceneAt(timelineOf(doc), t);
          if (placed)
            edit(splitSceneOps(doc, placed.scene.id, t - placed.start), {
              message: `Split ${placed.scene.id}`,
            });
          break;
        }
        case "g":
          setUi((s) => ({ safeZones: !s.safeZones }));
          break;
        case "Escape":
          setRange(null);
          setUi({ pointing: false, pointer: null, selectedScene: null, selection: null, view: "editor" });
          break;
        case "Backspace":
        case "Delete": {
          const { selection, selectedScene } = useUi.getState();
          if (selection) {
            if (
              edit([{ op: "remove", coll: selection.coll, id: selection.id }], {
                message: `Deleted ${selection.id}`,
              })
            )
              setUi({ selection: null, selectedScene: null });
          } else if (selectedScene && edit([{ op: "remove", coll: "scenes", id: selectedScene }]))
            setUi({ selectedScene: null });
          break;
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") releaseStep();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    // Let go outside the window (switched app mid-hold): stop, don't run on.
    window.addEventListener("blur", releaseStep);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", releaseStep);
      releaseStep();
    };
  }, []);
}

/** Drop clips anywhere on the window to import them (or on the text bar, to attach them to a message). */
function DropTarget() {
  const [over, setLocal] = useState(false);
  useEffect(() => {
    const setOver = (v: boolean) => {
      setLocal(v);
      setUi({ fileDrag: v });
    };
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => host.pathForFile(f)).filter(Boolean);
      if (!paths.length) {
        toast("Importing clips needs the desktop app.", "warn");
        return;
      }
      toast(`Importing ${paths.length} ${paths.length === 1 ? "item" : "items"}…`);
      const result = await host.project.importFiles(paths);
      if (!result.ok) toast(result.error, "warn");
      else {
        receive(result.commit);
        offerToKeep(
          result.commit.ops.flatMap((o) =>
            o.op === "insert" && o.coll === "sources" ? [(o.item as { id: string }).id] : [],
          ),
        );
      }
    };
    // The text bar took the drop: it attaches the files to a message instead.
    const handled = () => {
      depth = 0;
      setOver(false);
    };
    window.addEventListener("vedit:drop-handled", handled);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("vedit:drop-handled", handled);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-bg/80 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col items-center gap-3 text-fg">
        <UploadSimpleIcon size={28} className="text-accent" />
        <span className="text-[15px] font-semibold">Drop to add clips</span>
        <span className="text-[13px] text-muted">They join the end of the cut. Then ask for an edit.</span>
        <span className="text-[13px] text-muted">
          Or drop on the text bar to attach them to a message: "put this after scene one".
        </span>
        <span className="text-[13px] text-muted">
          Or drop on the Library tab to keep sounds, music and memes for every project.
        </span>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-[276px] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            "rounded-lg border px-3.5 py-2 text-[13px] shadow-lg animate-rise",
            t.tone === "warn"
              ? "border-accent/40 bg-[#2a2418] text-fg"
              : "border-line-strong bg-raised text-fg-2",
          )}
        >
          {t.text}
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
              className="pointer-events-auto ml-3 rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
