import {
  ArrowCircleUpIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect } from "react";
import { Button, IconButton } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { isMac } from "../../lib/keys.ts";
import { followDownloads, size, useDownloads } from "../../state/downloads.ts";
import { useJobs } from "../../state/jobs.ts";
import { togglePanel, useShown } from "../../state/layout.ts";
import { edit, redo, undo, useDoc, useProject } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { setUi, useUi } from "../../state/ui.ts";
import { useUpdate } from "../../state/update.ts";

/** The title bar: the rail's switch, the project's name, what's running, undo and redo, and Export. */
export function Header() {
  const canUndo = useProject((s) => s.undoStack.length > 0);
  const canRedo = useProject((s) => s.redoStack.length > 0);
  const exporting = useJobs((s) => (s.export?.status === "running" ? s.export.fraction : null));
  const railOpen = useShown("rail");
  const sideOpen = useShown("side");
  const mod = isMac ? "⌘" : "Ctrl+";

  return (
    <header
      className={`drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-line pr-4 ${
        isMac && host.kind === "desktop" ? "pl-[84px]" : "pl-3"
      }`}
    >
      <IconButton
        label={`${railOpen ? "Hide" : "Show"} project names (${mod}B)`}
        onClick={() => togglePanel("rail")}
        data-peek="rail"
        className="no-drag shrink-0"
      >
        <SidebarSimpleIcon size={17} />
      </IconButton>
      <ProjectTitle />
      {/* A narrow window cuts these short before anything else (their tooltips say it all). */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden font-mono text-xs text-muted tabular">
        <IndexingPill />
        <DownloadsPill />
      </div>
      <div className="no-drag ml-auto flex shrink-0 items-center gap-1.5">
        <UpdatePill />
        <IconButton
          label={`${sideOpen ? "Hide" : "Show"} the side panel (${isMac ? "⇧⌘" : "Ctrl+Shift+"}B)`}
          onClick={() => togglePanel("side")}
          data-peek="side"
          className={sideOpen ? undefined : "text-faint"}
        >
          <SidebarSimpleIcon size={17} mirrored />
        </IconButton>
        <IconButton label={`Undo (${isMac ? "⌘" : "Ctrl+"}Z)`} disabled={!canUndo} onClick={undo}>
          <ArrowUUpLeftIcon size={16} />
        </IconButton>
        <IconButton label={`Redo (${isMac ? "⇧⌘" : "Ctrl+Shift+"}Z)`} disabled={!canRedo} onClick={redo}>
          <ArrowUUpRightIcon size={16} />
        </IconButton>
        <Button variant="accent" onClick={() => setUi({ dialog: "export" })} className="ml-1.5 min-w-[78px]">
          {exporting === null ? "Export" : `${Math.round(exporting * 100)}%`}
        </Button>
      </div>
    </header>
  );
}

/** "Downloading speech recognition · 42%": what the app is fetching for itself, while it does. */
function DownloadsPill() {
  // The list itself from the store (a filtered copy each render would loop), then what's still running.
  const all = useDownloads((s) => s.list);
  useEffect(followDownloads, []);
  const list = all.filter((d) => d.state === "running");
  if (!list.length) return null;
  // Several at once read as one: the sound model's weights and its labels are one thing to wait for.
  const labels = [...new Set(list.map((d) => d.label))];
  const total = list.reduce((n, d) => n + d.bytes, 0);
  const done = list.reduce((n, d) => n + d.bytes * d.fraction, 0);
  const fraction = total ? done / total : list.reduce((n, d) => n + d.fraction, 0) / list.length;
  return (
    <span
      title={list.map((d) => `${d.label}: ${Math.round(d.fraction * 100)}% of ${size(d.bytes)}`).join("\n")}
      className="flex min-w-0 items-center gap-1.5 truncate rounded-full bg-button px-2.5 py-1 whitespace-nowrap text-fg-2 animate-fade-in"
    >
      <DownloadSimpleIcon size={12} className="shrink-0 text-muted" />
      Downloading {labels.length === 1 ? labels[0]!.toLowerCase() : `${labels.length} things`} ·{" "}
      {Math.round(fraction * 100)}%
    </span>
  );
}

/**
 * "Update 0.2.0" when a new version is out, "Updating · 42%" while it downloads, "Restart to update" once
 * it's ready. Each step waits for a click; the tooltip says what the click does.
 */
function UpdatePill() {
  const u = useUpdate((s) => s.state);
  const pill =
    "flex h-[26px] items-center gap-1.5 rounded-full whitespace-nowrap px-2.5 text-xs animate-fade-in";
  if (u.status === "downloading")
    return (
      <span className={`${pill} bg-button font-mono text-fg-2 tabular`}>
        <CircleNotchIcon size={12} className="animate-spin text-muted" />
        Updating · {Math.round((u.fraction ?? 0) * 100)}%
      </span>
    );
  const ready = u.status === "ready";
  const offered = u.status === "available" || (u.status === "error" && u.version);
  if (!ready && !offered) return null;
  const title = ready
    ? `Cutroom ${u.version} is downloaded. Click to restart into it, or it installs when you next quit.`
    : u.manual
      ? `Cutroom ${u.version} is out. Click to open its download page.`
      : `Cutroom ${u.version} is out. Click to download it; you choose when to restart.`;
  const act = () =>
    (ready ? host.updates.install() : host.updates.download()).catch((err: unknown) =>
      toast((err as Error).message, "warn"),
    );
  return (
    <button
      type="button"
      title={title}
      onClick={() => void act()}
      className={`${pill} bg-accent/10 font-medium text-accent hover:bg-accent/15`}
    >
      <ArrowCircleUpIcon size={13} weight="bold" />
      {ready ? "Restart to update" : `Update ${u.version}`}
    </button>
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
    <span
      title={label}
      className="flex min-w-0 items-center gap-1.5 truncate rounded-full bg-accent/10 px-2.5 py-1 whitespace-nowrap text-accent animate-fade-in"
    >
      <CircleNotchIcon size={12} className="shrink-0 animate-spin" />
      {label} · {Math.round(avg * 100)}%
    </span>
  );
}

/** The project's name; double-click (or Rename in its menu) to change it. */
function ProjectTitle() {
  const name = useDoc((d) => d.meta.name);
  const dir = useProject((s) => s.dir);
  const renaming = useUi((s) => s.renaming);
  const rename = (next: string) => {
    setUi({ renaming: false });
    const clean = next.trim().slice(0, 120);
    // The project's name (project.json), not its folder: one undoable edit.
    if (clean && clean !== name)
      edit([{ op: "merge", key: "meta", patch: { name: clean } }], {
        message: `Renamed the project to ${clean}`,
      });
  };
  return renaming ? (
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
        if (e.key === "Escape") setUi({ renaming: false });
      }}
      className="no-drag w-[320px] min-w-0 shrink rounded-lg border border-edge bg-sunken px-2 py-1 text-[14px] font-semibold text-fg outline-none"
    />
  ) : (
    <button
      type="button"
      onDoubleClick={() => setUi({ renaming: true })}
      // By keyboard: Enter or F2, as in the Finder.
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          setUi({ renaming: true });
        }
      }}
      aria-label={`${name}, press Enter to rename`}
      title={`${dir ?? ""}\nDouble-click to rename`}
      className="no-drag max-w-[360px] min-w-0 shrink truncate rounded-lg px-2 py-1 text-[14px] font-semibold text-fg hover:bg-button"
    >
      {name}
    </button>
  );
}
