/**
 * The video is the main surface. The player renders the real composition (the same component export
 * uses), and the overlay on top makes the frame a canvas: point at things, pin comments, see safe zones.
 */

import { EyeIcon, EyeSlashIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { Player, type PlayerRef } from "@remotion/player";
import { CoverComposition, compositionMeta, VideoComposition } from "@vedit/composition";
import {
  anchorAt,
  type Comment,
  formatTime,
  newId,
  PHONE_PLATFORMS,
  type ProjectDoc,
  platformRules,
  resolveAnchor,
  SHAPES,
  safeZoneFor,
  sceneAt,
  shapeOf,
  shapeSize,
  timelineOf,
} from "@vedit/project";
import { clsx } from "clsx";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../components/ui.tsx";
import { MEDIA_BASE } from "../../lib/host.ts";
import { mod } from "../../lib/keys.ts";
import { AUDIO_TAGS } from "../../lib/player.ts";
import { send } from "../../state/chat.ts";
import { useLayout } from "../../state/layout.ts";
import {
  attachPlayer,
  currentTime,
  pause,
  playback,
  togglePlay,
  useFrameEffect,
  usePlayback,
} from "../../state/playback.ts";
import {
  DraftViewContext,
  edit,
  setShowDraft,
  useDoc,
  useProject,
  useViewedDoc,
} from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { setCommentsOpen, setUi, useUi } from "../../state/ui.ts";
import { CommentsRail } from "./CommentsRail.tsx";
import { EmptyStage } from "./EmptyStage.tsx";

/** The stage plays the agent's live draft while it works (DraftViewContext), or the project as it is. */
export function Preview() {
  return (
    <DraftViewContext.Provider value={true}>
      <PreviewBody />
    </DraftViewContext.Provider>
  );
}

function PreviewBody() {
  const hasScenes = useDoc((d) => d.scenes.length > 0);
  // Hidden comments give their room to the video (a 16:9 frame grows into it).
  const comments = useLayout().comments;
  return (
    <main
      className={clsx(
        "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-3.5 bg-sunken px-6 py-5 [container-type:size]",
        comments && "pr-[260px]",
      )}
    >
      {hasScenes ? (
        <>
          <DraftBadge />
          <StageBar />
          <Stage />
          <Transport />
        </>
      ) : (
        <EmptyStage />
      )}
      <CommentsRail />
    </main>
  );
}

/**
 * While the agent works: one small pill. "Draft" (pulsing while it's live) says the stage shows its work
 * in progress; clicking it shows the project as it is ("Show draft" brings it back).
 */
function DraftBadge() {
  const draft = useProject((s) => s.draft);
  const shown = useProject((s) => s.showDraft);
  if (!draft) return null;
  return (
    <button
      type="button"
      onClick={() => setShowDraft(!shown)}
      title={
        shown
          ? "The agent's work in progress. Click to see your project as it is."
          : "Your project as it is. Click to see the agent's draft."
      }
      className={clsx(
        // Its own corner, across from Comments: appearing never pushes the stage bar into them.
        "absolute top-6 left-[22px] flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] whitespace-nowrap transition-colors animate-fade-in",
        shown ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
      )}
    >
      <span
        className={clsx(
          "size-1.5 rounded-full",
          shown ? "bg-accent" : "border border-current",
          shown && !draft.held && "animate-pulse",
        )}
      />
      {shown ? "Draft" : "Show draft"}
    </button>
  );
}

/** Video or cover, and which shape: how the stage shows the edit (export.formats exports the shapes). */
function StageBar() {
  const stage = useUi((s) => s.stage);
  const stageShape = useUi((s) => s.stageShape);
  const own = useDoc((d) => shapeOf(d.meta.format));
  const comments = useLayout().comments;
  const chip = (on: boolean) =>
    clsx("rounded-md px-2 py-0.5 text-[11px]", on ? "bg-button text-fg" : "text-muted hover:text-fg");
  return (
    <div
      className={clsx(
        // Centred, clear of the corners (the Draft pill, and the Comments button while the rail is hidden):
        // a narrow window wraps it rather than running it under them.
        "flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono",
        comments ? "px-[104px]" : "px-[150px]",
      )}
    >
      <div className="flex gap-0.5">
        {(["video", "cover"] as const).map((s) => (
          <button key={s} type="button" className={chip(stage === s)} onClick={() => setUi({ stage: s })}>
            {s === "video" ? "Video" : "Cover"}
          </button>
        ))}
      </div>
      <div className="flex gap-0.5">
        {SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            className={chip((stageShape ?? own) === s)}
            onClick={() => setUi({ stageShape: s === own ? null : s })}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Inside the player when it stops: it only reports the error (the message is drawn over the stage). */
function StageCrashed({ error, onCrash }: { error: Error; onCrash: (error: Error) => void }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when it's shown
  useEffect(() => {
    console.error("[preview] stopped:", error);
    onCrash(error);
  }, []);
  return <div className="h-full bg-black" />;
}

/**
 * The preview stopped on an error: said plainly at the stage's own size (not inside the scaled video),
 * with the way back. It also retries on the next change.
 */
function StageError({ error, onReload }: { error: Error; onReload: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-sunken/95 p-8 text-center animate-fade-in">
      <span className="text-[15px] font-medium text-fg">The preview hit a snag</span>
      <span className="max-w-[300px] text-[13px] leading-relaxed text-muted">
        Something in this edit couldn't be drawn. It comes back by itself when the edit changes, or now:
      </span>
      <button
        type="button"
        onClick={onReload}
        className="mt-1 h-9 rounded-lg bg-control px-4 text-[13px] text-fg transition-colors hover:bg-selected"
      >
        Reload preview
      </button>
      <span className="mt-2 max-w-[300px] font-mono text-[11px] break-words text-faint">{error.message}</span>
    </div>
  );
}

const Stage = memo(function Stage() {
  const project = useViewedDoc();
  const stage = useUi((s) => s.stage);
  const stageShape = useUi((s) => s.stageShape);
  // Another shape: the same edit at that shape's size, reframed (as export.formats renders it).
  const doc = useMemo<ProjectDoc>(
    () =>
      stageShape
        ? {
            ...project,
            meta: {
              ...project.meta,
              format: { ...project.meta.format, ...shapeSize(project.meta.format, stageShape) },
            },
          }
        : project,
    [project, stageShape],
  );
  const ref = useRef<PlayerRef>(null);
  const meta = compositionMeta(doc);
  // The doc is immutable, so this identity only changes when the project does.
  const inputProps = useMemo(() => ({ doc, mediaBase: MEDIA_BASE }), [doc]);

  /*
   * The player stops for good when a frame throws (a bad value in an edit). It comes back on its own as
   * soon as the edit changes (the undo, the next request, a fixed value), or from its Reload button,
   * remounted where it was.
   */
  const [attempt, setAttempt] = useState(0);
  const [crashedOn, setCrashedOn] = useState<ProjectDoc | null>(null);
  const [crash, setCrash] = useState<Error | null>(null);
  const reload = () => {
    setCrashedOn(null);
    setCrash(null);
    setAttempt((a) => a + 1);
  };
  if (crashedOn && crashedOn !== doc) reload();

  useEffect(() => {
    const detach = attachPlayer(ref.current);
    // Back where it was before it was reloaded.
    if (attempt > 0) ref.current?.seekTo(playback.getState().frame);
    return detach;
  }, [attempt]);
  useEffect(() => {
    playback.setState({ fps: meta.fps, durationInFrames: meta.durationInFrames });
  }, [meta.fps, meta.durationInFrames]);

  return (
    // ⌥-click anywhere on the video points at that spot (no Point button first, and it doesn't depend
    // on having seen the key go down).
    <div
      onClickCapture={(e) => {
        // ⌥ held, or armed by the timeline's Mark button (one point, then it's off).
        if (!(e.altKey || useUi.getState().marking) || stage === "cover") return;
        // The box that opens at a point (its text, Comment, Do it) keeps its own clicks.
        if ((e.target as Element).closest("[data-point-popover]")) return;
        e.stopPropagation();
        if (!e.altKey) setUi({ marking: false });
        pointAt(e);
      }}
      className="relative overflow-hidden rounded-[22px] bg-black shadow-[0_0_0_1px_#2a2a30]"
      // As tall as fits, but never wider than the column (a 16:9 shape is wide).
      style={{
        aspectRatio: `${meta.width} / ${meta.height}`,
        width: `min(100cqw, calc(min(100cqh - 84px, 900px) * ${(meta.width / meta.height).toFixed(4)}))`,
      }}
    >
      {stage === "cover" ? (
        <Player
          acknowledgeRemotionLicense
          component={CoverComposition}
          inputProps={inputProps}
          durationInFrames={1}
          compositionWidth={meta.width}
          compositionHeight={meta.height}
          fps={meta.fps}
          style={{ width: "100%", height: "100%", isolation: "isolate" }}
          clickToPlay={false}
          doubleClickToFullscreen={false}
          spaceKeyToPlayOrPause={false}
        />
      ) : null}
      <Player
        key={attempt}
        acknowledgeRemotionLicense
        ref={ref}
        component={VideoComposition}
        numberOfSharedAudioTags={AUDIO_TAGS}
        inputProps={inputProps}
        durationInFrames={meta.durationInFrames}
        compositionWidth={meta.width}
        compositionHeight={meta.height}
        fps={meta.fps}
        // Isolated, so nothing inside the video (a graphic's or transition's z-index) can rise above the
        // overlay and swallow a Point click.
        style={{
          width: "100%",
          height: "100%",
          isolation: "isolate",
          ...(stage === "cover" && { position: "absolute", inset: 0, visibility: "hidden" }),
        }}
        loop
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        moveToBeginningWhenEnded
        bufferStateDelayInMilliseconds={300}
        errorFallback={({ error }) => (
          <StageCrashed
            error={error}
            onCrash={(e) => {
              setCrashedOn(doc);
              setCrash(e);
            }}
          />
        )}
      />
      <Overlay />
      {crash && <StageError error={crash} onReload={reload} />}
    </div>
  );
});

/** Points at where the video was clicked: the spot and the moment, for the next request or a comment. */
function pointAt(e: React.MouseEvent<HTMLElement>): void {
  const r = e.currentTarget.getBoundingClientRect();
  const point = {
    x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000,
    y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000,
  };
  pause();
  setUi({ pointer: { point, time: currentTime() }, pointing: false });
}

function Overlay() {
  const safeZones = useUi((s) => s.safeZones);
  const pointing = useUi((s) => s.pointing);
  const marking = useUi((s) => s.marking);
  const pointer = useUi((s) => s.pointer);
  const cover = useUi((s) => s.stage === "cover");
  // ⌥ held points too, without the Point button first (not on the cover: it's a still, not a moment).
  const armed = pointing || (marking && !cover);
  const portrait = usePortrait();

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pointing) pointAt(e);
  };

  return (
    <div
      className={clsx("absolute inset-0 z-10", armed ? "cursor-crosshair" : "pointer-events-none")}
      onClick={onClick}
    >
      {!cover && <SceneLabel />}
      {safeZones && portrait && <SafeZones />}
      {!cover && <CommentPins />}
      {pointer && <PointPopover />}
      {armed && !pointer && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span className="rounded-md bg-black/70 px-2 py-1 text-[11px] text-fg">
            Click the spot you mean
          </span>
        </div>
      )}
    </div>
  );
}

/** The platform's buttons and captions are a phone-screen thing: none over a square or wide shape. */
const usePortrait = () =>
  useUi((s) => s.stageShape === null || s.stageShape === "9:16" || s.stageShape === "4:5");

const PLATFORM_NAMES = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts", youtube: "YouTube", none: "" };

/** Where the project's platform (checks.json) draws its own UI over the video. None for YouTube or none. */
function SafeZones() {
  const platform = useDoc((d) => d.checkRules.platform);
  const own = useDoc((d) => d.checkRules.safeZone);
  const zone = own ?? safeZoneFor(platform);
  if (zone.bottom >= 1 && zone.right >= 1) return null;
  const rail = Math.min(safeZoneFor(platform).rail, zone.bottom);
  const dashed = "border-white/35 bg-black/[0.12]";
  return (
    <>
      {zone.top > 0 && (
        <div
          className={`absolute inset-x-0 top-0 border-b border-dashed ${dashed}`}
          style={{ height: `${zone.top * 100}%` }}
        />
      )}
      <div
        className={`absolute right-0 border-l border-dashed ${dashed}`}
        style={{
          top: `${rail * 100}%`,
          bottom: `${(1 - zone.bottom) * 100}%`,
          width: `${(1 - zone.right) * 100}%`,
        }}
      />
      <div
        className={`absolute inset-x-0 bottom-0 flex items-end border-t border-dashed px-3 py-2 font-mono text-[10px] text-white/80 ${dashed}`}
        style={{ height: `${(1 - zone.bottom) * 100}%` }}
      >
        {PLATFORM_NAMES[platform]} UI zone
      </div>
    </>
  );
}

/** "sc4 · clip_07 · beach": which shot is on screen. Updates only when the shot changes. */
function SceneLabel() {
  const doc = useViewedDoc();
  const [label, setLabel] = useState("");
  useFrameEffect((frame, s) => {
    const placed = sceneAt(timelineOf(doc), frame / s.fps);
    const src = placed && doc.sources.find((x) => x.id === placed.scene.source);
    setLabel(placed ? `${placed.scene.id} · ${src?.label ?? "missing"}` : "");
  });
  if (!label) return null;
  return (
    <div className="absolute top-3 left-3 rounded-[5px] bg-black/55 px-[7px] py-[3px] font-mono text-[10px] text-[#e4e4e7]">
      {label}
    </div>
  );
}

/** Comments with a point, shown on the frame while their moment plays. */
function CommentPins() {
  const doc = useViewedDoc();
  const [visible, setVisible] = useState<readonly Comment[]>([]);
  useFrameEffect((frame, s) => {
    const t = frame / s.fps;
    const tl = timelineOf(doc);
    const next = doc.comments.filter((c) => {
      if (!c.point || c.status === "resolved") return false;
      const at = resolveAnchor(tl, c.anchor);
      return at !== null && Math.abs(at - t) < 0.75;
    });
    setVisible((prev) => (prev.length === next.length && prev.every((c, i) => c === next[i]) ? prev : next));
  });
  return (
    <>
      {visible.map((c) => (
        <div
          key={c.id}
          className="absolute animate-fade-in"
          style={{ left: `${c.point!.x * 100}%`, top: `${c.point!.y * 100}%` }}
        >
          <div className="-translate-x-1/2 -translate-y-1/2 size-[30px] rounded-full border-2 border-accent" />
          <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-[7px] border border-accent bg-bg px-2 py-1 text-[11px] whitespace-nowrap text-fg">
            {c.text}
          </div>
        </div>
      ))}
    </>
  );
}

/** Pointed at a spot: leave a comment there, or tell the agent what to do there. */
function PointPopover() {
  const pointer = useUi((s) => s.pointer)!;
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const { x, y } = pointer.point;
  const below = y < 0.7;

  const empty = !text.trim();
  const comment = () => {
    if (empty) return input.current?.focus();
    const doc = useProject.getState().doc!;
    const anchor = anchorAt(timelineOf(doc), pointer.time);
    if (!anchor) return toast("There's no shot at this moment to pin a comment to.", "warn");
    edit([
      {
        op: "insert",
        coll: "comments",
        item: { id: newId("cm"), anchor, point: pointer.point, text: text.trim(), status: "open" },
      },
    ]);
    setUi({ pointer: null });
    // A comment just pinned shows where it went.
    setCommentsOpen(true);
  };
  const instruct = () => {
    if (empty) return input.current?.focus();
    void send(text, { time: pointer.time, point: pointer.point });
    setUi({ pointer: null });
  };

  return (
    <>
      <div
        className="pointer-events-none absolute size-[30px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/10"
        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      />
      <div
        data-point-popover
        className={clsx(
          "pointer-events-auto absolute w-[230px] rounded-[10px] border border-accent bg-bg p-2 shadow-xl animate-rise",
        )}
        // Centered on the point, but never past the frame's edges.
        style={{
          left: `clamp(8px, calc(${x * 100}% - 115px), calc(100% - 238px))`,
          ...(below ? { top: `calc(${y * 100}% + 22px)` } : { bottom: `calc(${(1 - y) * 100}% + 22px)` }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setUi({ pointer: null });
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) instruct();
              else comment();
            }
          }}
          placeholder="Zoom here when he laughs"
          aria-label="Comment or instruction for this spot"
          className="w-full bg-transparent px-1 pb-2 text-[13px] text-fg outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted">{formatTime(pointer.time, true)}</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={comment}
              disabled={empty}
              title={empty ? "Type a note first" : "Pin this note here (↵)"}
              className="h-6 rounded-md bg-control px-2 text-[11px] text-fg-2 hover:bg-selected disabled:opacity-40"
            >
              Comment
            </button>
            <button
              type="button"
              onClick={instruct}
              disabled={empty}
              title={empty ? "Type what should happen first" : `Ask the agent to do it here (${mod}↵)`}
              className="h-6 rounded-md bg-accent px-2 text-[11px] font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-40"
            >
              Do it
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Transport() {
  const playing = usePlayback((s) => s.playing);
  const safeZones = useUi((s) => s.safeZones);
  const timeRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  useFrameEffect((frame, s) => {
    if (timeRef.current) timeRef.current.textContent = formatTime(frame / s.fps, true);
    if (totalRef.current) totalRef.current.textContent = `/ ${formatTime(s.durationInFrames / s.fps, true)}`;
  });
  return (
    <div className="flex items-center gap-3.5 font-mono text-xs text-muted tabular">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={togglePlay}
        className="flex size-9 items-center justify-center rounded-full bg-fg text-bg hover:bg-fg-2"
      >
        {playing ? (
          <PauseIcon size={14} weight="fill" />
        ) : (
          <PlayIcon size={14} weight="fill" className="ml-0.5" />
        )}
      </button>
      <span ref={timeRef} className="w-[52px] text-right text-fg" />
      <span ref={totalRef} />
      <IconButton
        label={safeZones ? "Hide safe zones (G)" : "Show safe zones (G)"}
        onClick={() => setUi((s) => ({ safeZones: !s.safeZones }))}
      >
        {safeZones ? <EyeIcon size={15} /> : <EyeSlashIcon size={15} />}
      </IconButton>
      <PlatformPicker />
    </div>
  );
}

/** Whose app to see the video in: its buttons and captions drawn over the preview, and kept clear by the checks. */
function PlatformPicker() {
  const rules = useDoc((d) => d.checkRules);
  const shown = useUi((s) => s.safeZones);
  const portrait = usePortrait();
  if (!portrait) return null;
  const pick = (platform: (typeof PHONE_PLATFORMS)[number]) => {
    if (platform !== rules.platform || rules.safeZone)
      edit([{ op: "set", key: "checkRules", value: platformRules(rules, platform) }], {
        message: `Safe area: ${PLATFORM_NAMES[platform]}`,
      });
    setUi({ safeZones: true });
  };
  return (
    <fieldset className="m-0 flex gap-0.5 border-0 p-0" aria-label="Safe area for">
      {PHONE_PLATFORMS.map((p) => {
        const on = shown && rules.platform === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            title={`See where the ${PLATFORM_NAMES[p]} app covers the video`}
            onClick={() => pick(p)}
            className={clsx(
              "rounded-md px-2 py-0.5 text-[11px]",
              on ? "bg-button text-fg" : "text-muted hover:text-fg",
            )}
          >
            {PLATFORM_NAMES[p]}
          </button>
        );
      })}
    </fieldset>
  );
}
