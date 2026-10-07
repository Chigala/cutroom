import {
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  BracketsSquareIcon,
  CaretRightIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  CrosshairIcon,
  CursorClickIcon,
  FilmStripIcon,
  GearSixIcon,
  LightbulbIcon,
  ListPlusIcon,
  MusicNotesIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  SparkleIcon,
  StopIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { AgentContext, WorkEntry } from "@vedit/bridge";
import { activeInspiration, formatTime, inspirationMeta } from "@vedit/project";
import { clsx } from "clsx";
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown.tsx";
import { ChangeChip } from "../../components/ui.tsx";
import { type Attachment, pending, upload } from "../../lib/attach.ts";
import { took } from "../../lib/duration.ts";
import { host, MEDIA_BASE } from "../../lib/host.ts";
import { mod } from "../../lib/keys.ts";
import {
  type AgentRun,
  type ChangeNote,
  type ChatItem,
  discardWork,
  firstCutPrompt,
  keepWork,
  removeQueued,
  retry,
  STARTERS,
  send,
  sendNextQueued,
  sentRequests,
  setAutoFirstCut,
  stop,
  useChat,
  useSuggestion,
} from "../../state/chat.ts";
import { useJobs } from "../../state/jobs.ts";
import { offerToKeep } from "../../state/library.ts";
import { currentTime } from "../../state/playback.ts";
import { isReverted, receive, revert, useDoc, useProject } from "../../state/project.ts";
import { setRange, useTimeline } from "../../state/timeline.ts";
import { toast } from "../../state/toast.ts";
import { composerRef, select, selectionContext, setUi, useUi } from "../../state/ui.ts";
import { ThinkingPicker } from "./ThinkingPicker.tsx";
import { UsageMeter } from "./UsageMeter.tsx";

export function ChatPanel() {
  const items = useChat((s) => s.items);
  const dir = useProject((s) => s.dir);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Stick to the bottom while the agent streams, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <aside className="flex min-h-0 w-[380px] shrink-0 flex-col border-r border-line bg-panel">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        // The conversation is text: select and copy any of it (the app is otherwise unselectable).
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[18px] pt-[18px] pb-2 select-text"
      >
        {items.length === 0 ? (
          <Empty />
        ) : (
          items.map((item, i) => (
            <Fragment key={item.id}>
              <Item item={item} />
              {item.kind !== "user" && <HandEdits after={item} next={items[i + 1]} />}
            </Fragment>
          ))
        )}
      </div>
      {/* One per project: its draft stays with it; attachments not sent are dropped on switching. */}
      <Composer key={dir ?? ""} dir={dir} />
    </aside>
  );
}

const SUGGESTIONS = [
  "Make the hook punchier",
  "Tighten the middle, it drags",
  "Add a zoom on every laugh",
  "Resolve the open comments",
];

function Empty() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 pb-2 animate-fade-in">
      <p className="text-[13px] leading-relaxed text-muted">
        Say what you want. I edit the project, show you what changed, and you keep or undo each part.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void send(s)}
            className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-fg-3 hover:border-edge hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

const Item = memo(function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex max-w-[290px] flex-col items-end gap-1.5 self-end animate-rise">
          {item.attachments && <SentAttachments sources={item.attachments} />}
          <div className="rounded-[14px_14px_4px_14px] bg-chip px-[13px] py-2.5 text-sm leading-[1.45] whitespace-pre-wrap">
            {item.text}
            <ContextLine context={item.context} />
          </div>
        </div>
      );
    case "agent":
      return <Run run={item} />;
    case "note":
      return <Note commitId={item.commitId} imported={item.import} />;
  }
});

