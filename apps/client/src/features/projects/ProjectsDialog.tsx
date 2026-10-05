/**
 * Every project you've opened, newest first, with search: the place to find one when the header's
 * menu (a handful of recents) isn't enough. Type to filter by name or folder; ↑↓ and Enter open one.
 */
import type { RecentProject } from "@vedit/bridge";
import { clsx } from "clsx";
import { Film, FolderOpen, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { host } from "../../lib/host.ts";
import { load, useProject } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { setUi } from "../../state/ui.ts";

/** Opens a project (from a path, or the system picker) and switches the editor to it. */
export async function openProject(
  fn: () => Promise<Awaited<ReturnType<typeof host.project.restore>> | null>,
): Promise<void> {
  try {
    const snap = await fn();
    if (snap) load(snap);
  } catch (err) {
    toast((err as Error).message, "warn");
  }
}

/** "2h ago", "yesterday", "12 Sep". */
export function ago(at: number): string {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2 * 86400) return "yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Projects whose name or folder holds every word typed. */
export function matching(list: readonly RecentProject[], query: string): RecentProject[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((r) => words.every((w) => `${r.name} ${r.dir}`.toLowerCase().includes(w)));
}

export function ProjectsDialog() {
  const dir = useProject((s) => s.dir);
  const [list, setList] = useState<RecentProject[] | null>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void host.project.recent().then(setList);
  }, []);
  const shown = useMemo(() => matching(list ?? [], query), [list, query]);
  const close = () => setUi({ dialog: null });
  const open = (r: RecentProject) => {
    close();
    if (r.dir !== dir) void openProject(() => host.project.open(r.dir));
  };
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  return (
    <Dialog title={`Projects${list ? ` · ${list.length}` : ""}`} onClose={close} width={620}>
      <div className="-m-5 flex flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((i) => Math.min(shown.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && shown[at]) open(shown[at]);
            }}
            placeholder="Search by name or folder"
            aria-label="Search projects"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => {
              close();
              void openProject(() => host.project.open());
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-button px-2.5 py-1 text-xs text-fg-2 hover:bg-chip"
          >
            <FolderOpen size={13} /> Open folder…
          </button>
        </div>
        <div ref={listRef} className="flex max-h-[min(60vh,520px)] flex-col overflow-y-auto p-1.5">
          {shown.map((r, i) => (
            <button
              key={r.dir}
              type="button"
              data-i={i}
              onMouseEnter={() => setAt(i)}
              onClick={() => open(r)}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-left",
                i === at ? "bg-raised" : "hover:bg-raised",
              )}
            >
              <Film size={15} className={clsx("shrink-0", r.dir === dir ? "text-accent" : "text-muted")} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-fg">
                  {r.name}
                  {r.dir === dir && <span className="ml-2 text-xs text-accent">open</span>}
                </span>
                <span className="truncate font-mono text-[11px] text-faint" title={r.dir}>
                  {r.dir.replace(/^\/Users\/[^/]+/, "~")}
                </span>
              </span>
              <span className="shrink-0 text-xs text-faint">{ago(r.openedAt)}</span>
            </button>
          ))}
          {list && !shown.length && (
            <p className="px-3 py-6 text-center text-[13px] text-faint">
              {list.length ? `No projects match "${query}".` : "No projects yet."}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
