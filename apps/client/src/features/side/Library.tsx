/**
 * The asset library: the user's own sounds, music and memes, shared by every project, and this
 * project's assets/ folder. Drop files here (or Add files…) to keep them; the editor catalogues them
 * (what a sound is, a track's tempo, what a meme shows) and the agent searches here before the web.
 * + puts one at the playhead; a click opens its name, notes, tags and roles.
 */

import {
  BookmarkSimpleIcon,
  CheckIcon,
  CircleNotchIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type AssetEntry, keepable, type Source } from "@vedit/project";
import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { host, MEDIA_BASE } from "../../lib/host.ts";
import { assetUrl, followLibrary, keepInLibrary, useLibrary } from "../../state/library.ts";
import { currentTime } from "../../state/playback.ts";
import { receive, useDoc, useProject } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";

type Scope = "library" | "project";
type Kind = "all" | "sound" | "music" | "meme";

/** Roles people tend to want; any name works. */
const ROLE_IDEAS = [
  "impact",
  "whoosh",
  "sting.awkward",
  "sting.funny",
  "ding",
  "laugh",
  "music.bed",
  "sticker",
];

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const secs = (s?: number) => (s === undefined ? "" : s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`);
const isVideo = (file: string) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(file);

/** One preview playing at a time. */
let player: HTMLAudioElement | null = null;

export function Library() {
  const state = useLibrary((s) => s.state);
  const hasProject = useProject((s) => s.dir !== null);
  const [scope, setScope] = useState<Scope>("library");
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    followLibrary();
    return () => {
      player?.pause();
      player = null;
    };
  }, []);

  const inScope = useMemo(() => (state?.assets ?? []).filter((a) => a.scope === scope), [state, scope]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inScope.filter(
      (a) =>
        (kind === "all" || a.kind === kind) &&
        (!q ||
          `${a.name} ${a.tags.join(" ")} ${a.description} ${a.roles.join(" ")}`.toLowerCase().includes(q)),
    );
  }, [inScope, kind, query]);
  const sounds = shown.filter((a) => a.kind !== "meme");
  const memes = shown.filter((a) => a.kind === "meme");
  const clips = useDoc((d) => d?.sources.filter((x) => x.kind !== "solid").length ?? 0);
  const count = (s: Scope) =>
    (state?.assets ?? []).filter((a) => a.scope === s).length + (s === "project" ? clips : 0);

  const playUrl = (key: string, url: string) => {
    if (playing === key) {
      player?.pause();
      setPlaying(null);
      return;
    }
    player?.pause();
    player = new Audio(url);
    player.onended = () => setPlaying(null);
    void player.play().catch(() => setPlaying(null));
    setPlaying(key);
  };
  const play = (a: AssetEntry) => playUrl(a.id, assetUrl(a.id));
  const place = async (a: AssetEntry) => {
    const result = await host.library.place(a.id, currentTime());
    if (!result.ok) toast(result.error, "warn");
    else {
      receive(result.commit);
      toast(a.kind === "music" ? `"${a.name}" is now the music` : `Added "${a.name}" at the playhead`);
    }
  };
  const add = async (paths: string[]) => {
    if (!paths.length) return toast("Adding to the library needs the desktop app.", "warn");
    try {
      await host.library.add(paths, scope);
      toast(
        `Added ${paths.length} ${paths.length === 1 ? "file" : "files"} to ${scope === "project" ? "this project's assets" : "your library"}`,
      );
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  };
  const selected = open ? (state?.assets.find((a) => a.id === open) ?? null) : null;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-2.5"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        // Ours, not the window's import.
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event("vedit:drop-handled"));
        setDropping(false);
        void add([...e.dataTransfer.files].map((f) => host.pathForFile(f)).filter(Boolean));
      }}
    >
      <div className="flex gap-1 self-start rounded-md bg-button p-0.5 text-[11.5px]">
        {(
          [
            ["library", "Your library"],
            ["project", "This project"],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            type="button"
            aria-pressed={scope === s}
            disabled={s === "project" && !hasProject}
            onClick={() => setScope(s)}
            className={clsx(
              "rounded px-2 py-0.5 disabled:opacity-40",
              scope === s ? "bg-selected text-fg" : "text-muted hover:text-fg-2",
            )}
          >
            {label} <span className="text-faint">{count(s)}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-raised px-2 focus-within:border-edge">
          <MagnifyingGlassIcon size={13} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search names, tags, roles"
            aria-label="Search the library"
            className="h-[28px] min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-faint"
          />
        </div>
        <button
          type="button"
          title={scope === "project" ? "Add files to this project's assets" : "Add files to your library"}
          aria-label="Add files"
          onClick={() =>
            void host.library.pickAndAdd(scope).catch((err: Error) => toast(err.message, "warn"))
          }
          className="flex size-[28px] shrink-0 items-center justify-center rounded-lg bg-control text-fg-2 hover:bg-selected"
        >
          <PlusIcon size={14} />
        </button>
        <button
          type="button"
          title="Show in Finder"
          aria-label="Show in Finder"
          onClick={() => void host.library.reveal(scope).catch((err: Error) => toast(err.message, "warn"))}
          className="flex size-[28px] shrink-0 items-center justify-center rounded-lg bg-control text-fg-2 hover:bg-selected"
        >
          <FolderOpenIcon size={14} />
        </button>
      </div>

      <div className="flex gap-1">
        {(
          [
            ["all", "All"],
            ["sound", "Sounds"],
            ["music", "Music"],
            ["meme", "Memes"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={clsx(
              "rounded-full px-2.5 py-0.5 text-[11.5px]",
              kind === k ? "bg-selected text-fg" : "text-muted hover:bg-button hover:text-fg-2",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {(state?.pending ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <CircleNotchIcon size={12} className="animate-spin" /> Cataloguing {state!.pending}{" "}
          {state!.pending === 1 ? "file" : "files"}…
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {scope === "project" && (
          <ProjectClips query={query} kind={kind} playing={playing} play={(id, url) => playUrl(id, url)} />
        )}
        {scope === "project" && (
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <span className="font-mono text-[10.5px] tracking-wide text-faint uppercase">
              Project assets/
            </span>
            <span className="text-[10.5px] text-faint">just for this project</span>
          </div>
        )}
        {!inScope.length ? (
          scope === "project" ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[11.5px] leading-relaxed text-faint">
              Drop files here to keep them with this project only.
            </p>
          ) : (
            <Empty scope={scope} dir={state?.dir} />
          )
        ) : !shown.length ? (
          <p className="px-1 py-4 text-center text-xs text-faint">Nothing here matches.</p>
        ) : (
          <>
            {sounds.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {sounds.map((a) => (
                  <li key={a.id}>
                    <div
                      className={clsx(
                        "group flex items-center gap-2 rounded-lg px-1.5 py-1.5",
                        open === a.id ? "bg-raised" : "hover:bg-raised",
                      )}
                    >
                      <button
                        type="button"
                        aria-label={playing === a.id ? `Stop ${a.name}` : `Play ${a.name}`}
                        onClick={() => play(a)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-control text-fg-2 hover:bg-selected"
                      >
                        {playing === a.id ? (
                          <PauseIcon size={12} weight="fill" />
                        ) : a.kind === "music" ? (
                          <MusicNoteIcon size={12} />
                        ) : (
                          <PlayIcon size={12} weight="fill" className="ml-px" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpen(open === a.id ? null : a.id)}
                        className="flex min-w-0 flex-1 flex-col text-left"
                      >
                        <span className="truncate text-[12.5px] text-fg">{a.name}</span>
                        <span className="truncate text-[11px] text-faint">
                          {[secs(a.duration), a.bpm ? `${Math.round(a.bpm)} BPM` : "", ...a.tags.slice(0, 3)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                      {a.roles.map((r) => (
                        <span
                          key={r}
                          className="shrink-0 rounded bg-accent/15 px-1.5 py-px font-mono text-[10px] text-accent"
                        >
                          {r}
                        </span>
                      ))}
                      <AddButton asset={a} onAdd={place} />
                    </div>
                    {open === a.id && selected && <Details asset={selected} />}
                  </li>
                ))}
              </ul>
            )}
            {memes.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {memes.map((a) => (
                    <div
                      key={a.id}
                      className={clsx(
                        "group relative aspect-square overflow-hidden rounded-lg",
                        a.alpha
                          ? "bg-[repeating-conic-gradient(#2a2a30_0_25%,#222226_0_50%)] bg-[length:12px_12px]"
                          : "bg-sunken",
                        open === a.id && "ring-2 ring-accent",
                      )}
                    >
                      <button
                        type="button"
                        title={a.description || a.name}
                        onClick={() => setOpen(open === a.id ? null : a.id)}
                        className="size-full"
                      >
                        {isVideo(a.file) ? (
                          <video
                            src={assetUrl(a.id)}
                            muted
                            loop
                            autoPlay
                            playsInline
                            className="size-full object-contain"
                          />
                        ) : (
                          <img
                            src={assetUrl(a.id)}
                            alt={a.name}
                            loading="lazy"
                            className="size-full object-contain"
                          />
                        )}
                      </button>
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 px-1.5 pt-3 pb-1 text-[10.5px] text-white opacity-0 group-hover:opacity-100">
                        {a.name}
                      </span>
                      {a.roles.length > 0 && (
                        <span className="absolute top-1 left-1 rounded bg-accent px-1 font-mono text-[9.5px] text-accent-fg">
                          {a.roles[0]}
                        </span>
                      )}
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100">
                        <AddButton asset={a} onAdd={place} />
                      </div>
                    </div>
                  ))}
                </div>
                {selected?.kind === "meme" && <Details asset={selected} />}
              </div>
            )}
          </>
        )}
      </div>

      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-bg/85 text-center">
          <UploadSimpleIcon size={22} className="text-accent" />
          <span className="text-[13px] font-semibold text-fg">
            {scope === "project" ? "Add to this project's assets" : "Add to your library"}
          </span>
          <span className="px-6 text-xs text-muted">
            {scope === "project" ? "Just for this project." : "Kept for every project."}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Every clip the project uses or holds (footage, songs, sounds, memes, attachments), with whether it's
 * in the cut, and Keep to put songs, sounds, memes and short clips in the shared library.
 */
function ProjectClips({
  query,
  kind,
  playing,
  play,
}: {
  query: string;
  kind: Kind;
  playing: string | null;
  play: (id: string, url: string) => void;
}) {
  const sources = useDoc((d) => d.sources);
  const used = useDoc((d) => {
    const ids = new Set<string>();
    for (const sc of d.scenes) ids.add(sc.source);
    for (const x of d.sfx) if (x.source) ids.add(x.source);
    for (const v of d.visuals) if ("source" in v.content && v.content.source) ids.add(v.content.source);
    if (d.music.source) ids.add(d.music.source);
    for (const m of d.musicClips) ids.add(m.source);
    for (const v of d.voiceovers) ids.add(v.source);
    return [...ids].sort().join(",");
  });
  const [kept, setKept] = useState<Set<string>>(new Set());
  const inCut = useMemo(() => new Set(used.split(",")), [used]);
  const q = query.trim().toLowerCase();
  const list = sources.filter((s) => {
    if (s.kind === "solid") return false;
    const k = s.kind === "audio" ? ((s.duration ?? 0) > 45 ? "music" : "sound") : "meme";
    if (kind !== "all" && kind !== k && !(kind === "meme" && s.kind !== "audio")) return false;
    return !q || `${s.label} ${s.summary} ${s.tags.join(" ")}`.toLowerCase().includes(q);
  });
  if (!list.length) return null;
  const url = (s: Source) =>
    `${MEDIA_BASE}${encodeURIComponent(s.id)}${s.proxy && s.kind === "video" ? "?proxy" : ""}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-[10.5px] tracking-wide text-faint uppercase">
          In this project · {list.length}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {list.map((s) => {
          const fromLibrary = s.origin?.provider === "library";
          const canKeep = keepable(s) && !fromLibrary;
          return (
            <li key={s.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-raised">
              {s.kind === "audio" ? (
                <button
                  type="button"
                  aria-label={playing === s.id ? `Stop ${s.label}` : `Play ${s.label}`}
                  onClick={() => play(s.id, url(s))}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-control text-fg-2 hover:bg-selected"
                >
                  {playing === s.id ? (
                    <PauseIcon size={12} weight="fill" />
                  ) : (
                    <PlayIcon size={12} weight="fill" />
                  )}
                </button>
              ) : s.kind === "image" ? (
                <img
                  src={url(s)}
                  alt=""
                  loading="lazy"
                  className="size-9 shrink-0 rounded-md bg-sunken object-cover"
                />
              ) : (
                <video
                  src={`${url(s)}#t=0.5`}
                  muted
                  preload="metadata"
                  className="size-9 shrink-0 rounded-md bg-sunken object-cover"
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12.5px] text-fg" title={s.label}>
                  {s.label}
                </span>
                <span className="truncate text-[11px] text-faint">
                  {[
                    s.kind === "audio" ? "audio" : s.kind,
                    secs(s.duration),
                    inCut.has(s.id) ? "in the edit" : "not used",
                    fromLibrary ? "from your library" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {canKeep &&
                (kept.has(s.id) ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-ok">
                    <CheckIcon size={12} /> Kept
                  </span>
                ) : (
                  <button
                    type="button"
                    title="Copy it into your library, for every project"
                    onClick={() => {
                      keepInLibrary([s.id]);
                      setKept((k) => new Set(k).add(s.id));
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-control px-2 py-0.5 text-[11px] text-fg-2 opacity-0 group-hover:opacity-100 hover:bg-selected focus-visible:opacity-100"
                  >
                    <BookmarkSimpleIcon size={12} /> Keep
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AddButton({ asset, onAdd }: { asset: AssetEntry; onAdd: (a: AssetEntry) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      title={asset.kind === "music" ? "Use as the music" : "Add at the playhead"}
      aria-label={`Add ${asset.name}`}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onAdd(asset).finally(() => setBusy(false));
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg opacity-0 shadow group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-60"
    >
      {busy ? <CircleNotchIcon size={12} className="animate-spin" /> : <PlusIcon size={13} weight="bold" />}
    </button>
  );
}

/** An asset's name, notes, tags and roles, saved as they're left. */
function Details({ asset }: { asset: AssetEntry }) {
  const [name, setName] = useState(asset.name);
  const [about, setAbout] = useState(asset.description);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [role, setRole] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setName(asset.name);
    setAbout(asset.description);
    setTags(asset.tags.join(", "));
  }, [asset.name, asset.description, asset.tags]);
  const save = (patch: { name?: string; description?: string; tags?: string[] }) =>
    void host.library.update(asset.id, patch).catch((err: Error) => toast(err.message, "warn"));
  const giveRole = () => {
    const r = role.trim().toLowerCase();
    if (!r) return;
    setRole("");
    void host.library.setRole(r, asset.id).catch((err: Error) => toast(err.message, "warn"));
  };
  const field =
    "w-full rounded-md border border-line bg-raised px-2 py-1 text-xs text-fg outline-none placeholder:text-faint focus:border-edge";
  return (
    <div
      className="mx-1 mt-1 mb-2 flex flex-col gap-1.5 rounded-lg border border-line bg-bg/60 p-2.5"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== asset.name && save({ name: name.trim() })}
        aria-label="Name"
        className={clsx(field, "font-medium")}
      />
      <textarea
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        onBlur={() => about !== asset.description && save({ description: about.trim() })}
        placeholder="What it is, when to use it"
        rows={2}
        aria-label="Description"
        className={clsx(field, "resize-none")}
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        onBlur={() => {
          const next = tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          if (next.join(",") !== asset.tags.join(",")) save({ tags: next });
        }}
        placeholder="Tags, separated by commas"
        aria-label="Tags"
        className={field}
      />
      <div className="flex flex-wrap items-center gap-1">
        {asset.roles.map((r) => (
          <span
            key={r}
            className="flex items-center gap-0.5 rounded bg-accent/15 py-px pr-0.5 pl-1.5 font-mono text-[10.5px] text-accent"
          >
            {r}
            <button
              type="button"
              aria-label={`Remove the role ${r}`}
              onClick={() => void host.library.setRole(r, null)}
              className="rounded px-0.5 hover:bg-accent/20"
            >
              <XIcon size={10} />
            </button>
          </span>
        ))}
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") giveRole();
          }}
          onBlur={giveRole}
          list="vedit-roles"
          placeholder={asset.roles.length ? "Another role" : "Give it a role: impact, sting.awkward…"}
          aria-label="Role"
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 font-mono text-[11px] text-fg outline-none placeholder:font-sans placeholder:text-faint"
        />
        <datalist id="vedit-roles">
          {ROLE_IDEAS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
      <p className="text-[10.5px] leading-snug text-faint">
        The agent uses a role's asset whenever that job comes up ("boom on the big reactions" → impact).
      </p>
    </div>
  );
}

function Empty({ scope, dir }: { scope: Scope; dir: string | null | undefined }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong px-5 py-8 text-center">
      <UploadSimpleIcon size={22} className="text-accent" />
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-fg">
          {scope === "project" ? "No assets just for this project" : "Your library is empty"}
        </span>
        <span className="text-xs leading-relaxed text-muted">
          Drop sounds, music and memes here, or press +.{" "}
          {scope === "project"
            ? "These stay with this project."
            : "They're kept for every project, and the agent uses them before searching the web."}
        </span>
      </div>
      {dir && (
        <button
          type="button"
          onClick={() => void host.library.reveal(scope)}
          className="flex max-w-full items-center gap-1.5 rounded-md bg-button px-2.5 py-1 font-mono text-[11px] text-fg-2 hover:bg-chip"
          title={dir}
        >
          <FolderOpenIcon size={12} className="shrink-0" />
          <span className="truncate">{home(dir)}</span>
        </button>
      )}
    </div>
  );
}