/** What a sent message carried, from the project's library (so it stays after the chip is gone). */
function SentAttachments({ sources }: { sources: readonly string[] }) {
  const library = useDoc((d) => d.sources);
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {sources.map((id) => {
        const s = library.find((x) => x.id === id);
        const url = `${MEDIA_BASE}${encodeURIComponent(id)}`;
        return (
          <div
            key={id}
            title={s?.label ?? id}
            className="flex h-14 items-center overflow-hidden rounded-lg border border-line-strong bg-raised"
          >
            {s?.kind === "image" ? (
              <img src={url} alt={s.label} className="h-full w-auto max-w-[120px] object-cover" />
            ) : s?.kind === "video" ? (
              <video src={`${url}#t=0.5`} muted preload="metadata" className="h-full w-auto max-w-[120px]" />
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 text-xs text-fg-2">
                <MusicNotesIcon size={13} /> {s?.label ?? id}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ContextLine({ context }: { context: AgentContext }) {
  const parts = [
    context.range
      ? `on ${formatTime(context.range.start, true)}–${formatTime(context.range.end, true)}`
      : context.time !== undefined && `at ${formatTime(context.time, true)}`,
    context.point && `pointing ${Math.round(context.point.x * 100)}%, ${Math.round(context.point.y * 100)}%`,
    context.comments?.length && `${context.comments.length} comments`,
    context.selection && `on ${context.selection.id}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <div className="mt-1 font-mono text-[11px] text-muted">{parts.join(" · ")}</div>;
}

function Elapsed({ run }: { run: AgentRun }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (run.status !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [run.status]);
  return <>{took(run.elapsedMs ?? Date.now() - run.at)}</>;
}

function Run({ run }: { run: AgentRun }) {
  const commit = useProject((s) => (run.commitId ? s.commits.find((c) => c.id === run.commitId) : undefined));
  useProject((s) => s.reverted); // re-render chips when something is undone
  const running = run.status === "running";
  return (
    <div className="flex flex-col gap-2.5 animate-rise">
      <div className="flex items-center gap-2 font-mono text-xs text-muted">
        <span className={clsx("size-2 rounded-full bg-accent", running && "animate-pulse")} />
        Agent · <Elapsed run={run} />
        {run.status === "stopped" && <span className="text-faint">· stopped</span>}
      </div>
      {(run.work.length > 0 || running) && <Work run={run} />}
      {!running && run.text && (
        <div className="group/reply flex flex-col gap-1">
          <Markdown text={run.text} className="text-[13px] leading-[1.5] text-fg" />
          <StuckOn run={run} />
          <CopyButton text={run.text} />
        </div>
      )}
      {run.error && (
        <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-fg-2">
          {run.error}
        </p>
      )}
      {run.kept && run.runId && <KeptRow runId={run.runId} count={run.kept} />}
      {(run.status === "error" || run.status === "stopped") && <RetryRow run={run} />}
      {commit && commit.groups.length > 0 && (
        <div className="group/changes flex flex-wrap items-center gap-1.5">
          {commit.groups.map((g, i) => (
            <ChangeChip
              key={i}
              label={g.label}
              undone={isReverted(commit.id, i)}
              onUndo={() => revert(commit.id, i)}
            />
          ))}
          <RestoreButton commitId={commit.id} label="Restore to here" />
        </div>
      )}
    </div>
  );
}

/** Whether anything was changed after a commit (so going back to it would change something). */
function useChangedSince(commitId: string): boolean {
  return useProject((s) => {
    const i = s.commits.findIndex((c) => c.id === commitId);
    // A restore back to this very point isn't a change since it.
    return (
      i >= 0 && s.commits.slice(i + 1).some((c) => c.author !== "index" && restoredTo.get(c.id) !== commitId)
    );
  });
}

/** Restore commits, to the point each one restored: the button hides once that's where the edit is. */
const restoredTo = new Map<string, string>();

/**
 * Puts the whole edit back the way it was right after a request (or a run of hand edits): one commit,
 * so ⌘Z takes it back. Shows on hover, like Copy, once something has changed since.
 */
function RestoreButton({ commitId, label }: { commitId: string; label: string }) {
  const changed = useChangedSince(commitId);
  const [busy, setBusy] = useState(false);
  if (!changed) return null;
  return (
    <button
      type="button"
      disabled={busy}
      title="Put the edit back the way it was at this point. You can undo it."
      onClick={() => {
        setBusy(true);
        void host.history
          .restore(commitId)
          .then((r) => {
            if (!r.ok) return toast(r.error, "warn");
            restoredTo.set(r.commit.id, commitId);
            receive(r.commit);
            toast(`Restored. ${mod}Z puts it back.`);
          })
          .finally(() => setBusy(false));
      }}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-faint opacity-0 group-hover/changes:opacity-100 hover:bg-button hover:text-fg-2 focus-visible:opacity-100 disabled:opacity-50"
    >
      <ClockCounterClockwiseIcon size={12} />
      {label}
    </button>
  );
}

/**
 * The user's own edits between one chat item and the next (trims, drags, splits): one quiet
 * line, so the conversation is the whole history and any point of it can be restored.
 */
function HandEdits({ after, next }: { after: ChatItem; next: ChatItem | undefined }) {
  const commits = useProject((s) => s.commits);
  const notes = useChat((s) => s.items);
  const own = after.kind === "agent" ? after.commitId : after.kind === "note" ? after.commitId : null;
  // From the item's start: edits made while Claude was working belong here too.
  const from = after.at;
  const to = next?.at ?? Number.POSITIVE_INFINITY;
  const noted = new Set(notes.flatMap((n) => (n.kind === "note" ? [n.commitId] : [])));
  const edits = commits.filter(
    (c) => c.author === "user" && c.at > from && c.at < to && c.id !== own && !noted.has(c.id),
  );
  if (!edits.length) return null;
  // Restore to whichever came last, the edits or the reply's own change, so restoring here never
  // drops the reply.
  const ownCommit = own ? commits.find((c) => c.id === own) : undefined;
  const last = ownCommit && ownCommit.at > edits.at(-1)!.at ? ownCommit : edits.at(-1)!;
  return (
    <div className="group/changes flex items-center gap-2 border-y border-dashed border-line py-1.5 text-[12px] text-faint">
      <PencilSimpleIcon size={12} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={edits.map((c) => c.message).join("\n")}>
        You · {edits.length === 1 ? edits[0]!.message : `${edits.length} edits`}
      </span>
      <RestoreButton commitId={last.id} label="Restore" />
    </div>
  );
}

/**
 * A request that stopped partway with changes made: they're on the stage as a draft; keep them as one
 * undoable change, or throw them away.
 */
function KeptRow({ runId, count }: { runId: string; count: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2.5 animate-fade-in">
      <span className="text-[13px] text-fg-2">
        It made {count === 1 ? "a change" : `${count} changes`} before it stopped. They're on the preview as a
        draft.
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void keepWork(runId).finally(() => setBusy(false));
          }}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
        >
          Keep {count === 1 ? "it" : "them"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => discardWork(runId)}
          className="rounded-lg border border-line-strong bg-button px-2.5 py-1 text-xs text-fg-2 hover:bg-chip disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * Under a failed or stopped request: try it again, and when it failed for want of a key or a sign-in
 * (which a retry won't fix), the way to Settings.
 */
function RetryRow({ run }: { run: AgentRun }) {
  const busy = useChat((s) => s.activeRun !== null);
  const signIn = /sign in|api.?key|subscription|authentication|isn't installed/i.test(run.error ?? "");
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => retry(run.id)}
        className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-button px-2.5 py-1 text-xs text-fg-2 hover:bg-chip disabled:opacity-40"
      >
        <ArrowCounterClockwiseIcon size={12} /> Retry
      </button>
      {signIn && (
        <button
          type="button"
          onClick={() => setUi({ dialog: "settings" })}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
        >
          <GearSixIcon size={12} /> Open Settings
        </button>
      )}
    </div>
  );
}

/** Copies a reply as its Markdown; shows when the reply is hovered, like Claude's apps. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy reply"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          },
          () => toast(`Couldn't copy. Select the text and press ${mod}C instead.`, "warn"),
        );
      }}
      className="flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-[11px] text-faint opacity-0 group-hover/reply:opacity-100 hover:bg-button hover:text-fg-2 focus-visible:opacity-100"
    >
      {done ? <CheckIcon size={12} className="text-ok" /> : <CopyIcon size={12} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The work behind a reply, like a terminal's fold: open while the agent works (its narration, each
 * tool call, each change), folded to one line once the reply is in. Each tool call opens to show what
 * went in and what came back.
 */
function Work({ run }: { run: AgentRun }) {
  const running = run.status === "running";
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? running;
  const tools = run.work.filter((w) => w.kind === "tool").length;
  const changes = run.work.filter((w) => w.kind === "step").length;
  const summary = [
    tools && `${tools} ${tools === 1 ? "action" : "actions"}`,
    changes && `${changes} ${changes === 1 ? "step" : "steps"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen(!shown)}
        className="flex items-center gap-1.5 self-start rounded text-left text-xs text-muted hover:text-fg-2"
      >
        <CaretRightIcon size={13} className={clsx("shrink-0 transition-transform", shown && "rotate-90")} />
        {running ? (
          <span className="animate-pulse">{run.activity ?? "Reading the project…"}</span>
        ) : (
          <span>
            Worked for {took(run.elapsedMs ?? 0)}
            {summary && ` · ${summary}`}
          </span>
        )}
      </button>
      {shown && (
        <div className="ml-[6px] flex flex-col gap-1.5 border-l border-line pl-3 text-[13px] leading-[1.4] text-fg-2">
          {run.work.map((w, i) => (
            <WorkLine
              key={w.kind === "tool" ? w.id : i}
              entry={w}
              live={running && i === run.work.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkLine({ entry, live }: { entry: WorkEntry; live: boolean }) {
  const [open, setOpen] = useState(false);
  switch (entry.kind) {
    case "text":
      return <Markdown text={entry.text} className="text-[12.5px] leading-[1.5] text-muted" />;
    case "thinking":
      return <Thinking text={entry.text} live={live} />;
    case "step":
      return (
        <div className="flex gap-2 animate-fade-in">
          {entry.status === "done" ? (
            <CheckIcon size={15} className="mt-0.5 shrink-0 text-ok" />
          ) : (
            <WarningIcon size={15} className="mt-0.5 shrink-0 text-accent" />
          )}
          <span>{entry.text}</span>
        </div>
      );
    case "tool":
      return (
        <div className="flex flex-col animate-fade-in">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="group flex items-center gap-2 rounded py-0.5 text-left hover:text-fg"
          >
            {entry.status === "running" ? (
              <CircleNotchIcon size={13} className="shrink-0 animate-spin text-muted" />
            ) : entry.status === "error" ? (
              <XIcon size={13} className="shrink-0 text-bad" />
            ) : (
              <CaretRightIcon
                size={13}
                className={clsx("shrink-0 text-faint transition-transform", open && "rotate-90")}
              />
            )}
            <span className="min-w-0 truncate">{entry.label}</span>
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">
              {entry.name}
              {entry.ms !== undefined &&
                ` · ${entry.ms < 1000 ? `${entry.ms}ms` : `${(entry.ms / 1000).toFixed(1)}s`}`}
            </span>
          </button>
          {entry.image && <Seen image={entry.image} />}
          {open && (
            <div className="mt-1 mb-1.5 flex flex-col gap-1.5">
              <Block title="Input" text={entry.input} />
              {entry.output !== undefined && <Block title="Output" text={entry.output} />}
            </div>
          )}
        </div>
      );
  }
}

/** A picture the agent looked at (a frame strip at a cut): click for full size. */
function Seen({ image, caption }: { image: string; caption?: string }) {
  const [big, setBig] = useState(false);
  return (
    <figure className="my-1 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setBig(!big)}
        aria-label={big ? "Make the picture smaller" : "Make the picture bigger"}
        className="self-start overflow-hidden rounded-md border border-line bg-black"
      >
        <img
          src={`${MEDIA_BASE}${encodeURIComponent(image)}`}
          alt="Frames the agent looked at"
          className={clsx(
            "block w-auto object-contain",
            big ? "max-h-[420px] max-w-full" : "max-h-24 max-w-full",
          )}
        />
      </button>
      {caption && <figcaption className="text-[11px] text-muted">{caption}</figcaption>}
    </figure>
  );
}

/** When the agent stopped going round on something, the last frames it saw, under its question. */
function StuckOn({ run }: { run: AgentRun }) {
  const tools = run.work.filter((w) => w.kind === "tool");
  if (!tools.some((t) => t.stuck)) return null;
  const last = tools.findLast((t) => t.image);
  return last?.image ? (
    <Seen image={last.image} caption="The last frames it checked, either side of the cut (red line)" />
  ) : null;
}

/**
 * A stretch of the model's thinking (summarized), like Claude's apps: streams open while it thinks,
 * then folds to its first line.
 */
function Thinking({ text, live }: { text: string; live: boolean }) {
  // Open while it streams and folded once it's done, unless toggled: then it stays as it was put.
  const [open, setOpen] = useState<boolean | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const shown = open ?? live;
  // While it streams, keep the newest words in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls again as each new word of text arrives
  useEffect(() => {
    if (live && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, live, shown]);
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.replace(/^[#*_\s]+|[*_]+$/g, "").trim())
    .filter(Boolean);
  // Folded: its first line once it's done, the line it's on while it's still thinking.
  const peek = live ? lines.at(-1) : lines[0];
  return (
    <div className="flex flex-col animate-fade-in">
      <button
        type="button"
        aria-expanded={shown}
        aria-label={shown ? "Hide thinking" : "Show thinking"}
        onClick={() => setOpen(!shown)}
        className="group flex min-w-0 items-center gap-1.5 rounded py-0.5 text-left text-muted hover:text-fg-2"
      >
        <LightbulbIcon
          size={13}
          className={clsx("mr-0.5 shrink-0", live ? "animate-pulse text-accent" : "text-faint")}
        />
        <span className={clsx("shrink-0", live && "animate-pulse")}>{live ? "Thinking…" : "Thought"}</span>
        <CaretRightIcon
          size={13}
          className={clsx(
            "shrink-0 text-faint transition-transform group-hover:text-fg-2",
            shown && "rotate-90",
          )}
        />
        {!shown && peek && <span className="min-w-0 truncate text-faint">{peek}</span>}
      </button>
      {shown && (
        <div
          ref={body}
          className={clsx(
            "mt-0.5 mb-1 overflow-y-auto pl-[21px]",
            live ? "max-h-28 [mask-image:linear-gradient(to_bottom,transparent,black_28px)]" : "max-h-72",
          )}
        >
          <Markdown text={text} className="text-[12px] leading-[1.55] text-muted italic" />
        </div>
      )}
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-bg">
      <div className="border-b border-line px-2 py-1 font-mono text-[10px] tracking-wide text-faint uppercase">
        {title}
      </div>
      <pre className="max-h-56 overflow-auto px-2 py-1.5 font-mono text-[11px] leading-[1.45] whitespace-pre-wrap break-words text-fg-2">
        {text}
      </pre>
    </div>
  );
}

function Note({ commitId, imported }: { commitId: string; imported?: ChangeNote["import"] }) {
  const commit = useProject((s) => s.commits.find((c) => c.id === commitId));
  useProject((s) => s.reverted);
  if (!commit) return null;
  return (
    <div className="flex flex-col gap-2 animate-rise">
      <div className="font-mono text-xs text-muted">
        {commit.author === "file"
          ? "Edited outside the app"
          : commit.ops.some((o) => o.op === "insert" && o.coll === "sources")
            ? "Imported"
            : "Changed"}
      </div>
      <div className="text-[13px] text-fg-2">{commit.message}</div>
      <div className="group/changes flex flex-wrap items-center gap-1.5">
        {commit.groups.map((g, i) => (
          <ChangeChip
            key={i}
            label={g.label}
            undone={isReverted(commit.id, i)}
            onUndo={() => revert(commit.id, i)}
          />
        ))}
        <RestoreButton commitId={commit.id} label="Restore to here" />
      </div>
      {imported && <ImportStatus imported={imported} />}
    </div>
  );
}

/**
 * Under an import: clips indexing in the background, then ready. Into an empty project it carries the
 * first-cut switch (Auto cuts as soon as the clips are ready, Manual waits) and, in manual, places to start.
 */
function ImportStatus({ imported }: { imported: NonNullable<ChangeNote["import"]> }) {
  const auto = useChat((s) => s.autoFirstCut);
  const busy = useChat((s) => s.activeRun !== null);
  // Plain numbers and strings out of the stores, so a re-render only happens when they change.
  const pct = useJobs((s) => {
    const f = imported.sources.map((id) => s.indexing[id]?.fraction ?? (imported.ready ? 1 : 0));
    return Math.round((f.reduce((a, b) => a + b, 0) / Math.max(1, f.length)) * 100);
  });
  const seconds = useDoc((d) =>
    d.sources.filter((x) => imported.sources.includes(x.id)).reduce((a, x) => a + x.duration, 0),
  );
  const speech = useDoc((d) => d.sources.some((x) => imported.sources.includes(x.id) && x.speech));
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised/50 px-3 py-2.5 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <span className={clsx("text-fg-2", !imported.ready && "animate-pulse")}>
          {imported.ready
            ? `Ready: ${formatTime(seconds)}${speech ? ", transcribed" : ""}`
            : `Indexing in the background · ${pct}%`}
        </span>
        {imported.first && (
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            First cut
            <div className="flex rounded-md bg-control p-0.5">
              {(["Auto", "Manual"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={(mode === "Auto") === auto}
                  onClick={() => void setAutoFirstCut(mode === "Auto")}
                  title={
                    mode === "Auto"
                      ? "Cut automatically as soon as the clips are ready"
                      : "Wait for you to say what you want"
                  }
                  className={clsx(
                    "rounded px-2 py-0.5",
                    (mode === "Auto") === auto ? "bg-selected text-fg" : "text-muted hover:text-fg-2",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {imported.first && imported.ready && !auto && (
        <div className="flex flex-wrap gap-1.5">
          {STARTERS.map((st) => (
            <button
              key={st.label}
              type="button"
              disabled={busy}
              onClick={() => void send(st.prompt || firstCutPrompt(), {}, st.thorough ? "thorough" : "quick")}
              className="rounded-full border border-line-strong bg-button px-2.5 py-1 text-xs text-fg-2 hover:bg-chip disabled:opacity-40"
            >
              {st.label}
            </button>
          ))}
        </div>
      )}
      {imported.first && !imported.ready && !auto && (
        <span className="text-xs text-muted">The agent will wait for you. Type what you want any time.</span>
      )}
    </div>
  );
}

/** What's typed and not sent yet, per project: switching away and back finds it as it was left. */
const drafts = new Map<string, string>();

function Composer({ dir }: { dir: string | null }) {
  const [text, setText] = useState(() => (dir && drafts.get(dir)) || "");
  useEffect(() => {
    if (!dir) return;
    if (text) drafts.set(dir, text);
    else drafts.delete(dir);
  }, [dir, text]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Previews of what was attached but not sent go with the project's composer.
  const held = useRef(attachments);
  held.current = attachments;
  useEffect(
    () => () => {
      for (const a of held.current) if (a.preview) URL.revokeObjectURL(a.preview);
    },
    [],
  );
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = attachments.some((a) => a.status === "uploading");
  const activeRun = useChat((s) => s.activeRun);
  const pointer = useUi((s) => s.pointer);
  const pointing = useUi((s) => s.pointing);
  const range = useTimeline((s) => s.range);
  const fileDrag = useUi((s) => s.fileDrag);
  const ref = useRef<HTMLTextAreaElement>(null);
  // The reply's suggested next request, offered while the box is empty (or holds its beginning).
  const suggestion = useSuggestion();
  const offer =
    suggestion &&
    !activeRun &&
    !pointer &&
    !attachments.length &&
    suggestion.toLowerCase().startsWith(text.toLowerCase())
      ? suggestion
      : null;

  const selected = useUi((s) => (s.selection ? s.selection.id : null));

  // ↑ in an empty box brings back what was sent before (again for older ones), ↓ comes back down, to
  // what was being typed.
  const sent = useChat((s) => s.items);
  const recall = useRef<{ at: number; draft: string } | null>(null);
  const browse = (step: 1 | -1): boolean => {
    const list = sentRequests(sent);
    const at = (recall.current?.at ?? -1) + step;
    if (at >= list.length) return false;
    if (at < 0) {
      setText(recall.current?.draft ?? "");
      recall.current = null;
      return true;
    }
    recall.current = { at, draft: recall.current?.draft ?? text };
    setText(list[at]!);
    return true;
  };

  // Tab takes the suggestion even when the box doesn't have focus (after a click on the video, the
  // timeline or the reply), unless focus is on a control being tabbed through or a field being typed in.
  const offered = useRef(offer);
  offered.current = text === offer ? null : offer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const take = offered.current;
      const el = document.activeElement;
      if (!take || el === ref.current || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (
        el instanceof HTMLElement &&
        el !== document.body &&
        el.matches(
          'button, a[href], input, textarea, select, [contenteditable="true"], [role="menuitem"], [role="tab"]',
        )
      )
        return;
      e.preventDefault();
      setText(take);
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    composerRef.current = ref.current;
    return () => {
      composerRef.current = null;
    };
  }, []);

  const placeholder = dropping
    ? "Drop to attach it to your message"
    : pointer
      ? "What should happen here?"
      : range
        ? range.end - range.start < 0.05
          ? "What about this frame?"
          : "What should happen in this stretch?"
        : selected
          ? `What should change about ${selected}?`
          : attachments.length
            ? "Where should it go? e.g. after scene one"
            : (offer ?? "Tell it what to change, or point at the video");

  // Grow with the text, up to a limit; while it's empty, with the placeholder (a suggestion can run to
  // two lines, and would spill over what's below).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!text) el.value = placeholder;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    if (!text) el.value = "";
  }, [text, placeholder]);

  /** Adds files to the message: each one goes into the project's library straight away. */
  const attach = (files: readonly File[]) => {
    const fresh = files.slice(0, 10 - attachments.length).map((file) => ({ file, a: pending(file) }));
    if (!fresh.length) return;
    if (fresh.length < files.length) toast("Up to 10 attachments per message.", "warn");
    setAttachments((list) => [...list, ...fresh.map((f) => f.a)]);
    const uploads = fresh.map(({ file, a }) =>
      upload(file, a.name).then((r) => {
        setAttachments((list) =>
          list.map((x) =>
            x.key !== a.key
              ? x
              : "source" in r
                ? { ...x, status: "ready", source: r.source }
                : { ...x, status: "failed", error: r.error },
          ),
        );
        return "source" in r ? r.source : null;
      }),
    );
    // Songs, sounds and memes attached to a message: offer to keep them for other projects (once).
    void Promise.all(uploads).then((ids) => offerToKeep(ids.filter((id) => id !== null)));
  };
  const detach = (key: string) =>
    setAttachments((list) => {
      const gone = list.find((a) => a.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((a) => a.key !== key);
    });

  const ready = attachments.filter((a) => a.status === "ready").map((a) => a.source!);
  // While the agent works, a message joins the queue instead (it goes when this request is done).
  const canSend = (text.trim().length > 0 || ready.length > 0) && !uploading;

  const submit = () => {
    if (!canSend) return;
    const base: AgentContext = pointer
      ? { time: pointer.time, point: pointer.point }
      : { time: currentTime() };
    const context: AgentContext = { ...base, ...(range && { range }), ...selectionContext() };
    void send(text.trim() || "Use what I attached where it fits best.", context, "quick", ready);
    setText("");
    for (const a of attachments) if (a.preview) URL.revokeObjectURL(a.preview);
    setAttachments([]);
    setUi({ pointer: null, pointing: false });
    setRange(null);
  };

  return (
    <div className="px-[18px] pt-2.5 pb-[18px]">
      <Queue />
      {/* Files dropped here attach to the message instead of joining the cut (the window's drop). */}
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          e.stopPropagation();
          setDropping(false);
          window.dispatchEvent(new Event("vedit:drop-handled"));
          attach([...e.dataTransfer.files]);
        }}
        className={clsx(
          "relative rounded-[14px] border bg-raised p-3 focus-within:border-edge",
          // While files are dragged, above the window's drop overlay: the other place to drop them.
          fileDrag && "z-[60]",
          dropping ? "border-accent bg-[#2a2418]" : "border-[#33333b]",
        )}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip key={a.key} a={a} onRemove={() => detach(a.key)} />
            ))}
          </div>
        )}
        {range && (
          <div className="mr-1.5 mb-2 inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 py-0.5 pr-1 pl-2 font-mono text-[11px] text-fg animate-fade-in">
            <BracketsSquareIcon size={12} className="text-accent" />
            {range.end - range.start < 0.05
              ? `Frame ${formatTime(range.start, true)}`
              : `${formatTime(range.start, true)}–${formatTime(range.end, true)}`}
            <button
              type="button"
              aria-label="Clear the selected stretch"
              onClick={() => setRange(null)}
              className="rounded p-0.5 text-muted hover:text-fg"
            >
              <XIcon size={12} />
            </button>
          </div>
        )}
        {selected && (
          <div className="mr-1.5 mb-2 inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 py-0.5 pr-1 pl-2 font-mono text-[11px] text-fg animate-fade-in">
            <CursorClickIcon size={12} className="text-accent" />
            {selected}
            <button
              type="button"
              aria-label={`Deselect ${selected}`}
              onClick={() => select(null)}
              className="rounded p-0.5 text-muted hover:text-fg"
            >
              <XIcon size={12} />
            </button>
          </div>
        )}
        {pointer && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 py-0.5 pr-1 pl-2 font-mono text-[11px] text-fg animate-fade-in">
            <CrosshairIcon size={12} className="text-accent" />
            {formatTime(pointer.time, true)} · {Math.round(pointer.point.x * 100)}%,{" "}
            {Math.round(pointer.point.y * 100)}%
            <button
              type="button"
              aria-label="Clear point"
              onClick={() => setUi({ pointer: null })}
              className="rounded p-0.5 text-muted hover:text-fg"
            >
              <XIcon size={12} />
            </button>
          </div>
        )}
        <label htmlFor="composer" className="sr-only">
          Tell the agent what to change
        </label>
        <div className="relative">
          {/* The rest of the suggestion, faint, after what's typed: Tab finishes it. */}
          {offer && text && text !== offer && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 pb-3 text-sm leading-[1.45] break-words whitespace-pre-wrap text-faint"
            >
              <span className="invisible">{text}</span>
              {offer.slice(text.length)}
            </div>
          )}
          <textarea
            id="composer"
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => {
              recall.current = null;
              setText(e.target.value);
            }}
            onPaste={(e) => {
              // A pasted screenshot (or copied file) attaches; pasted text stays text.
              const files = [...e.clipboardData.files];
              if (!files.length) return;
              e.preventDefault();
              attach(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && !e.shiftKey && offer && text !== offer) {
                e.preventDefault();
                setText(offer);
                return;
              }
              // ↑ at the start of an empty box (or one showing an earlier request), ↓ back down.
              const browsing = recall.current !== null;
              if (
                (e.key === "ArrowUp" || (e.key === "ArrowDown" && browsing)) &&
                !e.shiftKey &&
                !e.altKey &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.nativeEvent.isComposing &&
                (text === "" || browsing) &&
                browse(e.key === "ArrowUp" ? 1 : -1)
              ) {
                e.preventDefault();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            placeholder={placeholder}
            className="relative block w-full resize-none bg-transparent pb-3 text-sm leading-[1.45] text-fg outline-none placeholder:text-faint"
          />
        </div>
        {/* A narrow column drops words before anything wraps: Point, the effort, the usage's window and the
            Tab hint keep just their icon, figure and key. The right side never gives way, so nothing slides
            under it. */}
        <div className="@container flex items-center justify-between gap-2">
          <div className="flex min-w-0 gap-1.5">
            <button
              type="button"
              aria-label="Attach images or clips"
              title="Attach images, screenshots or clips (or drop / paste them here)"
              onClick={() => picker.current?.click()}
              className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-control text-fg-2 hover:bg-selected"
            >
              <PaperclipIcon size={14} />
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className="hidden"
              onChange={(e) => {
                attach([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-pressed={pointing}
              aria-label="Point"
              title="Point at the video"
              onClick={() => setUi((s) => ({ pointing: !s.pointing }))}
              className={clsx(
                "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs",
                pointing ? "bg-accent/15 text-accent" : "bg-control text-fg-2 hover:bg-selected",
              )}
            >
              <CrosshairIcon size={13} weight={pointing ? "fill" : "regular"} />
              <span className="hidden @[400px]:inline">Point</span>
            </button>
            <ThinkingPicker />
            <InspirationChip />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <UsageMeter />
            {/* Beside Send, so it never sits under a suggestion that runs to two lines. */}
            {offer && text !== offer && (
              <span
                title={text ? "Tab to finish the suggestion" : "Tab to use the suggestion"}
                className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-faint animate-fade-in"
              >
                <kbd className="rounded border border-line-strong px-1 font-mono text-[10px] text-muted">
                  Tab
                </kbd>
                <span className="hidden @[440px]:inline">{text ? "to finish" : "to use"}</span>
              </span>
            )}
            {activeRun ? (
              <>
                {canSend && (
                  <button
                    type="button"
                    aria-label="Queue it"
                    title="Queue it: it's sent when this request is done (Enter)"
                    onClick={submit}
                    className="flex size-9 items-center justify-center rounded-full bg-control text-fg-2 hover:bg-selected animate-fade-in"
                  >
                    <ListPlusIcon size={16} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Stop"
                  onClick={stop}
                  className="flex size-9 items-center justify-center rounded-full bg-fg text-bg hover:bg-fg-2"
                >
                  <StopIcon size={12} weight="fill" />
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label="Send"
                onClick={submit}
                disabled={!canSend}
                title={uploading ? "Adding your attachments…" : undefined}
                className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-40"
              >
                <ArrowUpIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Messages written while the agent was busy, above the box: each goes when the one before it is done,
 * and can be taken back. After a stop or an error the queue waits, with a button to carry on.
 */
function Queue() {
  const queue = useChat((s) => s.queue);
  const busy = useChat((s) => s.activeRun !== null);
  if (!queue.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-1 animate-fade-in">
      <div className="flex items-center justify-between px-1 text-[11px] text-faint">
        <span>
          {queue.length === 1 ? "1 message" : `${queue.length} messages`}{" "}
          {busy ? "waiting for this request to finish" : "waiting"}
        </span>
        {!busy && (
          <button
            type="button"
            onClick={() => sendNextQueued()}
            className="rounded-md px-1.5 py-0.5 text-accent hover:bg-button"
          >
            Send next
          </button>
        )}
      </div>
      {queue.map((q, i) => (
        <div
          key={q.id}
          className="flex items-center gap-2 rounded-lg border border-line bg-panel py-1.5 pr-1.5 pl-3 text-[13px] text-fg-2"
        >
          <span className="shrink-0 font-mono text-[11px] text-faint">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">{q.text}</span>
          {q.attachments.length > 0 && (
            <span className="shrink-0 text-[11px] text-faint">+{q.attachments.length}</span>
          )}
          <button
            type="button"
            aria-label="Remove from the queue"
            onClick={() => removeQueued(q.id)}
            className="shrink-0 rounded-md p-1 text-faint hover:bg-button hover:text-fg-2"
          >
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  return (
    <div
      title={a.error ?? a.name}
      className={clsx(
        "relative flex h-14 items-center overflow-hidden rounded-lg border bg-bg animate-fade-in",
        a.status === "failed" ? "border-bad/60" : "border-line-strong",
      )}
    >
      {a.kind === "image" && a.preview ? (
        <img src={a.preview} alt={a.name} className="h-full w-auto max-w-[96px] object-cover" />
      ) : a.kind === "video" && a.preview ? (
        <video src={`${a.preview}#t=0.5`} muted preload="metadata" className="h-full w-auto max-w-[96px]" />
      ) : (
        <span className="flex max-w-[140px] items-center gap-1.5 px-2.5 text-xs text-fg-2">
          {a.kind === "audio" ? <MusicNotesIcon size={13} /> : <FilmStripIcon size={13} />}
          <span className="truncate">{a.name}</span>
        </span>
      )}
      {a.status === "uploading" && (
        <span className="absolute inset-0 flex items-center justify-center bg-bg/60">
          <CircleNotchIcon size={16} className="animate-spin text-fg" />
        </span>
      )}
      {a.status === "failed" && (
        <span className="absolute inset-x-0 bottom-0 bg-bad/80 px-1 text-center text-[9px] text-white">
          failed
        </span>
      )}
      <button
        type="button"
        aria-label={`Remove ${a.name}`}
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 rounded-full bg-black/70 p-0.5 text-white hover:bg-black"
      >
        <XIcon size={10} />
      </button>
    </div>
  );
}

/** The editing style the video follows, one click from the library: its name when there's room. */
function InspirationChip() {
  const active = useDoc((d) => activeInspiration(d));
  const name = active ? (inspirationMeta(active.md)?.name ?? active.id) : null;
  return (
    <button
      type="button"
      title={name ? `Edits follow the ${name} inspiration` : "Edit it like a style you love"}
      onClick={() => setUi({ view: "inspirations" })}
      aria-label={name ? `Inspiration: ${name}` : "Inspirations"}
      className={clsx(
        "inline-flex h-[30px] min-w-[30px] shrink items-center justify-center gap-1.5 rounded-lg px-2 text-xs",
        name ? "bg-accent/12 text-accent" : "bg-control text-fg-2 hover:bg-selected",
      )}
    >
      <SparkleIcon size={13} weight={name ? "fill" : "regular"} className="shrink-0" />
      {/* The name only when the bar has room for it. */}
      {name && <span className="hidden max-w-[120px] truncate @[420px]:inline">{name}</span>}
    </button>
  );
}
