/**
 * The sidebar, down the left like Claude's: new video, search, inspirations, then what you're working on:
 * pinned videos and projects, each project (a folder of videos) with its videos, and videos in no
 * project. It's as wide as you drag it (within limits that keep the edit roomy); ⌘B folds it to a strip
 * of frames.
 */
import {
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  FilmStripIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderSimpleDashedIcon,
  FoldersIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { ProjectFolder, RecentProject } from "@vedit/bridge";
import { clsx } from "clsx";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { Button } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { isMac, mod } from "../../lib/keys.ts";
import { useWorking } from "../../state/chat.ts";
import { useProject } from "../../state/project.ts";
import {
  ago,
  forkProject,
  loadThumb,
  moveToFolder,
  newFolder,
  OTHER,
  openProject,
  pin,
  railOrder,
  refreshProjects,
  rename,
  sections,
  useProjects,
} from "../../state/projects.ts";
import { toast } from "../../state/toast.ts";
import { RAIL_WIDTH, setRailOpen, setRailWidth, setUi, toggleFolded, useUi } from "../../state/ui.ts";

/** ⌘1 to ⌘9 open the sidebar's first nine videos. */
export const PROJECT_SHORTCUTS = 9;

/** Rename and pin: on a row in the sidebar, or anywhere for the open video. */
const RENAME_KEYS = "F2";
const PIN_KEYS = isMac ? "⇧⌘P" : "Ctrl+Shift+P";

type Menu =
  | { kind: "video"; video: RecentProject; x: number; y: number }
  | { kind: "folder"; folder: ProjectFolder; x: number; y: number }
  | { kind: "new"; folder?: ProjectFolder; x: number; y: number };

export function ProjectRail() {
  const open = useUi((s) => s.railOpen);
  const width = useUi((s) => s.railWidth);
  const folded = useUi((s) => s.folded);
  const view = useUi((s) => s.view);
  const recent = useProjects((s) => s.recent);
  const folders = useProjects((s) => s.folders);
  const dir = useProject((s) => s.dir);
  const [tip, setTip] = useState<{ text: string; meta: string; top: number; left: number } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [trashing, setTrashing] = useState<RecentProject | null>(null);
  const [making, setMaking] = useState<{ thenMove?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The video or project whose name is being edited in place. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const pinnedNow = (d: string) =>
    recent.some((r) => r.dir === d && r.pinned) ||
    folders.some((f) => (f.dir === d && f.pinned) || f.videos.some((v) => v.dir === d && v.pinned));
  /** F2 and ⇧⌘P on a row in the sidebar; anywhere else (not typing), on the open video. */
  const shortcuts =
    (target: string) =>
    (e: React.KeyboardEvent | KeyboardEvent): boolean => {
      if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        // Done here: the same key doesn't also reach the open video's shortcut.
        e.stopPropagation();
        setRailOpen(true);
        setRenaming(target);
        return true;
      }
      if ((isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        void pin(target, !pinnedNow(target));
        return true;
      }
      return false;
    };
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const busy =
        el instanceof HTMLElement &&
        (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.closest("nav"));
      const open = useProject.getState().dir;
      if (!busy && open && !document.querySelector('[role="dialog"]')) latest.current(open)(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const naming = (d: string) =>
    renaming === d
      ? {
          renaming: true,
          onRenamed: (name: string | null) => {
            setRenaming(null);
            if (name !== null) void rename(d, name);
          },
        }
      : {};
  // Never more than a third of the window, however wide it was dragged in a bigger one.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const shown = Math.min(width, Math.max(RAIL_WIDTH.min, windowWidth / 3));

  const { pinned, folders: rest, loose } = sections(recent, folders);
  const order = railOrder(recent, folders, folded);
  const shortcut = (video: RecentProject) => {
    const i = order.findIndex((v) => v.dir === video.dir);
    return i >= 0 && i < PROJECT_SHORTCUTS ? `${mod}${i + 1}` : undefined;
  };

  /** Closed, each button says what it is on hover, beside the rail. */
  const hint = (text: string, meta = "") => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (open) return;
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ text, meta, top: r.top + r.height / 2, left: r.right + 10 });
    },
    // Open or closed, leaving clears it (so it can't come back stale after ⌘B).
    onMouseLeave: () => setTip(null),
  });
  const at = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.right + 4, y: r.top };
  };

  const video = (v: RecentProject, indent = false) => (
    <ProjectButton
      key={v.dir}
      project={v}
      open={open}
      indent={indent}
      current={v.dir === dir}
      shortcut={shortcut(v)}
      hint={hint}
      onKeys={shortcuts(v.dir)}
      {...naming(v.dir)}
      onMenu={(x, y) => {
        setTip(null);
        setMenu({ kind: "video", video: v, x, y });
      }}
    />
  );
  const folder = (f: ProjectFolder) => (
    <FolderRow
      key={f.dir}
      folder={f}
      folded={folded.includes(f.dir)}
      current={f.videos.some((v) => v.dir === dir)}
      onNew={(e) => setMenu({ kind: "new", folder: f, ...at(e) })}
      onMenu={(x, y) => setMenu({ kind: "folder", folder: f, x, y })}
      onKeys={shortcuts(f.dir)}
      {...naming(f.dir)}
    >
      {f.videos.filter((v) => !v.pinned).map((v) => video(v, true))}
    </FolderRow>
  );

  return (
    <nav
      aria-label="Videos and projects"
      style={{ width: open ? shown : RAIL_WIDTH.closed }}
      className={clsx(
        "relative flex shrink-0 flex-col gap-0.5 overflow-hidden border-r border-line bg-sunken/60 px-2 pt-2 pb-2.5",
        !dragging && "transition-[width] duration-150 ease-out",
      )}
    >
      <RailButton
        open={open}
        icon={<PlusIcon size={18} />}
        label="New video"
        keys={`${mod}N`}
        onClick={(e) => setMenu({ kind: "new", ...at(e) })}
        {...hint("New video", `${mod}N`)}
      />
      <RailButton
        open={open}
        icon={<MagnifyingGlassIcon size={18} />}
        label="Search"
        keys={`${mod}K`}
        onClick={() => setUi({ dialog: "projects" })}
        {...hint("Search videos", `${mod}K`)}
      />
      <RailButton
        open={open}
        icon={<SparkleIcon size={18} />}
        label="Inspirations"
        active={view === "inspirations"}
        onClick={() => setUi((s) => ({ view: s.view === "inspirations" ? "editor" : "inspirations" }))}
        {...hint("Inspirations")}
      />

      <div className="mx-1 my-2 border-t border-line" />

      {/* What you're working on; scrolls when it overflows. Closed: every video's frame, pinned first. */}
      <div
        onScroll={() => setTip(null)}
        className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-1 [scrollbar-width:none]"
      >
        {open ? (
          <>
            {(pinned.videos.length > 0 || pinned.folders.length > 0) && (
              <Section title="Pinned">
                {pinned.folders.map(folder)}
                {pinned.videos.map((v) => video(v))}
              </Section>
            )}
            <Section
              title="Projects"
              action={{ label: "New project", icon: <FolderPlusIcon size={14} />, run: () => setMaking({}) }}
            >
              {rest.map(folder)}
              {/* The videos in no project, as a project of their own. */}
              {loose.length > 0 && (
                <FolderRow
                  folder={{ dir: OTHER, name: "Other", videos: loose }}
                  other
                  folded={folded.includes(OTHER)}
                  current={loose.some((v) => v.dir === dir)}
                  onNew={(e) => setMenu({ kind: "new", ...at(e) })}
                >
                  {loose.map((v) => video(v, true))}
                </FolderRow>
              )}
              {!rest.length && !pinned.folders.length && (
                <button
                  type="button"
                  onClick={() => setMaking({})}
                  className="rounded-lg px-2 py-1.5 text-left text-[12px] text-faint hover:bg-button hover:text-muted"
                >
                  Group videos into a project…
                </button>
              )}
            </Section>
          </>
        ) : (
          order.concat(recent.filter((r) => !order.some((v) => v.dir === r.dir))).map((v) => video(v))
        )}
      </div>

      <div className="mx-1 mt-1.5 mb-1 border-t border-line" />
      <RailButton
        open={open}
        icon={<GearSixIcon size={18} />}
        label="Settings"
        keys={`${mod},`}
        onClick={() => setUi({ dialog: "settings", settingsSection: null })}
        {...hint("Settings", `${mod},`)}
      />

      <ResizeHandle open={open} width={shown} onDragging={setDragging} />

      {tip && !open && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[60] flex -translate-y-1/2 flex-col gap-0.5 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-xl animate-fade-in"
          style={{ top: tip.top, left: tip.left }}
        >
          <span className="text-fg">{tip.text}</span>
          {tip.meta && <span className="text-[11px] text-faint">{tip.meta}</span>}
        </div>
      )}
      {menu?.kind === "new" && (
        <NewProjectMenu
          at={menu}
          {...(menu.folder && { folder: menu.folder })}
          onNewFolder={() => setMaking({})}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === "video" && (
        <ProjectMenu
          {...menu}
          project={menu.video}
          folders={folders}
          onClose={() => setMenu(null)}
          onTrash={() => setTrashing(menu.video)}
          onNewFolder={() => setMaking({ thenMove: menu.video.dir })}
          onRename={() => setRenaming(menu.video.dir)}
        />
      )}
      {menu?.kind === "folder" && (
        <FolderMenu {...menu} onClose={() => setMenu(null)} onRename={() => setRenaming(menu.folder.dir)} />
      )}
      {trashing && <TrashDialog project={trashing} onClose={() => setTrashing(null)} />}
      {making && (
        <NewFolderDialog
          onClose={() => setMaking(null)}
          onMade={(made) => {
            if (making.thenMove) void moveToFolder(making.thenMove, made.dir);
          }}
        />
      )}
    </nav>
  );
}

