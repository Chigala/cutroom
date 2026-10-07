/**
 * The slim timeline. Blocks are positioned in seconds and scaled with one number (px per second), the
 * playhead moves by transform outside React, and items the agent just touched are outlined so you can
 * see exactly what it changed.
 */

import { IntersectIcon } from "@phosphor-icons/react";
import {
  type Anchor,
  anchorAt,
  audioPlan,
  type Collection,
  formatTime,
  graphicMeta,
  outputOffset,
  PEAKS_PER_SECOND,
  type Source,
  sceneLength,
  spanOf,
  spokenWords,
  type Timeline as TL,
  timelineOf,
  trimSceneOps,
} from "@vedit/project";
import { clsx } from "clsx";
import {
  createContext,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isMac } from "../../lib/keys.ts";
import { peaksOf } from "../../state/jobs.ts";
import { pause, playback, seekTime, useFrameEffect } from "../../state/playback.ts";
import { DraftViewContext, edit, useDoc, useDraftShown, useProject } from "../../state/project.ts";
import { fitTimeline, setRange, useTimeline, zoomBy, zoomTo } from "../../state/timeline.ts";
import { composerRef, select, setUi, useUi } from "../../state/ui.ts";
import { AddMenu } from "./AddMenu.tsx";

const LABEL_W = 88;

/** The horizontal scroll, in px, that every row's contents shift by (zoomed in). */
const View = createContext({ offset: 0 });

/** The timeline shows the agent's live draft while it works (view only then), or the project. */
export function Timeline() {
  return (
    <DraftViewContext.Provider value={true}>
      <TimelineBody />
    </DraftViewContext.Provider>
  );
}

