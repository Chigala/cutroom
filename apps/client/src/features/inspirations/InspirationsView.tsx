/**
 * Inspirations: editing styles the video can follow. Each card shows your own footage in that style;
 * open one to read its brief (what the editor will do), then use it, re-edit in it, or try it as a
 * version. Learn a new one from a video you love: the agent studies it and writes the brief.
 */
import {
  CheckIcon,
  CircleNotchIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  SparkleIcon,
  TrashIcon,
  VideoCameraIcon,
  XIcon,
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
import { chatReady, send, useChat } from "../../state/chat.ts";
import { receive, useDoc, useProject } from "../../state/project.ts";
import { openProject } from "../../state/projects.ts";
import { toast } from "../../state/toast.ts";
import { setUi } from "../../state/ui.ts";
import { Brief } from "./Brief.tsx";
import { localPack, stylePreviewDoc } from "./preview.ts";

const LEARN_PROMPT =
  "Learn the editing style of the attached video and save it as one of my inspirations. Study it the way an editor would before copying it: inspiration measure, watch it play (the stretches it lists densely, then the whole of it), write a brief as specific as the built-in ones with its settings, a caption look of its own when the captions are distinctive, and its font if it isn't here; then compare your version with it side by side and fix what differs. Don't change this video's edit.";

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
    // Over the editor, beside the project rail (which shows it's open), like a page in Claude's apps.
    <div className="absolute inset-0 z-30 flex bg-bg animate-fade-in">
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-10 px-10 pt-10 pb-16 max-xl:px-8">
          <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="flex max-w-[620px] flex-col gap-2">
              <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em]">Inspirations</h1>
              <p className="m-0 text-[14px] leading-relaxed text-muted">
                Editing styles your video can follow: how it's structured and paced, how its captions, motion
                and sound behave. Each one is shown on your own footage. Your STYLE.md and brand kit still
                come first.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => void host.inspirations.reveal()}>
                <FolderOpenIcon size={15} /> Open folder
              </Button>
              <LearnButton onStarted={close} />
            </div>
          </header>
          {/* The way back, where pages keep theirs: the corner (Escape works too). */}
          <button
            type="button"
            aria-label="Back to the editor"
            title="Back to the editor (Esc)"
            onClick={close}
            className="absolute top-4 right-4 z-10 flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-button hover:text-fg"
          >
            <XIcon size={17} />
          </button>
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
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-[13px] font-medium text-muted">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-x-5 gap-y-8">
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
      aria-pressed={selected}
      className="group flex flex-col gap-3 text-left"
    >
      <div
        className={clsx(
          "relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-black shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] transition-[transform,box-shadow] duration-200 ease-out",
          selected
            ? "ring-2 ring-fg/85 ring-offset-[3px] ring-offset-bg"
            : "ring-1 ring-white/[0.06] group-hover:-translate-y-0.5 group-hover:ring-white/15",
        )}
      >
        {pack ? <StyleFrame pack={pack} /> : null}
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          {active && (
            <span className="flex items-center gap-1 rounded-full bg-fg px-2 py-0.5 text-[11px] font-semibold text-bg">
              <CheckIcon size={11} weight="bold" /> Following
            </span>
          )}
          {info.origin !== "builtin" && (
            <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-fg backdrop-blur-sm">
              {info.origin === "mine" ? "Yours" : "In this project"}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{info.name}</span>
          <Energy n={info.energy} />
        </div>
        <span className="line-clamp-2 text-[13px] leading-snug text-muted">{info.description}</span>
        {info.bestFor.length > 0 && (
          <span className="truncate pt-0.5 text-[12px] text-faint">
            {info.bestFor.slice(0, 3).join(" · ")}
          </span>
        )}
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
          className={clsx("w-[3px] rounded-full", i <= n ? "bg-fg-3" : "bg-line-strong")}
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
  /** The re-edit in a copy of the project, so this one stays as it is to compare. */
  const tryCopy = async () => {
    const dir = useProject.getState().dir;
    if (!dir || !(await openProject(() => host.project.duplicate(dir, "edit")))) return;
    await chatReady();
    await reEdit();
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
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-panel animate-fade-in max-xl:w-[360px]">
      <div className="flex shrink-0 flex-col gap-5 px-6 pt-6 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[20px] font-semibold tracking-[-0.015em]">{info.name}</span>
            <span className="text-[13.5px] leading-relaxed text-muted">{info.description}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-button hover:text-fg"
          >
            <XIcon size={16} />
          </button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-fg-3">
          {[...info.traits, ...(info.length ? [`Usually ${info.length}`] : [])].map((t) => (
            <li key={t} className="flex items-center gap-2.5">
              <span aria-hidden className="size-1 rounded-full bg-faint" />
              {t}
            </li>
          ))}
        </ul>
        {kit && (
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            <input type="checkbox" checked={keepLook} onChange={(e) => setKeepLook(e.target.checked)} />
            Keep my brand kit's look (only the editing pattern applies)
          </label>
        )}
        <div className="flex flex-col gap-2">
          {hasCut ? (
            <>
              <Button variant="accent" disabled={working || busy} onClick={reEdit} className="h-10 w-full">
                <SparkleIcon size={15} weight="fill" /> Re-edit in this style
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={working} onClick={useOnly}>
                  {active ? "Apply its settings again" : "Use its settings only"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void tryCopy()}
                  title="Makes a copy of this project and re-edits the copy, so this one stays to compare"
                >
                  Try in a copy
                </Button>
              </div>
            </>
          ) : (
            <Button variant="accent" disabled={working || active} onClick={useOnly} className="h-10 w-full">
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
        <div className="flex gap-4 text-[12.5px] empty:hidden">
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
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-6 pt-5 pb-8">
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
      <Button disabled={busy || uploading} onClick={() => picker.current?.click()}>
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
