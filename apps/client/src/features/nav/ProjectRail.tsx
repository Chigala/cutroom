/**
 * The project rail, down the left like Claude's sidebar: new project, search, inspirations, then the
 * recent projects as thumbnails of their footage (one click switches), and settings at the foot. ⌘B
 * shows their names; closed, it's a strip of frames that leaves the room to the edit.
 */
import {
  CopyIcon,
  DotsThreeIcon,
  FilmStripIcon,
  FolderOpenIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { RecentProject } from "@vedit/bridge";
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
  openProject,
  refreshProjects,
  useProjects,
} from "../../state/projects.ts";
import { toast } from "../../state/toast.ts";
import { setUi, useUi } from "../../state/ui.ts";

/** ⌘1 to ⌘9 open the rail's first nine projects. */
export const PROJECT_SHORTCUTS = 9;

export function ProjectRail() {
  const open = useUi((s) => s.railOpen);
  const view = useUi((s) => s.view);
  const recent = useProjects((s) => s.recent);
  const dir = useProject((s) => s.dir);
  const [tip, setTip] = useState<{ text: string; meta: string; top: number; left: number } | null>(null);
  const [menu, setMenu] = useState<{ project: RecentProject; x: number; y: number } | null>(null);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const [trashing, setTrashing] = useState<RecentProject | null>(null);

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

  return (
    <nav
      aria-label="Projects"
      className={clsx(
        "flex shrink-0 flex-col gap-0.5 overflow-hidden border-r border-line bg-sunken/60 px-2 pt-2 pb-2.5 transition-[width] duration-150 ease-out",
        open ? "w-[240px]" : "w-[60px]",
      )}
    >
      <RailButton
        open={open}
        icon={<PlusIcon size={18} />}
        label="New project"
        keys={`${mod}N`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setNewMenu({ x: r.right + 6, y: r.top });
        }}
        {...hint("New project", `${mod}N`)}
      />
      <RailButton
        open={open}
        icon={<MagnifyingGlassIcon size={18} />}
        label="Search"
        keys={`${mod}K`}
        onClick={() => setUi({ dialog: "projects" })}
        {...hint("Search projects", `${mod}K`)}
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
      {open && <div className="px-2 pb-1 text-[11px] text-faint">Projects</div>}

      {/* Every project, newest added first (opening one leaves it in place); scrolls when they overflow. */}
      <div
        onScroll={() => setTip(null)}
        className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 [scrollbar-width:none]"
      >
        {recent.map((p, i) => (
          <ProjectButton
            key={p.dir}
            project={p}
            open={open}
            current={p.dir === dir}
            shortcut={i < PROJECT_SHORTCUTS ? `${mod}${i + 1}` : undefined}
            hint={hint}
            onMenu={(x, y) => {
              setTip(null);
              setMenu({ project: p, x, y });
            }}
          />
        ))}
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
      {newMenu && <NewProjectMenu at={newMenu} onClose={() => setNewMenu(null)} />}
      {menu && (
        <ProjectMenu
          {...menu}
          current={menu.project.dir === dir}
          onClose={() => setMenu(null)}
          onTrash={() => setTrashing(menu.project)}
        />
      )}
      {trashing && <TrashDialog project={trashing} onClose={() => setTrashing(null)} />}
    </nav>
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
  current,
  shortcut,
  hint,
  onMenu,
}: {
  project: RecentProject;
  open: boolean;
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
          open ? "px-2" : "justify-center",
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
            <span className="truncate text-[13px] text-fg">{project.name}</span>
            <span className={clsx("truncate text-[11px]", working ? "shimmer" : "text-faint")}>{meta}</span>
          </span>
        )}
      </button>
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

/** A frame of the project's first shot; before it has one, its initial on a colour from its name. */
export function ProjectThumb({
  dir,
  name,
  ring = false,
  className,
}: {
  dir: string;
  name: string;
  ring?: boolean;
  className?: string;
}) {
  const url = useProjects((s) => s.thumbs[dir]);
  const ref = useRef<HTMLSpanElement>(null);
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
  return (
    <span
      ref={ref}
      className={clsx(
        "flex h-[42px] w-[30px] items-center justify-center overflow-hidden rounded-md text-[13px] font-semibold text-white/80",
        ring && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
        className,
      )}
      style={url ? undefined : { background: `hsl(${Math.abs(hash) % 360} 22% 30%)` }}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        (/\p{L}/u.exec(name)?.[0] ?? name.trim().charAt(0)).toUpperCase()
      )}
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
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; hint?: string; danger?: boolean }) {
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
      <span className="flex min-w-0 flex-col gap-0.5">
        {children}
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </span>
    </button>
  );
}

const Divider = () => <div className="mx-2 my-1 border-t border-line" />;

function NewProjectMenu({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const run = (fn: () => Promise<Awaited<ReturnType<typeof host.project.open>>>) => {
    onClose();
    void openProject(fn);
  };
  return (
    <Popover x={at.x} y={at.y} onClose={onClose}>
      <MenuItem icon={<FilmStripIcon size={15} />} onClick={() => run(() => host.project.newFromVideos())}>
        From videos…
      </MenuItem>
      <MenuItem icon={<PlusIcon size={15} />} onClick={() => run(() => host.project.create("Untitled"))}>
        Empty project…
      </MenuItem>
      <Divider />
      <MenuItem icon={<FolderOpenIcon size={15} />} onClick={() => run(() => host.project.open())}>
        Open a folder…
      </MenuItem>
      <MenuItem icon={<SparkleIcon size={15} />} onClick={() => run(() => host.project.openDemo())}>
        Demo project
      </MenuItem>
    </Popover>
  );
}

function ProjectMenu({
  project,
  x,
  y,
  current,
  onClose,
  onTrash,
}: {
  project: RecentProject;
  x: number;
  y: number;
  current: boolean;
  onClose: () => void;
  onTrash: () => void;
}) {
  const fork = (from: "edit" | "footage") => {
    onClose();
    void forkProject(project.dir, from);
  };
  return (
    <Popover x={x} y={y} onClose={onClose}>
      {current && (
        <MenuItem
          icon={<PencilSimpleIcon size={15} />}
          onClick={() => {
            onClose();
            setUi({ renaming: true });
          }}
        >
          Rename
        </MenuItem>
      )}
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
