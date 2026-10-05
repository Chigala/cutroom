import type { RecentProject } from "@vedit/bridge";
import { formatTime, timelineOf } from "@vedit/project";
import {
  ChevronDown,
  Film,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Redo2,
  Search,
  Settings,
  Sparkles,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { importClips } from "../../lib/import.ts";
import { isMac } from "../../lib/keys.ts";
import { useJobs } from "../../state/jobs.ts";
import { edit, redo, undo, useDoc, useProject } from "../../state/project.ts";
import { setUi } from "../../state/ui.ts";
import { ago, matching, openProject } from "../projects/ProjectsDialog.tsx";

export function Header() {
  const format = useDoc((d) => d.meta.format);
  const clips = useDoc((d) => d.sources.filter((s) => s.kind !== "solid").length || d.sources.length);
  const duration = useDoc((d) => timelineOf(d).duration);
  const canUndo = useProject((s) => s.undoStack.length > 0);
  const canRedo = useProject((s) => s.redoStack.length > 0);
  const version = useProject((s) => s.commits.filter((c) => c.author !== "index").length);
  const exporting = useJobs((s) => (s.export?.status === "running" ? s.export.fraction : null));

  return (
    <header
      className={`drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-line pr-4 ${
        isMac && host.kind === "desktop" ? "pl-[84px]" : "pl-5"
      }`}
    >
      {/* The project is the title (and switches projects), as in a document app. */}
      <div className="flex min-w-0 flex-1 basis-0 items-center">
        <ProjectMenu />
      </div>

      <div className="flex items-center gap-2.5 font-mono text-xs text-muted tabular">
        <span className="rounded-full border border-line-strong px-2.5 py-1 text-fg">
          main · v{version + 1}
        </span>
        <span>
          {clips} clips · {formatTime(duration)} ·{" "}
          {format.width > format.height ? "16:9" : format.width === format.height ? "1:1" : "9:16"}
        </span>
        <IndexingPill />
      </div>

      <div className="no-drag flex flex-1 basis-0 items-center justify-end gap-2">
        <IconButton label={`Undo (${isMac ? "⌘" : "Ctrl+"}Z)`} disabled={!canUndo} onClick={undo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label={`Redo (${isMac ? "⇧⌘" : "Ctrl+Shift+"}Z)`} disabled={!canRedo} onClick={redo}>
          <Redo2 size={16} />
        </IconButton>
        <IconButton label="Settings" onClick={() => setUi({ dialog: "settings" })}>
          <Settings size={16} />
        </IconButton>
        <Button onClick={() => setUi({ view: "versions" })}>Versions</Button>
        <Button variant="accent" onClick={() => setUi({ dialog: "export" })} className="min-w-[78px]">
          {exporting === null ? "Export" : `${Math.round(exporting * 100)}%`}
        </Button>
      </div>
    </header>
  );
}

/** "Indexing 2 clips · 45%": the footage pipeline at a glance. */
function IndexingPill() {
  const jobs = useJobs((s) => s.indexing);
  const active = Object.values(jobs).filter((j) => j.stage !== "failed");
  if (!active.length) return null;
  const avg = active.reduce((n, j) => n + j.fraction, 0) / active.length;
  // What's running, in its own words when it's one kind of work ("Updating word timings" isn't an
  // import); a mix of clips at different stages is "Indexing".
  const labels = new Set(active.map((j) => j.label));
  const label =
    active.find((j) => j.stage === "setup")?.label ??
    (labels.size === 1 ? active[0]!.label : `Indexing ${active.length} clips`);
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-accent animate-fade-in">
      <Loader2 size={12} className="animate-spin" />
      {label} · {Math.round(avg * 100)}%
    </span>
  );
}

function ProjectMenu() {
  const name = useDoc((d) => d.meta.name);
  const dir = useProject((s) => s.dir);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const others = matching(
    recent.filter((r) => r.dir !== dir),
    query,
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void host.project.recent().then(setRecent);
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const go = (fn: Parameters<typeof openProject>[0]) => {
    setOpen(false);
    return openProject(fn);
  };

  const [renaming, setRenaming] = useState(false);
  const rename = (next: string) => {
    setRenaming(false);
    const clean = next.trim().slice(0, 120);
    // The project's name (project.json), not its folder: one undoable edit.
    if (clean && clean !== name)
      edit([{ op: "merge", key: "meta", patch: { name: clean } }], {
        message: `Renamed the project to ${clean}`,
      });
  };

  return (
    <div ref={ref} className="no-drag relative">
      {renaming ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: renaming starts typing at once
          autoFocus
          defaultValue={name}
          aria-label="Project name"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => rename(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") rename(e.currentTarget.value);
            if (e.key === "Escape") setRenaming(false);
          }}
          className="w-[320px] rounded-lg border border-edge bg-sunken px-2 py-1 text-[14px] font-semibold text-fg outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onDoubleClick={() => {
            setOpen(false);
            setRenaming(true);
          }}
          aria-expanded={open}
          title={`${dir ?? ""}\nDouble-click to rename`}
          className="flex max-w-[320px] items-center gap-1.5 rounded-lg px-2 py-1 text-fg hover:bg-button"
        >
          <span className="truncate text-[14px] font-semibold">{name}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
      )}
      {open && (
        <div className="absolute top-9 left-0 z-50 w-72 rounded-xl border border-line-strong bg-panel p-1.5 shadow-2xl animate-rise">
          {dir && (
            <MenuItem
              icon={<Pencil size={14} />}
              onClick={() => {
                setOpen(false);
                setRenaming(true);
              }}
            >
              Rename…
            </MenuItem>
          )}
          {dir && (
            <MenuItem
              icon={<Upload size={14} />}
              onClick={() => {
                setOpen(false);
                void importClips();
              }}
            >
              Import clips into this project…
            </MenuItem>
          )}
          <MenuItem icon={<Film size={14} />} onClick={() => void go(() => host.project.newFromVideos())}>
            New project from videos…
          </MenuItem>
          <MenuItem icon={<Plus size={14} />} onClick={() => void go(() => host.project.create("Untitled"))}>
            New empty project
          </MenuItem>
          <MenuItem icon={<FolderOpen size={14} />} onClick={() => void go(() => host.project.open())}>
            Open…
          </MenuItem>
          <MenuItem icon={<Sparkles size={14} />} onClick={() => void go(() => host.project.openDemo())}>
            Demo project
          </MenuItem>
          {recent.some((r) => r.dir !== dir) && (
            <>
              <div className="mx-2 my-1.5 border-t border-line" />
              {/* Many projects: type to find one; the full list is a click away. */}
              <label className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-sunken px-2.5 py-1.5">
                <Search size={13} className="shrink-0 text-faint" />
                <input
                  // biome-ignore lint/a11y/noAutofocus: the menu opened to switch projects
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") setOpen(false);
                    if (e.key === "Enter" && others[0]) {
                      const first = others[0];
                      void go(() => host.project.open(first.dir));
                    }
                  }}
                  placeholder="Find a project"
                  aria-label="Find a project"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
                />
              </label>
              {others.slice(0, 6).map((r) => (
                <MenuItem key={r.dir} onClick={() => void go(() => host.project.open(r.dir))} title={r.dir}>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-[11px] text-faint">{ago(r.openedAt)}</span>
                </MenuItem>
              ))}
              {query && !others.length && <div className="px-2.5 py-2 text-xs text-faint">No matches</div>}
              <MenuItem
                icon={<LayoutGrid size={14} />}
                onClick={() => {
                  setOpen(false);
                  setUi({ dialog: "projects" });
                }}
              >
                <span className="flex-1">All projects</span>
                <span className="text-[11px] text-faint">{recent.length}</span>
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-fg-2 hover:bg-raised hover:text-fg"
    >
      {icon && <span className="text-muted">{icon}</span>}
      {children}
    </button>
  );
}