function TimelineBody() {
  const draftShown = useDraftShown();
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const tl = useDoc(timelineOf);
  const { zoom, start: viewStart, range } = useTimeline();
  const marking = useUi((s) => s.marking);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitPps = tl.duration > 0 && width > 0 ? width / tl.duration : 0;
  const pps = fitPps * zoom;
  const maxStart = pps ? Math.max(0, tl.duration - width / pps) : 0;
  const start = Math.min(viewStart, maxStart);
  const offset = start * pps;
  useEffect(() => useTimeline.setState({ fitPps, width }), [fitPps, width]);

  // Pinch or ⌘-scroll zooms around the pointer; scrolling moves along when zoomed in.
  const live = useRef({ fitPps, maxStart, pps, start });
  live.current = { fitPps, maxStart, pps, start };
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = live.current;
      const rect = track.current?.getBoundingClientRect();
      if (!v.fitPps || !rect) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const { zoom: z } = useTimeline.getState();
        zoomTo(z * Math.exp(-e.deltaY * 0.012), { time: v.start + x / v.pps, x }, v.fitPps);
        return;
      }
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d || v.maxStart <= 0) return;
      e.preventDefault();
      useTimeline.setState({ start: Math.max(0, Math.min(v.maxStart, v.start + d / v.pps)) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /**
   * ⌥ held, anywhere on the timeline: a drag marks a stretch, a click marks that frame. Either goes to
   * the chat with the next request, and the text bar takes the typing.
   */
  // The click that ends a mark isn't also a click on what's under it (a shot would get selected, a word
  // would seek away from the frame).
  const marked = useRef(false);
  const mark = (e: React.PointerEvent) => {
    marked.current = false;
    if (!(e.altKey || useUi.getState().marking) || !pps || e.button !== 0) return;
    // Only on the tracks themselves: + Add, the zoom and Mark buttons, a selection's × stay buttons.
    if (!(e.target as Element).closest("[data-track]")) return;
    // Armed by the Mark button, it's one mark at a time.
    if (!e.altKey) setUi({ marking: false });
    e.stopPropagation();
    marked.current = true;
    const rect = track.current!.getBoundingClientRect();
    const at = (x: number) => Math.max(0, Math.min(tl.duration, (x - rect.left + offset) / pps));
    const t0 = at(e.clientX);
    pause();
    seekTime(t0);
    setRange({ start: t0, end: t0 });
    const move = (ev: PointerEvent) => {
      const t1 = at(ev.clientX);
      setRange({ start: Math.min(t0, t1), end: Math.max(t0, t1) });
    };
    const up = () => {
      composerRef.current?.focus();
    };
    follow(move, up);
  };

  // Click or drag on empty track space to scrub.
  const scrub = (e: React.PointerEvent) => {
    if (!pps || e.button !== 0) return;
    const rect = track.current!.getBoundingClientRect();
    const go = (x: number) => seekTime(Math.max(0, Math.min(tl.duration, (x - rect.left + offset) / pps)));
    pause();
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => {};
    follow(move, up);
  };

  return (
    <View.Provider value={{ offset }}>
      <section
        ref={section}
        onPointerDownCapture={mark}
        onClickCapture={(e) => {
          if (!marked.current) return;
          marked.current = false;
          e.stopPropagation();
        }}
        className={clsx(
          "relative h-[264px] shrink-0 overflow-hidden border-t border-line bg-track px-6 py-3",
          marking && "cursor-crosshair [&_*]:cursor-crosshair",
        )}
        aria-label="Timeline"
      >
        <div className="flex h-full flex-col gap-1">
          <Row label={<AddMenu />}>
            <Ruler duration={tl.duration} pps={pps} start={start} width={width} track={track} />
          </Row>
          {/* The draft is only to watch: its items aren't in the project yet. Scrubbing still works. */}
          <div
            className={clsx("flex min-h-0 flex-1 flex-col gap-1", draftShown && "[&_*]:pointer-events-none")}
            onPointerDown={scrub}
          >
            <Row label="Video" trackRef={track} tall>
              {pps > 0 && <VideoTrack tl={tl} pps={pps} />}
            </Row>
            <Row label="Words" short>
              {pps > 0 && <WordsTrack pps={pps} start={start} width={width} />}
            </Row>
            <Row label="Titles">{pps > 0 && <AnchoredTrack coll="titles" tl={tl} pps={pps} />}</Row>
            <Row label="Graphics">{pps > 0 && <AnchoredTrack coll="visuals" tl={tl} pps={pps} />}</Row>
            <Row label="Captions">{pps > 0 && <AnchoredTrack coll="captions" tl={tl} pps={pps} />}</Row>
            <Row label="Motion">
              {pps > 0 && (
                <>
                  <AnchoredTrack coll="zooms" tl={tl} pps={pps} />
                  <AnchoredTrack coll="effects" tl={tl} pps={pps} />
                </>
              )}
            </Row>
            <Row label="Sound">{pps > 0 && <AnchoredTrack coll="sfx" tl={tl} pps={pps} />}</Row>
            <Row label="Music">
              {pps > 0 && (
                <>
                  <MusicTrack tl={tl} pps={pps} />
                  {/* More songs placed in the cut, and stretches where the main music changes level. */}
                  <AnchoredTrack coll="musicClips" tl={tl} pps={pps} />
                  <AnchoredTrack coll="musicCues" tl={tl} pps={pps} />
                </>
              )}
            </Row>
          </div>
        </div>
        {range && pps > 0 && <RangeBand range={range} pps={pps} offset={offset} width={width} />}
        {marking && (
          <span className="pointer-events-none absolute top-2.5 left-1/2 z-30 -translate-x-1/2 rounded-md bg-black/80 px-2.5 py-1 text-[11px] text-fg animate-fade-in">
            Drag to mark a stretch · click to mark a frame · click the video to point
          </span>
        )}
        {draftShown && (
          <span
            title="The agent's draft, to watch. Switch to your project on the preview to edit."
            className="absolute top-2.5 left-1/2 -translate-x-1/2 rounded-md bg-accent/15 px-2 py-0.5 font-mono text-[10px] text-accent animate-fade-in"
          >
            Draft
          </span>
        )}
        <ZoomControls zoom={zoom} />
        <Playhead pps={pps} offset={offset} width={width} start={start} />
      </section>
    </View.Provider>
  );
}

/** Zoom out, fit, zoom in; and how much is showing. */
function ZoomControls({ zoom }: { zoom: number }) {
  const at = () => playback.getState().frame / playback.getState().fps;
  const btn =
    "flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[11px] text-muted hover:bg-button hover:text-fg-2 disabled:opacity-30";
  return (
    <div className="absolute top-2.5 right-6 flex items-center gap-0.5 rounded-md bg-track/90 font-mono">
      <MarkButton />
      <span className="mx-1 h-3 w-px bg-line-strong" />
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out (-)"
        disabled={zoom <= 1}
        onClick={() => zoomBy(1 / 1.6, at())}
        className={btn}
      >
        −
      </button>
      <button
        type="button"
        title="Fit the whole video (Z)"
        disabled={zoom <= 1}
        onClick={fitTimeline}
        className={clsx(btn, "text-[10px]")}
      >
        {zoom <= 1 ? "Fit" : `${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×`}
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title={`Zoom in (+, or pinch / ${isMac ? "⌘" : "Ctrl"}-scroll)`}
        onClick={() => zoomBy(1.6, at())}
        className={btn}
      >
        +
      </button>
    </div>
  );
}

/**
 * Follows a drag until the button comes up, or until the drag is lost (released outside the window,
 * ⌘-Tab away): without that, a lost drag kept tracking until the next click.
 */
function follow(move: (e: PointerEvent) => void, up: () => void): void {
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", end);
    up();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", end);
}

const ALT = isMac ? "⌥" : "Alt";

/**
 * The ⌥ shortcut, where people look for timeline tools: it says what holding ⌥ does, and a click arms
 * the same marking for one click or drag (for a trackpad, or before you've learned the key).
 */
function MarkButton() {
  const marking = useUi((s) => s.marking);
  return (
    <button
      type="button"
      aria-pressed={marking}
      title={`Hold ${ALT} (or click here), then click the timeline to mark a frame, drag to mark a stretch, or click the video to point at something. Then ask in the chat about it.`}
      onClick={() => setUi({ marking: !marking })}
      className={clsx(
        "flex h-[18px] items-center gap-1 rounded px-1.5 text-[10px]",
        marking ? "bg-accent text-accent-fg" : "text-muted hover:bg-button hover:text-fg-2",
      )}
    >
      <span className="[font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif]">{ALT}</span>
      <span className="font-sans">Mark</span>
    </button>
  );
}

/**
 * A stretch selected on the ruler, shaded across every row. It goes to the agent with the next
 * request ("tighten this", "add a meme here"); Escape or × clears it.
 */
function RangeBand({
  range,
  pps,
  offset,
  width,
}: {
  range: { start: number; end: number };
  pps: number;
  offset: number;
  width: number;
}) {
  const a = Math.max(0, range.start * pps - offset);
  const b = Math.min(width, range.end * pps - offset);
  if (b < 0 || a > width) return null;
  const left = 24 + LABEL_W + a;
  // A frame: the moment, as a line.
  const frame = range.end - range.start < 0.05;
  return (
    <>
      <div
        className={clsx(
          "pointer-events-none absolute top-[34px] bottom-2.5",
          frame ? "w-0.5 bg-accent" : "border-x border-accent/70 bg-accent/12",
        )}
        style={{ left, ...(!frame && { width: Math.max(1, b - a) }) }}
      />
      <div
        className="absolute top-[34px] z-20 flex -translate-y-1/2 items-center gap-1 rounded-md bg-accent py-px pr-0.5 pl-1.5 font-mono text-[10px] whitespace-nowrap text-accent-fg shadow"
        style={{ left: left + 2 }}
      >
        {frame
          ? `Frame ${formatTime(range.start, true)}`
          : `${formatTime(range.start, true)}–${formatTime(range.end, true)}`}
        <span className="font-sans opacity-80">· ask in the chat</span>
        <button
          type="button"
          aria-label="Clear the selection"
          onClick={() => setRange(null)}
          className="rounded px-0.5 hover:bg-black/15"
        >
          ×
        </button>
      </div>
    </>
  );
}

/**
 * What's said, word by word under the shots, once zoomed in enough to read it: corrections as
 * captioned, emphasis in the accent, words left out of the captions struck through. A click goes there.
 */
const WordsTrack = memo(function WordsTrack({
  pps,
  start,
  width,
}: {
  pps: number;
  start: number;
  width: number;
}) {
  const words = useDoc(spokenWords);
  const { offset } = useContext(View);
  if (!words.length) return null;
  if (pps < 40)
    return (
      <span
        className="absolute top-0 truncate text-[10px] leading-4 text-faint"
        style={{ left: offset + 2, width }}
      >
        Zoom in to read the words (pinch, {isMac ? "⌘" : "Ctrl"}-scroll or +)
      </span>
    );
  const end = start + width / pps;
  return (
    <>
      {words
        .filter((w) => w.end >= start && w.start <= end)
        .map((w) => (
          <button
            key={w.ref}
            type="button"
            title={w.text === w.heard ? w.text : `${w.text} (heard "${w.heard}")`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => seekTime(w.start)}
            className={clsx(
              "absolute top-0 h-4 overflow-hidden rounded-sm px-0.5 text-left text-[10px] leading-4 whitespace-nowrap hover:bg-selected",
              w.hidden
                ? "text-faint line-through"
                : w.emphasis
                  ? "bg-accent/15 text-accent"
                  : "bg-chip/70 text-fg-2",
            )}
            style={{ left: w.start * pps, width: Math.max(3, (w.end - w.start) * pps - 1) }}
          >
            {w.text}
          </button>
        ))}
    </>
  );
});

function Row({
  label,
  children,
  trackRef,
  tall,
  short,
}: {
  label: ReactNode;
  children: ReactNode;
  trackRef?: React.Ref<HTMLDivElement>;
  tall?: boolean;
  short?: boolean;
}) {
  const { offset } = useContext(View);
  return (
    <div className={clsx("flex shrink-0 items-center", tall ? "h-[38px]" : short ? "h-4" : "h-[22px]")}>
      <div className="shrink-0 font-mono text-[11px] text-muted" style={{ width: LABEL_W }}>
        {label}
      </div>
      <div ref={trackRef} data-track className="relative h-full flex-1 overflow-hidden">
        <div className="absolute inset-0" style={{ transform: `translateX(${-offset}px)` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Seconds as the ruler shows them: "0:12", or "0:12.5" when zoomed in to fractions. */
const tick = (t: number, fine: boolean) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}${fine ? `.${Math.round((t % 1) * 10) % 10}` : ""}`;

/** Time marks for what's in view; drag along it to select a stretch for the agent, click to go there. */
const Ruler = memo(function Ruler({
  duration,
  pps,
  start,
  width,
  track,
}: {
  duration: number;
  pps: number;
  start: number;
  width: number;
  track: React.RefObject<HTMLDivElement | null>;
}) {
  if (!pps) return null;
  // Steps that read exactly at one decimal (no 0.25s: it would print as 0.3).
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 64) ?? 300;
  const ticks: number[] = [];
  // The zoom buttons sit over the ruler's right end: no marks under them.
  const last = Math.min(duration, start + Math.max(0, width - 76) / pps);
  for (let t = Math.floor(start / step) * step; t <= last + 1e-6; t += step)
    if (t >= 0) ticks.push(Math.round(t * 100) / 100);
  const select = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    const at = (x: number) => Math.max(0, Math.min(duration, start + (x - rect.left) / pps));
    const t0 = at(e.clientX);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const t1 = at(ev.clientX);
      if (Math.abs(t1 - t0) * pps < 4 && !moved) return;
      moved = true;
      setRange({ start: Math.min(t0, t1), end: Math.max(t0, t1) });
    };
    const up = () => {
      if (!moved) {
        pause();
        seekTime(t0);
      } else composerRef.current?.focus();
    };
    follow(move, up);
  };
  return (
    <div
      className="absolute inset-y-0 cursor-col-resize"
      style={{ left: 0, width: duration * pps }}
      onPointerDown={select}
      title="Drag to select a stretch, then ask the agent about it"
    >
      {ticks.map((t) => (
        <span
          key={t}
          className="pointer-events-none absolute top-1 font-mono text-[10px] text-[#8a8a93] tabular"
          style={{ left: Math.min(t * pps, Math.max(0, duration * pps - 30)) }}
        >
          {tick(t, step < 1)}
        </span>
      ))}
    </div>
  );
});

const VideoTrack = memo(function VideoTrack({ tl, pps }: { tl: TL; pps: number }) {
  const sources = useDoc((d) => d.sources);
  const touched = useProject((s) => s.agentTouched);
  const selected = useUi((s) => s.selectedScene);
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  return (
    <>
      {tl.scenes.map((p) => (
        <SceneBlock
          key={p.scene.id}
          placed={p}
          source={byId.get(p.scene.source)}
          pps={pps}
          touched={touched.has(p.scene.id)}
          selected={selected === p.scene.id}
        />
      ))}
      <SoundPlan tl={tl} pps={pps} />
      <Highlights tl={tl} pps={pps} />
    </>
  );
});

/**
 * Each shot's sound, as a thin bar along the bottom of the video track, from where it takes over to
 * where it hands on (audioPlan, the same plan preview and export play). A J or L cut shows as sound
 * running past its picture's edge, drawn in the accent; crossfades fade the bar's ends.
 */
const SoundPlan = memo(function SoundPlan({ tl, pps }: { tl: TL; pps: number }) {
  const spans = useMemo(() => audioPlan(tl), [tl]);
  return (
    <>
      {spans.map((s) => {
        const { placed } = s;
        const split = s.from < placed.start - 0.01 || s.to > placed.start + placed.duration + 0.01;
        const width = Math.max(1, (s.to - s.from) * pps);
        const fade = (sec: number) => `${Math.min(50, ((sec / 2) * pps * 100) / width)}%`;
        return (
          <span
            key={placed.scene.id}
            title={
              split
                ? `${placed.scene.id}'s sound ${s.from < placed.start ? "leads in early (J cut)" : ""}${
                    s.from < placed.start && s.to > placed.start + placed.duration ? " and " : ""
                  }${s.to > placed.start + placed.duration ? "carries on (L cut)" : ""}`
                : undefined
            }
            className={clsx(
              "pointer-events-none absolute bottom-0 h-[3px] rounded-full",
              split ? "bg-accent" : "bg-white/25",
            )}
            style={{
              left: s.from * pps,
              width,
              maskImage: `linear-gradient(90deg, transparent, #000 ${fade(s.fadeIn)}, #000 calc(100% - ${fade(
                s.fadeOut,
              )}), transparent)`,
            }}
          />
        );
      })}
    </>
  );
});

/** Standout moments indexing found in the shots of the cut (★ in the shot log), as small stars. */
const Highlights = memo(function Highlights({ tl, pps }: { tl: TL; pps: number }) {
  const logs = useDoc((d) => d.shotLogs);
  const stars = useMemo(() => {
    const byId = new Map(logs.map((l) => [l.id, l]));
    return tl.scenes.flatMap(({ scene, start }) =>
      (byId.get(scene.source)?.segments ?? [])
        .filter((g) => g.highlight && g.end > scene.in && g.start < scene.out)
        .map((g) => ({
          key: `${scene.id}:${g.start}`,
          at: start + outputOffset(scene, Math.max(0, g.start - scene.in)),
          what: g.what,
        })),
    );
  }, [tl, logs]);
  return (
    <>
      {stars.map((s) => (
        <span
          key={s.key}
          title={`★ ${s.what}`}
          className="pointer-events-none absolute top-[15px] text-[10px] leading-none text-accent drop-shadow"
          style={{ left: s.at * pps + 2 }}
        >
          ★
        </span>
      ))}
    </>
  );
});

/**
 * One shot on the video track: its color, its waveform, and handles on both edges to trim it. Dragging
 * a handle previews by resizing the element directly; the edit commits once, on release.
 */
const SceneBlock = memo(function SceneBlock({
  placed,
  source,
  pps,
  touched,
  selected,
}: {
  placed: TL["scenes"][number];
  source: Source | undefined;
  pps: number;
  touched: boolean;
  selected: boolean;
}) {
  const { scene, start, duration } = placed;
  const ref = useRef<HTMLDivElement>(null);
  const width = Math.max(2, duration * pps - 2);
  const trimmable = source?.kind === "video" || source?.kind === "audio";

  const trim = (edge: "in" | "out") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = ref.current!;
    const x0 = e.clientX;
    // What React set: put back exactly this on release (clearing it would leave the block with no width).
    const restore = { width: el.style.width, transform: el.style.transform };
    // Dragging moves output time; a shot at 2x covers two seconds of footage per second on screen.
    // A ramped shot drags by its average speed.
    const speed = scene.ramp?.length
      ? (scene.out - scene.in) / Math.max(0.01, sceneLength(scene))
      : (scene.speed ?? 1);
    const length = scene.out - scene.in;
    let dt = 0;
    const max = trimmable ? source!.duration : Infinity;
    const move = (ev: PointerEvent) => {
      const raw = ((ev.clientX - x0) / pps) * speed;
      dt =
        edge === "in"
          ? Math.max(-scene.in, Math.min(raw, length - 0.1 * speed))
          : Math.max(-(length - 0.1 * speed), Math.min(raw, max - scene.out));
      const px = (dt / speed) * pps;
      if (edge === "in") {
        el.style.transform = `translateX(${px}px)`;
        el.style.width = `${Math.max(2, width - px)}px`;
      } else el.style.width = `${Math.max(2, width + px)}px`;
    };
    const up = () => {
      el.style.transform = restore.transform;
      el.style.width = restore.width;
      if (Math.abs(dt) < 0.02) return;
      const doc = useProject.getState().doc!;
      const ops =
        edge === "in"
          ? trimSceneOps(doc, scene.id, scene.in + dt, scene.out)
          : trimSceneOps(doc, scene.id, scene.in, scene.out + dt);
      edit(ops, { message: `Trimmed ${scene.id}` });
    };
    follow(move, up);
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        // The playhead goes where you click, so S splits right there.
        const r = e.currentTarget.getBoundingClientRect();
        seekTime(start + Math.max(0, Math.min(duration, (e.clientX - r.left) / pps)));
        select({ coll: "scenes", id: scene.id });
      }}
      title={scene.note || scene.id}
      className={clsx(
        "group absolute top-0 h-full overflow-hidden rounded border-[1.5px]",
        touched ? "border-accent" : selected ? "border-fg-3" : "border-transparent",
      )}
      style={{ left: start * pps, width, backgroundColor: source?.color ?? "#2c2c34" }}
    >
      {source?.hasAudio && <Waveform source={source.id} from={scene.in} to={scene.out} />}
      {scene.transition && (
        // How this shot comes in from the one before it (transitions/<kind>.css).
        <span
          title={`${scene.transition.kind}, ${scene.transition.duration}s, from the shot before`}
          className="pointer-events-none absolute bottom-0.5 left-1 flex items-center gap-0.5 rounded bg-black/60 px-1 font-mono text-[9px] whitespace-nowrap text-accent"
        >
          <IntersectIcon size={9} /> {scene.transition.kind}
        </span>
      )}
      <span className="pointer-events-none absolute top-0.5 left-[5px] font-mono text-[10px] whitespace-nowrap text-[#e4e4e7] drop-shadow">
        {scene.id}
      </span>
      {width > 14 && (
        <>
          <span
            onPointerDown={trim("in")}
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/25"
          />
          <span
            onPointerDown={trim("out")}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/25"
          />
        </>
      )}
    </div>
  );
});

/** The clip's loudness under the shot, drawn once per size into a canvas. */
function Waveform({ source, from, to }: { source: string; from: number; to: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Uint8Array | null>(null);
  const status = useDoc((d) => d.sources.find((s) => s.id === source)?.status);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when indexing finishes (status changes)
  useEffect(() => {
    let alive = true;
    void peaksOf(source).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [source, status]);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || !peaks) return;
    const draw = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
      const g = el.getContext("2d")!;
      g.scale(dpr, dpr);
      g.fillStyle = "rgba(255,255,255,0.32)";
      const a = Math.floor(from * PEAKS_PER_SECOND);
      const b = Math.ceil(to * PEAKS_PER_SECOND);
      const span = Math.max(1, b - a);
      for (let x = 0; x < w; x++) {
        const i0 = a + Math.floor((x / w) * span);
        const i1 = a + Math.floor(((x + 1) / w) * span);
        let v = 0;
        for (let i = i0; i <= i1 && i < peaks.length; i++) v = Math.max(v, peaks[i]!);
        const bar = (v / 255) * (h - 4);
        g.fillRect(x, (h - bar) / 2 + 2, 1, Math.max(0.5, bar));
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [peaks, from, to]);

  if (!peaks) return null;
  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

type AnchoredColl = Extract<
  Collection,
  "titles" | "captions" | "zooms" | "sfx" | "visuals" | "effects" | "musicClips" | "musicCues"
>;

const STYLE: Record<AnchoredColl, string> = {
  titles: "bg-[#3b3420] text-[#f4e4c1]",
  visuals: "bg-[#26324a] text-[#d6e4ff]",
  captions: "bg-[#2c2c34] text-fg-2",
  zooms: "bg-[#2a2418] text-fg justify-center",
  effects: "bg-[#3a2430] text-[#ffd6e4] justify-center",
  sfx: "bg-[#1f2a33] text-fg justify-center",
  musicClips: "bg-[#24382f] text-[#d4f0e2]",
  musicCues: "bg-[#2f3a2a]/90 text-[#e2f0d4] justify-center",
};

/** What a block on the timeline says about its item. */
function blockLabel(
  coll: AnchoredColl,
  item: Record<string, unknown>,
  graphics: ReadonlyMap<string, string>,
): string {
  switch (coll) {
    case "zooms":
      return "Zoom";
    case "sfx":
      return String(item.name ?? item.source ?? "SFX");
    case "musicClips":
      return `♪ ${String(item.source ?? "")}`;
    case "musicCues":
      return `Music ×${Number(item.volume ?? 1).toFixed(2)}`;
    case "effects":
      return String(item.kind ?? "Effect");
    case "titles":
      return item.role === "hook" ? "Hook title" : String(item.text ?? "");
    case "visuals": {
      const content = item.content as { kind: string; graphic?: string; source?: string } | undefined;
      if (content?.kind === "graphic")
        return graphics.get(content.graphic ?? "") ?? content.graphic ?? "Graphic";
      return `Cutaway · ${content?.source ?? ""}`;
    }
    default:
      return String(item.text ?? "");
  }
}

const AnchoredTrack = memo(function AnchoredTrack({
  coll,
  tl,
  pps,
}: {
  coll: AnchoredColl;
  tl: TL;
  pps: number;
}) {
  const items = useDoc((d) => d[coll]) as readonly ({
    id: string;
    anchor: Anchor;
    duration?: number;
    whole?: boolean;
    until?: Anchor | "end";
  } & Record<string, unknown>)[];
  const touched = useProject((s) => s.agentTouched);
  const selected = useUi((s) => (s.selection?.coll === coll ? s.selection.id : null));
  const graphicsList = useDoc((d) => d.graphics);
  const graphics = useMemo(
    () => new Map(graphicsList.map((g) => [g.id, graphicMeta(g.html)?.name ?? g.id])),
    [graphicsList],
  );
  return (
    <>
      {items.map((item) => {
        const span = spanOf(tl, { ...item, duration: item.duration ?? 0.6 });
        if (!span) return null;
        const label = blockLabel(coll, item, graphics);
        return (
          <Draggable
            key={item.id}
            id={item.id}
            coll={coll}
            tl={tl}
            pps={pps}
            start={span.start}
            fixed={!!item.whole}
            width={Math.max(coll === "sfx" || coll === "effects" ? 34 : 18, (span.end - span.start) * pps)}
            className={clsx(
              STYLE[coll],
              selected === item.id
                ? "z-10 border-fg"
                : touched.has(item.id)
                  ? "border-accent"
                  : "border-[#4a4a52]/0",
            )}
          >
            {label}
          </Draggable>
        );
      })}
    </>
  );
});

/**
 * Drag a block to move it in time. It re-anchors to whatever shot it lands on. A fixed one (on for the
 * whole video) only selects.
 */
function Draggable({
  id,
  coll,
  tl,
  pps,
  start,
  fixed = false,
  width,
  className,
  children,
}: {
  id: string;
  coll: AnchoredColl;
  tl: TL;
  pps: number;
  start: number;
  fixed?: boolean;
  width: number;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);
    let dx = 0;
    const move = (ev: PointerEvent) => {
      if (fixed) return;
      dx = ev.clientX - x0;
      el.style.transform = `translateX(${dx}px)`;
    };
    const stop = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.style.transform = "";
    };
    // A drag the system takes away (a gesture, the window losing focus) puts the item back.
    const cancel = () => stop();
    const up = () => {
      stop();
      if (Math.abs(dx) < 3) {
        seekTime(start);
        select({ coll, id });
        return;
      }
      const t = Math.max(0, Math.min(tl.duration - 0.05, start + dx / pps));
      const anchor = anchorAt(tl, t);
      if (anchor) edit([{ op: "update", coll, id, patch: { anchor } }]);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
  };
  return (
    <button
      ref={ref}
      type="button"
      onPointerDown={onPointerDown}
      className={clsx(
        "absolute top-0 flex h-[22px] items-center overflow-hidden rounded border-[1.5px] px-1.5 text-[10px] whitespace-nowrap will-change-transform active:z-10 active:cursor-grabbing",
        className,
      )}
      style={{ left: start * pps, width }}
    >
      {children}
    </button>
  );
}

const MusicTrack = memo(function MusicTrack({ tl, pps }: { tl: TL; pps: number }) {
  const music = useDoc((d) => d.music);
  const source = useDoc((d) => (d.music.source ? d.sources.find((s) => s.id === d.music.source) : undefined));
  const analysis = useDoc((d) =>
    d.music.source ? d.analyses.find((a) => a.id === d.music.source) : undefined,
  );
  const speech = useDoc(spokenWords);
  // What plays: the section (or the track from offset), repeated when it loops.
  const from = music.section ? music.section.start : music.offset;
  const end = music.section ? music.section.end : (source?.duration ?? 0);
  const len = Math.max(0.1, end - from);
  const passes = music.loop ? Math.max(1, Math.ceil(tl.duration / len)) : 1;
  const beats = useMemo(
    () =>
      Array.from({ length: passes }, (_, k) =>
        (analysis?.beats ?? []).filter((b) => b >= from && b < end).map((b) => b - from + k * len),
      )
        .flat()
        .filter((b) => b < tl.duration),
    [analysis, from, end, len, passes, tl.duration],
  );
  const ducks = useMemo(() => {
    const spans: { start: number; end: number }[] = [];
    for (const w of speech) {
      const last = spans.at(-1);
      if (last && w.start - last.end < 0.3) last.end = w.end;
      else spans.push({ start: w.start, end: w.end });
    }
    return spans;
  }, [speech]);
  if (!source) {
    return (
      <div className="flex h-full items-center rounded border border-dashed border-line-strong px-2 text-[10px] text-faint">
        No music. Drop a song in, or ask for one.
      </div>
    );
  }
  return (
    <div
      className="absolute inset-y-0 left-0 overflow-hidden rounded bg-[#1f2c28]"
      style={{ width: tl.duration * pps }}
    >
      {Array.from({ length: passes }, (_, k) => {
        const width = Math.min(len, tl.duration - k * len);
        return (
          <div
            key={k}
            className={clsx("absolute inset-y-0", k > 0 && "border-l border-dashed border-[#7fb3a2]/60")}
            style={{ left: k * len * pps, width: width * pps }}
          >
            <Waveform source={source.id} from={from} to={from + width} />
          </div>
        );
      })}
      {music.duckUnderSpeech &&
        ducks.map((d, i) => (
          <div
            key={i}
            className="absolute inset-y-0 bg-black/35"
            style={{ left: d.start * pps, width: (d.end - d.start) * pps }}
          />
        ))}
      {beats.map((t) => (
        <div key={t} className="absolute bottom-0 h-[7px] w-px bg-[#5e8577]" style={{ left: t * pps }} />
      ))}
      <span className="absolute top-1 left-2 text-[10px] whitespace-nowrap text-[#cfe3da]">
        {music.label || source.label}
        {analysis?.bpm ? ` · ${Math.round(analysis.bpm)} BPM` : ""}
        {music.section ? ` · ${music.section.start.toFixed(1)}-${music.section.end.toFixed(1)}s` : ""}
        {passes > 1 ? ` · loops ×${passes}` : ""}
        {music.duckUnderSpeech ? " · ducks under speech" : ""}
      </span>
    </div>
  );
});

function Playhead({
  pps,
  offset,
  width,
  start,
}: {
  pps: number;
  offset: number;
  width: number;
  start: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const place = (t: number) => {
    const el = ref.current;
    if (!el) return;
    const x = t * pps - offset;
    el.style.transform = `translateX(${x}px)`;
    el.style.visibility = x < -1 || x > width + 1 ? "hidden" : "visible";
  };
  useFrameEffect((frame, s) => {
    const t = frame / s.fps;
    place(t);
    // Zoomed in: when the playhead leaves the view (playing on, or a jump), the view follows it.
    const seen = width / pps;
    if (pps && useTimeline.getState().zoom > 1 && (t < start || t > start + seen))
      useTimeline.setState({ start: Math.max(0, t - seen * 0.1) });
  });
  useLayoutEffect(() => place(playback.getState().frame / playback.getState().fps));
  if (!pps) return null;
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-2.5 bottom-2.5 z-10 w-0.5 bg-accent will-change-transform"
      style={{ left: 24 + LABEL_W - 1 }}
    >
      <div className="absolute -top-0.5 -left-1 size-2.5 rounded-[2px] bg-accent" />
    </div>
  );
}
