/**
 * Inspirations: editing styles the video can follow. Each card shows your own footage in that style;
 * open one to read its brief (what the editor will do), then use it, re-edit in it, or try it as a
 * version. Learn a new one from a video you love: the agent studies it and writes the brief.
 */
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleNotchIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  SparkleIcon,
  TrashIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { Thumbnail } from "@remotion/player";
import { compositionMeta, VideoComposition } from "@vedit/composition";
import { type InspirationInfo, type InspirationPack, inspirationBrief } from "@vedit/project";
import { clsx } from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { upload } from "../../lib/attach.ts";
import { captionWindow } from "../../lib/caption-preview.ts";
import { host, MEDIA_BASE } from "../../lib/host.ts";
import { send, useChat } from "../../state/chat.ts";
import { receive, useDoc, useProject } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { setUi } from "../../state/ui.ts";
import { Brief } from "./Brief.tsx";
import { localPack, stylePreviewDoc } from "./preview.ts";

const LEARN_PROMPT =
  "Learn the editing style of the attached video and save it as one of my inspirations. Study it closely: inspiration measure, then look at every moment it lists, and at the captions, graphics, transitions and colour. Write a brief as specific as the built-in ones, with its settings, and a caption look of its own when the captions are distinctive. Don't change this video's edit.";

