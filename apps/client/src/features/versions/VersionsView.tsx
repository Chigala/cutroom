/**
 * Versions side by side. Each one is a whole alternative edit, playing next to the others. Use one, or
 * mix: take the cut from one, the hook from another, the music from a third. Under the hood every one of
 * those is a diff applied as a single undoable commit.
 */

import {
  ArrowLeftIcon,
  CircleNotchIcon,
  RobotIcon,
  SparkleIcon,
  TrashIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Player } from "@remotion/player";
import type { HistoryEntry, VersionInfo } from "@vedit/bridge";
import { compositionMeta, VideoComposition } from "@vedit/composition";
import { type Collection, diffDocs, formatTime, type ProjectDoc, type Singleton } from "@vedit/project";
import { clsx } from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { host, MEDIA_BASE } from "../../lib/host.ts";
import { AUDIO_TAGS } from "../../lib/player.ts";
import { edit, receive, useProject } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { setUi } from "../../state/ui.ts";

const PARTS: { label: string; sections: readonly (Collection | Singleton)[] }[] = [
  { label: "Cut", sections: ["scenes"] },
  { label: "Hook", sections: ["titles"] },
  { label: "Captions", sections: ["captionStyle", "wordEdits", "captions"] },
  { label: "Music", sections: ["music", "sfx"] },
  { label: "Zooms", sections: ["zooms"] },
  { label: "Look", sections: ["look"] },
];

const ALL: readonly (Collection | Singleton)[] = [
  "meta",
  "style",
  "sources",
  "transcripts",
  "analyses",
  "scenes",
  "zooms",
  "captions",
  "wordEdits",
  "titles",
  "sfx",
  "comments",
  "captionStyle",
  "music",
  "look",
];

/** Starting points for the prompt: what to vary between the versions. */
const IDEAS = [
  "Three editing styles: pick the inspirations that fit this video best, one each",
  "Different vibes: punchy, calm, cinematic",
  "Three different hooks",
  "Same cut, different music",
  "A 30s, a 45s and a 60s cut",
];

