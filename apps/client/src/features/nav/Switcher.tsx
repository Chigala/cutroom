/**
 * ⌘K: jump to any project by typing a few letters, or start one. Every project you've opened, newest
 * first; ↑↓ and Enter, Escape to close.
 */
import {
  FilmStripIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { clsx } from "clsx";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { host } from "../../lib/host.ts";
import { mod } from "../../lib/keys.ts";
import { useWorking } from "../../state/chat.ts";
import { useProject } from "../../state/project.ts";
import { ago, matching, openProject, refreshProjects, useProjects } from "../../state/projects.ts";
import { setUi } from "../../state/ui.ts";
import { Keys, ProjectThumb } from "./ProjectRail.tsx";

interface Row {
  key: string;
  icon: ReactNode;
  label: string;
  meta: string;
  metaClass?: string;
  keys?: string;
  run: () => void;
}

export function Switcher() {
  const recent = useProjects((s) => s.recent);
  const dir = useProject((s) => s.dir);
  const working = useWorking((s) => s.dirs);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setUi({ dialog: null });

  useEffect(() => {
    void refreshProjects();
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  const go = (fn: () => ReturnType<typeof host.project.open>) => {
    close();
    void openProject(fn);
  };

  const rows = (() => {
    // Newest first here (the rail keeps its own order).
    const byTime = [...recent].sort((a, b) => b.openedAt - a.openedAt);
    const projects = matching(byTime, query).map(
      (r): Row => ({
        key: r.dir,
        icon: <ProjectThumb dir={r.dir} name={r.name} size={28} />,
        label: r.name,
        meta: working.includes(r.dir) ? "Claude is editing" : r.dir === dir ? "Open" : ago(r.openedAt),
        ...(working.includes(r.dir) && { metaClass: "shimmer" }),
        run: () => (r.dir === dir ? close() : go(() => host.project.open(r.dir))),
      }),
    );
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const actions = (
      [
        {
          key: "new",
          icon: <FilmStripIcon size={16} />,
          label: "New project from videos",
          meta: "",
          keys: `${mod}N`,
          run: () => go(() => host.project.newFromVideos()),
        },
        {
          key: "empty",
          icon: <PlusIcon size={16} />,
          label: "New empty project",
          meta: "",
          run: () => go(() => host.project.create("Untitled")),
        },
        {
          key: "open",
          icon: <FolderOpenIcon size={16} />,
          label: "Open a project folder",
          meta: "",
          keys: `${mod}O`,
          run: () => go(() => host.project.open()),
        },
        {
          key: "inspirations",
          icon: <SparkleIcon size={16} />,
          label: "Browse inspirations",
          meta: "",
          run: () => setUi({ dialog: null, view: "inspirations" }),
        },
      ] satisfies Row[]
    ).filter((a) => words.every((w) => a.label.toLowerCase().includes(w)));
    return { projects, actions };
  })();

  const all = [...rows.projects, ...rows.actions];
  const pick = Math.min(at, Math.max(0, all.length - 1));
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${pick}"]`)?.scrollIntoView({ block: "nearest" });
  }, [pick]);

  const row = (r: Row, i: number) => (
    <button
      key={r.key}
      type="button"
      id={`switcher-${i}`}
      // Not a tab stop: the search box keeps focus and ↑↓ move through the rows (read out by
      // aria-activedescendant).
      tabIndex={-1}
      aria-current={i === pick ? "true" : undefined}
      data-i={i}
      onMouseMove={() => setAt(i)}
      onClick={r.run}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
        i === pick ? "bg-raised text-fg" : "text-fg-2",
      )}
    >
      <span className="flex w-6 shrink-0 justify-center text-muted">{r.icon}</span>
      <span className="min-w-0 flex-1 truncate">{r.label}</span>
      {r.meta && <span className={clsx("shrink-0 text-[11px]", r.metaClass ?? "text-faint")}>{r.meta}</span>}
      {r.keys && <Keys>{r.keys}</Keys>}
      {i === pick && <Keys>↵</Keys>}
    </button>
  );

  return (
    <dialog
      ref={ref}
      aria-label="Jump to a project"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="mx-auto mt-[12vh] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel p-0 text-fg shadow-2xl backdrop:bg-black/55 open:flex open:animate-rise"
    >
      <label className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <MagnifyingGlassIcon size={17} className="shrink-0 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            // ⌘K again closes it (the window's own ⌘K never sees keys typed here).
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
              e.preventDefault();
              close();
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt(Math.min(all.length - 1, pick + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt(Math.max(0, pick - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              all[pick]?.run();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          placeholder="Jump to a project, or start one"
          aria-label="Jump to a project"
          role="combobox"
          aria-expanded="true"
          aria-controls="switcher-list"
          aria-activedescendant={all[pick] ? `switcher-${pick}` : undefined}
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
        />
        <span className="rounded border border-line-strong px-1.5 font-mono text-[10px] text-faint">esc</span>
      </label>
      <div
        ref={listRef}
        id="switcher-list"
        className="flex max-h-[min(60vh,520px)] flex-col overflow-y-auto p-2"
      >
        {rows.projects.length > 0 && <Heading>Projects</Heading>}
        {rows.projects.map((r, i) => row(r, i))}
        {query && !rows.projects.length && (
          <p className="m-0 px-2.5 py-3 text-[13px] text-faint">No project is called that.</p>
        )}
        {rows.actions.length > 0 && (
          <>
            <div className="mx-1.5 my-1.5 border-t border-line" />
            <Heading>Start</Heading>
          </>
        )}
        {rows.actions.map((r, i) => row(r, rows.projects.length + i))}
      </div>
    </dialog>
  );
}

const Heading = ({ children }: { children: ReactNode }) => (
  <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-faint">{children}</div>
);