/** A heading in the sidebar, with an action on hover ("New project"). */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; icon: ReactNode; run: () => void };
  children: ReactNode;
}) {
  return (
    <section className="group/section flex flex-col gap-0.5 pb-2">
      <div className="flex h-6 items-center justify-between pr-1 pl-2">
        <h2 className="m-0 text-[11px] font-normal text-faint">{title}</h2>
        {action && (
          <button
            type="button"
            aria-label={action.label}
            title={action.label}
            onClick={action.run}
            className="flex size-5 items-center justify-center rounded text-faint opacity-0 group-hover/section:opacity-100 hover:bg-button hover:text-fg focus-visible:opacity-100"
          >
            {action.icon}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** A project in the sidebar: folds open to its videos; a + makes a new video in it. */
function FolderRow({
  folder,
  other = false,
  folded,
  current,
  renaming = false,
  onRenamed,
  onNew,
  onMenu,
  onKeys,
  children,
}: {
  folder: ProjectFolder;
  /** "Other": the videos in no project. Not a folder: nothing to rename, pin or show. */
  other?: boolean;
  folded: boolean;
  current: boolean;
  renaming?: boolean;
  onRenamed?: (name: string | null) => void;
  onNew: (e: React.MouseEvent<HTMLElement>) => void;
  onMenu?: (x: number, y: number) => void;
  onKeys?: (e: React.KeyboardEvent) => boolean;
  children: ReactNode;
}) {
  const count = folder.videos.length;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/folder relative">
        <button
          type="button"
          aria-expanded={!folded}
          title={other ? "Videos in no project" : folder.dir}
          onClick={() => toggleFolded(folder.dir)}
          onContextMenu={(e) => {
            if (!onMenu) return;
            e.preventDefault();
            onMenu(e.clientX, e.clientY);
          }}
          onKeyDown={(e) => {
            if (onKeys?.(e)) return;
            if (onMenu && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              onMenu(r.right + 4, r.top);
            }
          }}
          className="flex h-8 w-full items-center gap-2 rounded-lg pr-14 pl-2 text-left text-[13px] text-fg-2 transition-colors hover:bg-button hover:text-fg"
        >
          <span className="shrink-0 text-faint">
            {folded ? <CaretRightIcon size={11} weight="bold" /> : <CaretDownIcon size={11} weight="bold" />}
          </span>
          <span className={clsx("shrink-0", current ? "text-accent" : "text-muted")}>
            {other ? (
              <FoldersIcon size={16} />
            ) : folded ? (
              <FolderIcon size={16} />
            ) : (
              <FolderOpenIcon size={16} />
            )}
          </span>
          {renaming ? (
            <span className="min-w-0 flex-1" />
          ) : (
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          )}
          {folded && count > 0 && <span className="shrink-0 text-[11px] text-faint">{count}</span>}
        </button>
        {renaming && onRenamed && (
          <NameField
            name={folder.name}
            onDone={onRenamed}
            className="absolute top-1/2 right-2 left-[46px] -translate-y-1/2"
          />
        )}
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/folder:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label={other ? "New video" : `New video in ${folder.name}`}
            title={other ? "New video" : "New video in this project"}
            onClick={onNew}
            className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-control hover:text-fg"
          >
            <PlusIcon size={14} />
          </button>
          {onMenu && (
            <button
              type="button"
              aria-label={`More for ${folder.name}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onMenu(r.right + 4, r.top);
              }}
              className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-control hover:text-fg"
            >
              <DotsThreeIcon size={16} weight="bold" />
            </button>
          )}
        </div>
      </div>
      {!folded &&
        (count ? (
          children
        ) : (
          <button
            type="button"
            onClick={onNew}
            className="rounded-lg py-1.5 pl-9 text-left text-[12px] text-faint hover:bg-button hover:text-muted"
          >
            No videos yet: add one
          </button>
        ))}
    </div>
  );
}

/** A name edited in place: Enter or leaving keeps it, Escape puts it back. */
function NameField({
  name,
  onDone,
  className,
}: {
  name: string;
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const [text, setText] = useState(name);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // Focused once the menu that started it has closed (it hands focus back to its button as it goes).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value === null || !value.trim() || value.trim() === name ? null : value.trim());
  };
  return (
    <input
      ref={input}
      value={text}
      aria-label="Name"
      spellCheck={false}
      maxLength={200}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(text);
        if (e.key === "Escape") finish(null);
      }}
      className={clsx(
        "h-7 min-w-0 rounded-md bg-sunken px-2 text-[13px] text-fg ring-1 ring-edge outline-none",
        className,
      )}
    />
  );
}

/**
 * The sidebar's right edge: drag to resize (double-click for the usual width, arrow keys by a step).
 * Dragged very narrow it folds to its strip; dragged out from the strip it opens. Never wider than a
 * third of the window, so the edit keeps its room.
 */
function ResizeHandle({
  open,
  width,
  onDragging,
}: {
  open: boolean;
  width: number;
  onDragging: (dragging: boolean) => void;
}) {
  const widest = () => Math.max(RAIL_WIDTH.min, Math.min(RAIL_WIDTH.max, window.innerWidth / 3));
  const set = (w: number, save = true) => setRailWidth(Math.min(w, widest()), save);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element; this is the ARIA pattern for one.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={RAIL_WIDTH.min}
      aria-valuemax={RAIL_WIDTH.max}
      aria-valuenow={open ? width : RAIL_WIDTH.closed}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onDoubleClick={() => {
        setRailOpen(true);
        set(RAIL_WIDTH.initial);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        if (!open) return setRailOpen(e.key === "ArrowRight");
        set(width + (e.key === "ArrowRight" ? 16 : -16));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startWidth = open ? width : RAIL_WIDTH.closed;
        let opened = open;
        onDragging(true);
        document.body.style.cursor = "col-resize";
        const move = (ev: PointerEvent) => {
          const w = startWidth + ev.clientX - startX;
          // Past half the narrowest open width it folds; dragged out again it opens.
          if (opened && w < RAIL_WIDTH.min / 2 + RAIL_WIDTH.closed / 2) {
            opened = false;
            setRailOpen(false);
          } else if (!opened && w > RAIL_WIDTH.closed + 40) {
            opened = true;
            setRailOpen(true);
          }
          if (opened) set(w, false);
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          document.body.style.cursor = "";
          onDragging(false);
          if (opened) set(useUi.getState().railWidth);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      }}
      className="group/resize absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize outline-none"
    >
      <span className="absolute inset-y-0 right-0 w-px bg-accent opacity-0 transition-opacity group-hover/resize:opacity-60 group-focus-visible/resize:opacity-100 group-active/resize:opacity-100" />
    </div>
  );
}

function RailButton({
  open,
  icon,
  label,
  keys,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  open: boolean;
  icon: ReactNode;
  label: string;
  keys?: string | undefined;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      {...props}
      className={clsx(
        "flex h-9 shrink-0 items-center gap-3 rounded-lg text-[13px] transition-colors",
        open ? "px-2.5" : "justify-center",
        active ? "bg-selected text-fg" : "text-muted hover:bg-button hover:text-fg",
      )}
    >
      <span className="shrink-0">{icon}</span>
      {open && (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          {keys && <Keys>{keys}</Keys>}
        </>
      )}
    </button>
  );
}

function ProjectButton({
  project,
  open,
  indent = false,
  current,
  shortcut,
  hint,
  renaming = false,
  onRenamed,
  onKeys,
  onMenu,
}: {
  project: RecentProject;
  open: boolean;
  /** Under its project in the sidebar. */
  indent?: boolean;
  renaming?: boolean;
  onRenamed?: (name: string | null) => void;
  onKeys?: (e: React.KeyboardEvent) => boolean;
  current: boolean;
  shortcut: string | undefined;
  hint: (text: string, meta?: string) => object;
  onMenu: (x: number, y: number) => void;
}) {
  const working = useWorking((s) => s.dirs.includes(project.dir));
  const meta = working ? "Claude is editing" : current ? "Open" : ago(project.openedAt);
  return (
    <div className="group/project relative">
      <button
        type="button"
        aria-label={project.name}
        aria-current={current ? "page" : undefined}
        title={open ? project.dir : undefined}
        onClick={() => {
          // The open one takes you back to its editor (from Inspirations, say); another switches to it.
          if (current) setUi({ view: "editor" });
          else void openProject(() => host.project.open(project.dir));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY);
        }}
        // Its menu by keyboard too, the way the system opens one: ⇧F10 or the context-menu key.
        onKeyDown={(e) => {
          if (onKeys?.(e)) return;
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.right + 4, r.top);
          }
        }}
        aria-haspopup="menu"
        {...hint(project.name, [meta, shortcut].filter(Boolean).join(" · "))}
        className={clsx(
          "flex w-full items-center gap-3 rounded-lg py-1.5 text-left transition-colors",
          open ? (indent ? "pr-2 pl-7" : "px-2") : "justify-center",
          open && current ? "bg-selected" : "hover:bg-button",
        )}
      >
        <span className="relative shrink-0">
          <ProjectThumb dir={project.dir} name={project.name} ring={current && !open && !working} />
          {/* Claude working in it: an arc travels round the thumbnail. */}
          {working && <span aria-hidden className="working-ring" />}
        </span>
        {open && (
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-6">
            <span
              className={clsx(
                "flex items-center gap-1 truncate text-[13px] text-fg",
                renaming && "invisible",
              )}
            >
              <span className="truncate">{project.name}</span>
              {project.pinned && <PushPinIcon size={11} weight="fill" className="shrink-0 text-faint" />}
            </span>
            <span className={clsx("truncate text-[11px]", working ? "shimmer" : "text-faint")}>{meta}</span>
          </span>
        )}
      </button>
      {open && renaming && onRenamed && (
        <NameField
          name={project.name}
          onDone={onRenamed}
          className={clsx("absolute top-1.5 right-2", indent ? "left-[59px]" : "left-[41px]")}
        />
      )}
      {open && (
        <button
          type="button"
          aria-label={`More for ${project.name}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.right + 4, r.top);
          }}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted opacity-0 group-hover/project:opacity-100 hover:bg-control hover:text-fg focus-visible:opacity-100"
        >
          <DotsThreeIcon size={16} weight="bold" />
        </button>
      )}
    </div>
  );
}

/**
 * A frame of the video's first shot, in the video's own shape (a vertical one tall, a wide one wide)
 * inside a fixed slot, so names line up; before it has one, its initial on a colour from its name.
 */
export function ProjectThumb({
  dir,
  name,
  ring = false,
  size = 32,
  className,
}: {
  dir: string;
  name: string;
  ring?: boolean;
  /** The slot's height; it's this wide times 5/7. */
  size?: number;
  className?: string;
}) {
  const url = useProjects((s) => s.thumbs[dir]);
  const ref = useRef<HTMLSpanElement>(null);
  // Width over height of the frame, once it's loaded; vertical (9:16) until then, as most videos are.
  const [aspect, setAspect] = useState(9 / 16);
  // Asked for once it scrolls into view: a long list doesn't make every thumbnail at once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        loadThumb(dir);
        seen.disconnect();
      }
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [dir]);
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const slot = { width: Math.round((size * 5) / 7), height: size };
  const box =
    aspect < slot.width / slot.height
      ? { width: Math.round(slot.height * aspect), height: slot.height }
      : { width: slot.width, height: Math.round(slot.width / aspect) };
  return (
    <span ref={ref} className={clsx("flex shrink-0 items-center justify-center", className)} style={slot}>
      <span
        className={clsx(
          "flex items-center justify-center overflow-hidden rounded-[5px] text-[13px] font-semibold text-white/80 ring-1 ring-white/10 ring-inset",
          ring && "outline-2 outline-offset-2 outline-accent",
        )}
        style={url ? box : { ...box, background: `hsl(${Math.abs(hash) % 360} 22% 30%)` }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w && h) setAspect(w / h);
            }}
            className="size-full object-cover"
          />
        ) : (
          (/\p{L}/u.exec(name)?.[0] ?? name.trim().charAt(0)).toUpperCase()
        )}
      </span>
    </span>
  );
}