export function VersionsView() {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [docs, setDocs] = useState<Record<string, ProjectDoc>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(3);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const name = useProject((s) => s.doc?.meta.name ?? "");

  const refresh = useCallback(async () => {
    const list = await host.versions.list();
    setVersions(list);
    const loaded = await Promise.all(
      list.slice(0, 6).map(async (v) => [v.id, await host.versions.doc(v.id)] as const),
    );
    setDocs(Object.fromEntries(loaded.filter((e): e is readonly [string, ProjectDoc] => e[1] !== null)));
    setHistory(await host.history.list());
  }, []);

  useEffect(() => {
    void refresh();
    return host.on("versions", (e) => {
      if (e.type === "changed" || e.type === "generated") void refresh();
      if (e.type === "generating") setProgress({ label: e.label, done: e.done, total: e.total });
      if (e.type === "generated") setProgress(null);
      if (e.type === "error") {
        setProgress(null);
        toast(e.message, "warn");
      }
    });
  }, [refresh]);

  const generate = async () => {
    setProgress({ label: "Starting", done: 0, total: count });
    await host.versions.generate(prompt.trim() || IDEAS[0]!, count);
  };

  const use = async (v: VersionInfo) => {
    const result = await host.versions.use(v.id);
    if (!result.ok) return toast(result.error, "warn");
    receive(result.commit);
    toast(`Now editing ${v.name}`);
  };

  const take = (v: VersionInfo, part: (typeof PARTS)[number]) => {
    const current = useProject.getState().doc;
    const other = docs[v.id];
    if (!current || !other) return;
    const ops = diffDocs(
      current,
      other,
      ALL.filter((s) => !part.sections.includes(s)),
    );
    if (!ops.length) return toast(`The ${part.label.toLowerCase()} is already the same.`);
    edit(ops, {
      message: `${part.label} from ${v.name}`,
      groups: [{ label: `${part.label} from ${v.name}`, ops: ops.map((_, i) => i) }],
    });
    toast(`Took the ${part.label.toLowerCase()} from ${v.name}`);
  };

  const restore = async (h: HistoryEntry) => {
    const result = await host.history.restore(h.id);
    if (!result.ok) return toast(result.error, "warn");
    receive(result.commit);
    toast("Restored. Undo brings you back.");
  };

  const save = () =>
    void host.versions
      .save(`Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`)
      .catch((e: Error) => toast(e.message, "warn"));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg animate-fade-in">
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-line pr-4 pl-[84px]">
        <div className="no-drag flex min-w-0 items-center gap-2">
          <Button variant="ghost" onClick={() => setUi({ view: "editor" })} className="-ml-2">
            <ArrowLeftIcon size={15} /> Editor
          </Button>
          <span className="text-faint">/</span>
          <span className="text-[14px] font-semibold">Versions</span>
          <span className="truncate text-[13px] text-muted">· {name}</span>
        </div>
        <Button className="no-drag" onClick={save}>
          Save current edit
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
          <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <div className="flex flex-col gap-1">
              <h1 className="m-0 text-[22px] font-semibold">
                {versions.length
                  ? `${versions.length} ${versions.length === 1 ? "version" : "versions"}`
                  : "Versions"}
              </h1>
              <p className="m-0 text-[13px] text-muted">
                Whole alternative edits, side by side. Use one, or take the cut, hook or music from any of
                them.
              </p>
            </div>

            <section className="flex flex-col gap-3 rounded-2xl border border-line-strong bg-raised p-4">
              <label htmlFor="versions-prompt" className="text-[13px] font-semibold">
                What should differ between them?
              </label>
              <textarea
                id="versions-prompt"
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.shiftKey && !progress) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                placeholder="e.g. one punchy with fast cuts, one calm and slow, one cinematic with music swells"
                className="resize-none bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-faint"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {IDEAS.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => setPrompt(idea)}
                      className="rounded-full border border-line-strong px-2.5 py-1 text-[11.5px] text-fg-3 hover:border-edge hover:text-fg"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <fieldset className="m-0 flex rounded-lg border-0 bg-control p-0.5">
                    <legend className="sr-only">How many versions</legend>
                    {[2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={count === n}
                        onClick={() => setCount(n)}
                        className={clsx(
                          "h-7 w-8 rounded-md text-xs tabular",
                          count === n ? "bg-selected text-fg" : "text-muted hover:text-fg-2",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </fieldset>
                  <Button variant="accent" disabled={progress !== null} onClick={() => void generate()}>
                    {progress ? (
                      <CircleNotchIcon size={14} className="animate-spin" />
                    ) : (
                      <SparkleIcon size={14} />
                    )}
                    {progress ? "Making…" : `Make ${count} versions`}
                  </Button>
                </div>
              </div>
            </section>

            {progress ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
                {Array.from({ length: progress.total }, (_, i) => (
                  <Placeholder
                    key={i}
                    label={i < progress.done ? "Done" : i === progress.done ? progress.label : "Waiting"}
                    busy={i === progress.done}
                  />
                ))}
              </div>
            ) : versions.length === 0 ? (
              <Empty />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
                {versions.slice(0, 6).map((v) => (
                  <VersionCard
                    key={v.id}
                    version={v}
                    doc={docs[v.id]}
                    onUse={() => void use(v)}
                    onTake={(p) => take(v, p)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        <HistoryRail history={history} onRestore={(h) => void restore(h)} />
      </div>
    </div>
  );
}

/** No versions yet: three empty phones, the shape of what's coming. */
function Empty() {
  return (
    <div className="flex flex-col items-center gap-5 py-10">
      <div className="flex items-end gap-4">
        {["A", "B", "C"].map((l, i) => (
          <div
            key={l}
            className={clsx(
              "flex w-[84px] items-center justify-center rounded-[14px] border border-dashed border-line-strong font-mono text-sm text-faint",
              i === 1 ? "h-[150px]" : "h-[132px]",
            )}
          >
            {l}
          </div>
        ))}
      </div>
      <p className="m-0 max-w-[360px] text-center text-[13px] leading-relaxed text-muted">
        No versions yet. Describe what should differ and make a few, or save the current edit to come back to
        it.
      </p>
    </div>
  );
}

function Placeholder({ label, busy }: { label: string; busy: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-4 w-24 rounded bg-raised" />
      <div className="flex aspect-[9/16] items-center justify-center rounded-[18px] border border-dashed border-line-strong bg-raised/40">
        <span className={clsx("flex items-center gap-2 text-xs", busy ? "text-fg-2" : "text-faint")}>
          {busy && <CircleNotchIcon size={14} className="animate-spin text-accent" />}
          {label}
        </span>
      </div>
    </div>
  );
}

/** "Today", "Yesterday", "Mon 29 Sep". */
function dayOf(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/** Every change, newest first, by day: restore any point (one undoable change). */
function HistoryRail({
  history,
  onRestore,
}: {
  history: HistoryEntry[];
  onRestore: (h: HistoryEntry) => void;
}) {
  const days: [string, HistoryEntry[]][] = [];
  for (const h of history) {
    const day = dayOf(h.at);
    const last = days.at(-1);
    if (last?.[0] === day) last[1].push(h);
    else days.push([day, [h]]);
  }
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex flex-col gap-0.5 border-b border-line px-5 py-4">
        <span className="text-[14px] font-semibold">History</span>
        <span className="text-xs text-muted">Restore any point. Undo brings you back.</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
        {days.map(([day, entries]) => (
          <div key={day} className="flex flex-col">
            <div className="sticky top-0 z-10 bg-panel px-3 pt-2 pb-1 font-mono text-[10.5px] tracking-wide text-faint uppercase">
              {day}
            </div>
            {entries.map((h) => {
              const latest = h === history[0];
              const title = h.changes?.length
                ? `${h.changes[0]}${h.changes.length > 1 ? ` +${h.changes.length - 1}` : ""}`
                : (h.message.split(/(?<=[.!?])\s/)[0] ?? h.message);
              return (
                <div
                  key={h.id}
                  title={h.message}
                  className="group flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-raised"
                >
                  {h.author === "agent" ? (
                    <RobotIcon size={14} className="mt-0.5 shrink-0 text-accent" />
                  ) : (
                    <UserIcon size={14} className="mt-0.5 shrink-0 text-muted" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] text-fg-2">{title}</span>
                    <span className="text-[11px] text-faint">
                      {h.author === "agent" ? "Agent" : h.author === "file" ? "File edit" : "You"} ·{" "}
                      {new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  {latest ? (
                    <span className="mt-0.5 shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] text-accent">
                      Now
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRestore(h)}
                      className="mt-0.5 shrink-0 rounded-md bg-control px-2 py-0.5 text-[11px] text-fg-2 opacity-0 group-hover:opacity-100 hover:bg-selected focus-visible:opacity-100"
                    >
                      Restore
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {!history.length && <span className="px-3 py-2 text-xs text-faint">No changes yet.</span>}
      </div>
    </aside>
  );
}

function VersionCard({
  version,
  doc,
  onUse,
  onTake,
}: {
  version: VersionInfo;
  doc: ProjectDoc | undefined;
  onUse: () => void;
  onTake: (part: (typeof PARTS)[number]) => void;
}) {
  const meta = doc ? compositionMeta(doc) : null;
  const props = useMemo(() => (doc ? { doc, mediaBase: MEDIA_BASE } : null), [doc]);
  return (
    <div className="group flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-semibold">{version.name}</span>
          <span className="font-mono text-[11px] text-muted">
            {formatTime(version.duration, true)} · {version.scenes} shots ·{" "}
            {new Date(version.createdAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        <button
          type="button"
          aria-label={`Delete ${version.name}`}
          title="Delete version"
          onClick={() => void host.versions.remove(version.id)}
          className="rounded-md p-1.5 text-faint opacity-0 group-hover:opacity-100 hover:bg-button hover:text-bad focus-visible:opacity-100"
        >
          <TrashIcon size={14} />
        </button>
      </div>
      <div
        className="overflow-hidden rounded-[18px] bg-black shadow-[0_0_0_1px_var(--color-line-strong)]"
        style={{ aspectRatio: meta ? `${meta.width}/${meta.height}` : "9/16" }}
      >
        {props && meta && (
          <Player
            acknowledgeRemotionLicense
            component={VideoComposition}
            numberOfSharedAudioTags={AUDIO_TAGS}
            inputProps={props}
            durationInFrames={meta.durationInFrames}
            compositionWidth={meta.width}
            compositionHeight={meta.height}
            fps={meta.fps}
            style={{ width: "100%", height: "100%" }}
            controls
            loop
            clickToPlay
          />
        )}
      </div>
      {version.note && <p className="m-0 line-clamp-2 text-xs leading-relaxed text-fg-3">{version.note}</p>}
      <Button variant="accent" className="w-full justify-center" onClick={onUse}>
        Use this version
      </Button>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-faint">Take its</span>
        {PARTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onTake(p)}
            title={`Take the ${p.label.toLowerCase()} from ${version.name}, keep the rest`}
            className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-fg-3 hover:border-edge hover:text-fg"
          >
            {p.label.toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