export function InspirationsView() {
  const [list, setList] = useState<InspirationInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const copies = useDoc((d) => d.inspirations);
  const active = useDoc((d) => d.meta.inspiration);

  const refresh = useCallback(async () => {
    try {
      setList(await host.inspirations.list());
    } catch (err) {
      toast(`Couldn't read the inspirations: ${(err as Error).message}`, "warn");
      setList([]);
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the project's copies change what's listed
  useEffect(() => void refresh(), [refresh, copies]);

  const close = () => setUi({ view: "editor" });
  const mine = list?.filter((i) => i.origin !== "builtin") ?? [];
  const builtin = list?.filter((i) => i.origin === "builtin") ?? [];
  const selected = list?.find((i) => i.id === open) ?? null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg animate-fade-in">
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-line pr-4 pl-[84px]">
        <div className="no-drag flex min-w-0 items-center gap-2">
          <Button variant="ghost" onClick={close} className="-ml-2">
            <ArrowLeftIcon size={15} /> Editor
          </Button>
          <span className="text-faint">/</span>
          <span className="text-[14px] font-semibold">Inspirations</span>
        </div>
        <div className="no-drag flex gap-2">
          <Button onClick={() => void host.inspirations.reveal()}>
            <FolderOpenIcon size={15} /> Open folder
          </Button>
          <LearnButton onStarted={close} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
          <div className="mx-auto flex max-w-[1080px] flex-col gap-8">
            <div className="flex flex-col gap-1">
              <h1 className="m-0 text-[22px] font-semibold">Edit it like…</h1>
              <p className="m-0 max-w-[640px] text-[13px] leading-relaxed text-muted">
                Editing styles your video can follow: how it's structured and paced, how captions, motion and
                sound behave. Each card shows your own footage in that style. Your taste in STYLE.md and your
                brand kit still come first.
              </p>
            </div>
            {list === null ? (
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <CircleNotchIcon size={14} className="animate-spin" /> Loading
              </div>
            ) : (
              <>
                {mine.length > 0 && (
                  <Grid title="Yours" items={mine} active={active} open={open} onOpen={setOpen} />
                )}
                <Grid title="Built in" items={builtin} active={active} open={open} onOpen={setOpen} />
              </>
            )}
          </div>
        </main>
        {selected && (
          <Detail
            key={selected.id}
            info={selected}
            active={active === selected.id}
            onClose={() => setOpen(null)}
            onChanged={refresh}
            onLeave={close}
          />
        )}
      </div>
    </div>
  );
}

function Grid({
  title,
  items,
  active,
  open,
  onOpen,
}: {
  title: string;
  items: readonly InspirationInfo[];
  active: string | undefined;
  open: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-[13px] font-semibold text-fg-2">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-4">
        {items.map((i) => (
          <Card
            key={i.id}
            info={i}
            active={active === i.id}
            selected={open === i.id}
            onOpen={() => onOpen(i.id)}
          />
        ))}
      </div>
    </section>
  );
}

/** The pack behind a list entry: built in or the project's copy here, the user's own from the host. */
function usePack(info: InspirationInfo): InspirationPack | null {
  const doc = useProject((s) => s.doc!);
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => {
    if (info.origin !== "mine") return;
    let live = true;
    void host.inspirations.read(info.id).then((text) => live && setMd(text));
    return () => {
      live = false;
    };
  }, [info.id, info.origin]);
  return useMemo(
    () => (info.origin === "mine" ? (md ? localPack(doc, info.id, md) : null) : localPack(doc, info.id)),
    [doc, info.id, info.origin, md],
  );
}

function Card({
  info,
  active,
  selected,
  onOpen,
}: {
  info: InspirationInfo;
  active: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const pack = usePack(info);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "group flex flex-col overflow-hidden rounded-2xl border bg-raised text-left transition-colors",
        selected ? "border-accent" : "border-line-strong hover:border-edge",
      )}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-black">
        {pack ? <StyleFrame pack={pack} /> : null}
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          {active && (
            <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">
              <CheckIcon size={11} weight="bold" /> Following
            </span>
          )}
          {info.origin !== "builtin" && (
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-fg">
              {info.origin === "mine" ? "Yours" : "In this project"}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[14px] font-semibold">{info.name}</span>
          <Energy n={info.energy} />
        </div>
        <span className="line-clamp-2 text-[12px] leading-snug text-muted">{info.description}</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {info.bestFor.slice(0, 3).map((b) => (
            <span key={b} className="rounded-md bg-control px-1.5 py-0.5 text-[10.5px] text-fg-3">
              {b}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

/** Your footage in the style, mid-sentence, or the style's name when there's no footage yet. */
function StyleFrame({ pack }: { pack: InspirationPack }) {
  const doc = useProject((s) => s.doc!);
  const preview = useMemo(() => stylePreviewDoc(doc, pack), [doc, pack]);
  const props = useMemo(() => (preview ? { doc: preview, mediaBase: MEDIA_BASE } : null), [preview]);
  if (!preview || !props)
    return <div className="absolute inset-0 bg-gradient-to-br from-[#26262c] to-[#141417]" />;
  const meta = compositionMeta(preview);
  const frame = Math.min(meta.durationInFrames - 1, Math.round(captionWindow(preview).said * meta.fps));
  // The frame is 9:16; the card shows its middle, where the face and the captions are.
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2"
      style={{ width: "100%", aspectRatio: `${meta.width}/${meta.height}`, top: "-12%" }}
    >
      <Thumbnail
        component={VideoComposition}
        inputProps={props}
        frameToDisplay={frame}
        durationInFrames={meta.durationInFrames}
        compositionWidth={meta.width}
        compositionHeight={meta.height}
        fps={meta.fps}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

/** Energy, 1 calm to 5 relentless. */
function Energy({ n }: { n: number }) {
  return (
    <span className="flex shrink-0 items-end gap-[2px]" title={`Energy ${n} of 5`}>
      <span className="sr-only">Energy {n} of 5</span>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={clsx("w-[3px] rounded-[1px]", i <= n ? "bg-accent" : "bg-line-strong")}
          style={{ height: 4 + i * 2 }}
        />
      ))}
    </span>
  );
}

function Detail({
  info,
  active,
  onClose,
  onChanged,
  onLeave,
}: {
  info: InspirationInfo;
  active: boolean;
  onClose: () => void;
  onChanged: () => void;
  onLeave: () => void;
}) {
  const pack = usePack(info);
  const hasCut = useDoc((d) => d.scenes.length > 0);
  const kit = useDoc((d) => d.meta.kit);
  const busy = useChat((s) => s.activeRun !== null);
  const [keepLook, setKeepLook] = useState(Boolean(kit));
  const [working, setWorking] = useState(false);

  const apply = async (): Promise<boolean> => {
    setWorking(true);
    try {
      const r = await host.inspirations.apply(info.id, keepLook);
      if (!r.ok) {
        toast(r.error, "warn");
        return false;
      }
      receive(r.commit);
      return true;
    } finally {
      setWorking(false);
    }
  };

  const useOnly = async () => {
    if (await apply())
      toast(
        hasCut
          ? `Following ${info.name}. Its settings are on; ask for changes in chat.`
          : `Your edit will follow ${info.name}. Add clips to start.`,
      );
  };
  const reEdit = async () => {
    if (!(await apply())) return;
    void send(
      `Re-edit this video following the "${info.name}" inspiration: rebuild the cut, hook, captions, visuals, motion and sound to its brief, from the footage. Keep my STYLE.md.`,
      {},
      "thorough",
    );
    onLeave();
  };
  const tryVersion = () => {
    void host.versions.generate(
      `Follow the "${info.name}" inspiration (inspiration use ${info.id}) and re-edit the video to its brief.`,
      1,
    );
    setUi({ view: "versions" });
  };
  const save = async () => {
    try {
      await host.inspirations.save(info.id);
      toast(`Saved ${info.name} to your inspirations`);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "warn");
    }
  };
  const remove = async () => {
    if (
      !window.confirm(
        `Delete "${info.name}" from your inspirations? Projects that follow it keep their copy.`,
      )
    )
      return;
    await host.inspirations.remove(info.id);
    onClose();
    onChanged();
  };

  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-line bg-panel animate-fade-in">
      <div className="flex shrink-0 flex-col gap-3 border-b border-line p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[17px] font-semibold">{info.name}</span>
            <span className="text-[12.5px] leading-snug text-muted">{info.description}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {info.traits.map((t) => (
            <span key={t} className="rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-fg-2">
              {t}
            </span>
          ))}
          {info.length && (
            <span className="rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-fg-2">
              {info.length}
            </span>
          )}
        </div>
        {kit && (
          <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
            <input type="checkbox" checked={keepLook} onChange={(e) => setKeepLook(e.target.checked)} />
            Keep my brand kit's look (only the editing pattern applies)
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {hasCut ? (
            <>
              <Button variant="accent" disabled={working || busy} onClick={reEdit}>
                <SparkleIcon size={15} /> Re-edit in this style
              </Button>
              <Button disabled={working} onClick={useOnly}>
                {active ? "Apply its settings again" : "Use its settings only"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={tryVersion}>
                Try as a version
              </Button>
            </>
          ) : (
            <Button variant="accent" disabled={working || active} onClick={useOnly}>
              {active ? (
                <>
                  <CheckIcon size={15} /> Following
                </>
              ) : (
                "Edit in this style"
              )}
            </Button>
          )}
        </div>
        <div className="flex gap-3 text-[12px]">
          {(info.origin === "project" || active) && (
            <button type="button" onClick={save} className="flex items-center gap-1 text-muted hover:text-fg">
              <FloppyDiskIcon size={13} /> Save to my inspirations
            </button>
          )}
          {info.origin === "mine" && (
            <button
              type="button"
              onClick={remove}
              className="flex items-center gap-1 text-muted hover:text-bad"
            >
              <TrashIcon size={13} /> Delete
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {pack ? (
          <Brief md={inspirationBrief(pack.md)} />
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <CircleNotchIcon size={14} className="animate-spin" /> Loading the brief
          </div>
        )}
      </div>
    </aside>
  );
}

/** Learn a style from a video: attach it, and the agent studies it and writes the inspiration. */
function LearnButton({ onStarted }: { onStarted: () => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const busy = useChat((s) => s.activeRun !== null);
  const [uploading, setUploading] = useState(false);
  const learn = async (file: File) => {
    setUploading(true);
    const r = await upload(file, file.name);
    setUploading(false);
    if ("error" in r) return toast(r.error, "warn");
    void send(LEARN_PROMPT, {}, "thorough", [r.source]);
    toast("Studying the video. Follow along in the chat; it'll appear under Yours.");
    onStarted();
  };
  return (
    <>
      <Button variant="accent" disabled={busy || uploading} onClick={() => picker.current?.click()}>
        {uploading ? <CircleNotchIcon size={15} className="animate-spin" /> : <VideoCameraIcon size={15} />}
        Learn from a video
      </Button>
      <input
        ref={picker}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void learn(file);
        }}
      />
    </>
  );
}