/** A shortcut, in the system's font: its ⌘ and ⇧ are drawn the way the menus draw them. */
export function Keys({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-[12px] tracking-[0.04em] text-faint [font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif]">
      {children}
    </span>
  );
}

/** A small menu at a point on the screen, kept inside the window; closes on a click elsewhere or Escape. */
function Popover({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // Keyboard: the first item takes focus, ↑↓ Home End move, and focus goes back where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => before?.focus?.();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === "ArrowDown"
        ? (at + 1) % items.length
        : e.key === "ArrowUp"
          ? (at - 1 + items.length) % items.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      className="fixed z-[60] w-64 rounded-xl border border-line-strong bg-panel p-1.5 shadow-2xl animate-rise"
      style={{ left: pos.x, top: pos.y }}
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  hint,
  danger,
  children,
  keys,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  hint?: string;
  danger?: boolean;
  /** Its shortcut, shown at the right. */
  keys?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      {...props}
      className={clsx(
        "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-raised",
        danger ? "text-bad" : "text-fg-2 hover:text-fg",
      )}
    >
      <span className={clsx("mt-px shrink-0", danger ? "text-bad" : "text-muted")}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {children}
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </span>
      {keys && <Keys>{keys}</Keys>}
    </button>
  );
}

const Divider = () => <div className="mx-2 my-1 border-t border-line" />;

function NewProjectMenu({
  at,
  folder,
  onNewFolder,
  onClose,
}: {
  at: { x: number; y: number };
  /** A new video in this project. */
  folder?: ProjectFolder;
  onNewFolder: () => void;
  onClose: () => void;
}) {
  const run = (fn: () => Promise<Awaited<ReturnType<typeof host.project.open>>>) => {
    onClose();
    void openProject(fn).then(() => refreshProjects());
  };
  return (
    <Popover x={at.x} y={at.y} onClose={onClose}>
      {folder && <div className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">New video in {folder.name}</div>}
      <MenuItem
        icon={<FilmStripIcon size={15} />}
        onClick={() => run(() => host.project.newFromVideos(folder?.dir))}
      >
        From clips…
      </MenuItem>
      <MenuItem
        icon={<PlusIcon size={15} />}
        onClick={() => run(() => host.project.create("Untitled", folder?.dir))}
      >
        {folder ? "Empty video" : "Empty video…"}
      </MenuItem>
      {!folder && (
        <>
          <Divider />
          <MenuItem
            icon={<FolderPlusIcon size={15} />}
            hint="A folder that groups several videos"
            onClick={() => {
              onClose();
              onNewFolder();
            }}
          >
            New project…
          </MenuItem>
          <MenuItem icon={<FolderOpenIcon size={15} />} onClick={() => run(() => host.project.open())}>
            Open a folder…
          </MenuItem>
          <MenuItem icon={<SparkleIcon size={15} />} onClick={() => run(() => host.project.openDemo())}>
            Demo video
          </MenuItem>
        </>
      )}
    </Popover>
  );
}

function ProjectMenu({
  project,
  x,
  y,
  folders,
  onClose,
  onTrash,
  onNewFolder,
  onRename,
}: {
  project: RecentProject;
  x: number;
  y: number;
  folders: readonly ProjectFolder[];
  onClose: () => void;
  onTrash: () => void;
  onNewFolder: () => void;
  onRename: () => void;
}) {
  const fork = (from: "edit" | "footage") => {
    onClose();
    void forkProject(project.dir, from);
  };
  const home = folders.find((f) => f.videos.some((v) => v.dir === project.dir));
  const elsewhere = folders.filter((f) => f !== home).slice(0, 8);
  const move = (folder: string | null) => {
    onClose();
    void moveToFolder(project.dir, folder);
  };
  return (
    <Popover x={x} y={y} onClose={onClose}>
      <MenuItem
        icon={<PencilSimpleIcon size={15} />}
        keys={RENAME_KEYS}
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename
      </MenuItem>
      <MenuItem
        icon={project.pinned ? <PushPinSlashIcon size={15} /> : <PushPinIcon size={15} />}
        keys={PIN_KEYS}
        onClick={() => {
          onClose();
          void pin(project.dir, !project.pinned);
        }}
      >
        {project.pinned ? "Unpin" : "Pin"}
      </MenuItem>
      <Divider />
      <div className="px-2.5 pt-1 pb-0.5 text-[11px] text-faint">
        {home ? `In ${home.name}` : "Move to a project"}
      </div>
      {elsewhere.map((f) => (
        <MenuItem key={f.dir} icon={<FolderIcon size={15} />} onClick={() => move(f.dir)}>
          {f.name}
        </MenuItem>
      ))}
      <MenuItem
        icon={<FolderPlusIcon size={15} />}
        onClick={() => {
          onClose();
          onNewFolder();
        }}
      >
        New project…
      </MenuItem>
      {home && (
        <MenuItem icon={<FolderSimpleDashedIcon size={15} />} onClick={() => move(null)}>
          Out of {home.name}
        </MenuItem>
      )}
      <Divider />
      <MenuItem
        icon={<FilmStripIcon size={15} />}
        hint="Already transcribed: Claude only redoes the edit"
        onClick={() => fork("footage")}
      >
        Fork from the original clips
      </MenuItem>
      <MenuItem
        icon={<CopyIcon size={15} />}
        hint="The same cut, to try another direction"
        onClick={() => fork("edit")}
      >
        Fork this edit
      </MenuItem>
      <Divider />
      <MenuItem
        icon={<FolderOpenIcon size={15} />}
        onClick={() => {
          onClose();
          void host.project.showProject(project.dir);
        }}
      >
        {isMac ? "Show in Finder" : "Show in folder"}
      </MenuItem>
      <MenuItem
        icon={<TrashIcon size={15} />}
        danger
        onClick={() => {
          onClose();
          onTrash();
        }}
      >
        Move to Trash
      </MenuItem>
    </Popover>
  );
}

function FolderMenu({
  folder,
  x,
  y,
  onClose,
  onRename,
}: {
  folder: ProjectFolder;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
}) {
  const run = (fn: () => Promise<Awaited<ReturnType<typeof host.project.open>>>) => {
    onClose();
    void openProject(fn).then(() => refreshProjects());
  };
  return (
    <Popover x={x} y={y} onClose={onClose}>
      <MenuItem
        icon={<FilmStripIcon size={15} />}
        onClick={() => run(() => host.project.newFromVideos(folder.dir))}
      >
        New video from clips…
      </MenuItem>
      <MenuItem
        icon={<PlusIcon size={15} />}
        onClick={() => run(() => host.project.create("Untitled", folder.dir))}
      >
        New empty video
      </MenuItem>
      <Divider />
      <MenuItem
        icon={<PencilSimpleIcon size={15} />}
        keys={RENAME_KEYS}
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename
      </MenuItem>
      <MenuItem
        icon={folder.pinned ? <PushPinSlashIcon size={15} /> : <PushPinIcon size={15} />}
        keys={PIN_KEYS}
        onClick={() => {
          onClose();
          void pin(folder.dir, !folder.pinned);
        }}
      >
        {folder.pinned ? "Unpin" : "Pin"}
      </MenuItem>
      <MenuItem
        icon={<FolderOpenIcon size={15} />}
        onClick={() => {
          onClose();
          void host.project.showProject(folder.dir);
        }}
      >
        {isMac ? "Show in Finder" : "Show in folder"}
      </MenuItem>
    </Popover>
  );
}

/** Names a new project (a folder for videos, in the videos folder). */
function NewFolderDialog({
  onClose,
  onMade,
}: {
  onClose: () => void;
  onMade: (folder: ProjectFolder) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const made = await newFolder(name.trim());
    setBusy(false);
    if (!made) return;
    onMade(made);
    onClose();
  };
  return (
    <Dialog title="New project" onClose={onClose} width={400}>
      <p className="m-0 mb-3 text-[13px] leading-relaxed text-fg-2">
        A folder that groups videos: a campaign, a client, a series.
      </p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void make()}
        placeholder="Patek campaign"
        aria-label="Project name"
        spellCheck={false}
        className="h-9 w-full rounded-lg bg-sunken/70 px-3 text-[13.5px] text-fg ring-1 ring-line ring-inset outline-none placeholder:text-faint focus:ring-edge"
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="accent" disabled={busy || !name.trim()} onClick={() => void make()}>
          Create
        </Button>
      </div>
    </Dialog>
  );
}

function TrashDialog({ project, onClose }: { project: RecentProject; onClose: () => void }) {
  const dir = useProject((s) => s.dir);
  const [busy, setBusy] = useState(false);
  const trash = async () => {
    setBusy(true);
    try {
      if (project.dir === dir) {
        // The open project closes first, and the next one opens: through openProject's guard (which
        // says why when it doesn't go ahead).
        const done = await openProject(() => host.project.trash(project.dir).then((s) => s ?? null));
        if (!done) {
          setBusy(false);
          onClose();
          return;
        }
      } else await host.project.trash(project.dir);
      toast(`Moved ${project.name} to the Trash`);
      void refreshProjects();
      onClose();
    } catch (err) {
      toast((err as Error).message, "warn");
      setBusy(false);
    }
  };
  return (
    <Dialog title="Move to Trash?" onClose={onClose} width={420}>
      <p className="m-0 text-[13px] leading-relaxed text-fg-2">
        The folder <span className="text-fg">{project.name}</span> and everything in it goes to the Trash.
        Your original clips stay where they are. You can put it back from the Trash.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="accent" disabled={busy} onClick={() => void trash()}>
          Move to Trash
        </Button>
      </div>
    </Dialog>
  );
}
