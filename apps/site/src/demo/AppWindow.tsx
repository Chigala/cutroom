import {
  ArrowArcLeftIcon,
  ArrowArcRightIcon,
  ArrowUpIcon,
  CaretRightIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  CrosshairIcon,
  EyeIcon,
  FolderSimpleIcon,
  GearSixIcon,
  LightbulbIcon,
  MagnifyingGlassIcon,
  PaperclipIcon,
  PauseIcon,
  PlusIcon,
  ScanIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  SquareIcon,
  SquareSplitHorizontalIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import {
  AnimatePresence,
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Look, Stage } from "./Stage.tsx";
import { type Added, DURATION, type Lane } from "./scenarios.ts";
import { boxesAt, faceAt } from "./track.ts";
import type { useDemo } from "./useDemo.ts";

type Demo = ReturnType<typeof useDemo>;

const spring = { type: "spring", stiffness: 380, damping: 30 } as const;
const soft = { type: "spring", stiffness: 160, damping: 22 } as const;

/** The window is laid out at a fixed size and scaled to fit, so it looks the same on every screen. */
const SIZE = { full: { w: 1280, h: 800 }, compact: { w: 760, h: 800 } };
const ScaleCtx = createContext(1);

const worked = (p: Demo["phase"]) => p === "applying" || p === "done";
const seeing = (p: Demo["phase"]) => p === "thinking" || p === "tools";

export function AppWindow({ demo, compact, running }: { demo: Demo; compact: boolean; running: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const { w, h } = compact ? SIZE.compact : SIZE.full;
  useLayoutEffect(() => {
    const el = outer.current!;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);

  // The playhead and the tracking boxes follow the clip.
  const time = useMotionValue(0);

  return (
    <div ref={outer} className="relative w-full" style={{ height: h * scale }}>
      {scale > 0 && (
        <ScaleCtx.Provider value={scale}>
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: w, height: h, transform: `scale(${scale})` }}
          >
            <Window demo={demo} compact={compact} time={time} running={running} />
            {!compact && <Floaters demo={demo} />}
          </div>
        </ScaleCtx.Provider>
      )}
    </div>
  );
}

function Window({
  demo,
  compact,
  time,
  running,
}: {
  demo: Demo;
  compact: boolean;
  time: MotionValue<number>;
  running: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={root}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[14px] border border-white/10 bg-bg text-[14px] text-fg shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,0,0,0.6)] select-none"
    >
      <TitleBar compact={compact} demo={demo} />
      <div className="flex min-h-0 flex-1">
        {!compact && <Sidebar demo={demo} />}
        <Chat demo={demo} />
        <Preview demo={demo} time={time} running={running} />
        {!compact && <SeesPanel demo={demo} />}
      </div>
      <Timeline demo={demo} time={time} compact={compact} />
      <Cursor demo={demo} root={root} />
    </div>
  );
}

function TitleBar({ compact, demo }: { compact: boolean; demo: Demo }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-bg px-4">
      <div className="flex gap-2">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
      </div>
      <SidebarSimpleIcon size={17} className="text-muted" />
      <span className="truncate text-[14px] font-semibold text-fg">Monday vlog · take 3</span>
      <AnimatePresence>
        {demo.phase === "applying" && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 rounded-full bg-accent/12 px-2 py-0.5 text-[12px] font-medium text-accent"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Draft
          </motion.span>
        )}
      </AnimatePresence>
      <div className="ml-auto flex items-center gap-4 text-muted">
        {!compact && <SquareSplitHorizontalIcon size={17} />}
        <ArrowArcLeftIcon size={17} />
        <ArrowArcRightIcon size={17} className="text-faint" />
        <span className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-fg">
          Export
        </span>
      </div>
    </div>
  );
}

const projects = [
  { name: "Monday vlog · take 3", when: "Open", img: "/demo/creator.jpg" },
  { name: "Morning coffee talk", when: "2h ago", img: "/demo/head.jpg" },
  { name: "real estate from footage", when: "12h ago", img: "/demo/latte.jpg" },
  { name: "pinterest recordings", when: "4h ago", img: "/demo/meme.jpg" },
  { name: "convulsion explainer", when: "3 days ago", img: "/demo/sounds.jpg" },
];

function Sidebar({ demo }: { demo: Demo }) {
  const busy = demo.phase !== "typing" && demo.phase !== "done";
  return (
    <div className="flex w-[218px] shrink-0 flex-col border-r border-line bg-panel px-3 py-3">
      {(
        [
          [PlusIcon, "New video", "⌘N"],
          [MagnifyingGlassIcon, "Search", "⌘K"],
          [SparkleIcon, "Inspirations", ""],
        ] as const
      ).map(([I, label, key]) => (
        <div key={label} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-fg-3">
          <I size={16} className="text-muted" />
          {label}
          <span className="ml-auto font-mono text-[11px] text-faint">{key}</span>
        </div>
      ))}
      <div className="my-3 h-px bg-line" />
      <div className="mb-2 flex items-center gap-2 px-2 text-[12px] text-faint">
        <FolderSimpleIcon size={14} /> Projects
      </div>
      {projects.map((p, i) => (
        <div
          key={p.name}
          className={clsx("flex items-center gap-2.5 rounded-lg px-2 py-2", i === 0 && "bg-selected/70")}
        >
          <div className="relative size-9 shrink-0 rounded-md">
            <img src={p.img} alt="" className="size-9 rounded-md object-cover object-top" />
            {i === 0 && busy && <span className="working-ring" style={{ borderRadius: 8 }} />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] text-fg-2">{p.name}</div>
            <div className={clsx("text-[11.5px]", i === 0 && busy ? "shimmer" : "text-faint")}>
              {i === 0 && busy ? "Editing…" : p.when}
            </div>
          </div>
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2.5 px-2 text-[13px] text-fg-3">
        <GearSixIcon size={16} className="text-muted" /> Settings
      </div>
    </div>
  );
}

function Chat({ demo }: { demo: Demo }) {
  const sc = demo.scenario;
  const { phase } = demo;
  const sent = phase !== "typing";
  return (
    <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-bg">
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden px-4 pb-3">
        <AnimatePresence mode="popLayout">
          {!sent && (
            <motion.p
              key={`intro-${sc.key}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16, filter: "blur(4px)" }}
              className="text-[13px] leading-relaxed text-muted"
            >
              Say what you want. I edit the project, show you what changed, and you keep or undo each part.
            </motion.p>
          )}
          {sent && (
            <motion.div
              key={`run-${sc.key}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -30, filter: "blur(6px)" }}
              className="flex flex-col gap-3"
            >
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={spring}
                className="self-end rounded-2xl rounded-br-md bg-raised px-3.5 py-2 text-[13px] leading-snug text-fg-2"
              >
                {sc.prompt}
              </motion.div>
              {phase !== "sent" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-1.5 text-[12px]"
                >
                  <ScanIcon size={13} className={phase === "thinking" ? "text-accent" : "text-faint"} />
                  {phase === "thinking" ? (
                    <span className="shimmer font-medium">{sc.thinking}</span>
                  ) : (
                    <span className="text-faint">Saw 200 frames, 1 person, 1 face</span>
                  )}
                </motion.div>
              )}
              {demo.tools > 0 && (
                <div className="flex flex-col gap-1">
                  {sc.tools.slice(0, demo.tools).map((t, i) => (
                    <motion.div
                      key={t}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={spring}
                      className="flex items-center gap-1.5 font-mono text-[11px] text-faint"
                    >
                      {i === demo.tools - 1 && phase === "tools" ? (
                        <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                      ) : (
                        <CheckCircleIcon size={12} weight="fill" className="text-ok/80" />
                      )}
                      {t}
                    </motion.div>
                  ))}
                </div>
              )}
              {phase === "done" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-2.5"
                >
                  <p className="text-[13px] leading-relaxed text-fg-2">{sc.reply}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sc.chips.map((c, i) => (
                      <Chip key={c} label={c} delay={0.15 + i * 0.09} first={i === 0} />
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Composer demo={demo} />
    </div>
  );
}

function Chip({ label, delay, first }: { label: string; delay: number; first: boolean }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.7, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ ...spring, delay }}
      data-cursor={first ? "chip" : undefined}
      className="flex items-center gap-2 rounded-full border border-line-strong bg-card py-1 pr-1 pl-3 text-[12px] whitespace-nowrap text-fg-2"
    >
      {label}
      <span className="rounded-full bg-button px-2 py-0.5 text-[11px] text-muted">Undo</span>
    </motion.span>
  );
}

function Composer({ demo }: { demo: Demo }) {
  const sc = demo.scenario;
  const typing = demo.phase === "typing";
  const working = !typing && demo.phase !== "done";
  const text = typing ? sc.prompt.slice(0, demo.typed) : "";
  return (
    <div className="px-3 pb-3">
      <div
        data-cursor="composer"
        className={clsx(
          "relative rounded-xl border bg-card p-3 transition-colors duration-300",
          typing && demo.typed > 0 ? "border-edge" : "border-line-strong",
        )}
      >
        <div className="min-h-[40px] text-[13px] leading-snug">
          {text ? (
            <span className="text-fg">
              {text}
              <span className="ml-px inline-block h-[15px] w-[1.5px] translate-y-[3px] animate-pulse bg-accent" />
            </span>
          ) : (
            <span className="text-faint">Tell it what to change, or point at the video</span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-muted">
          {[PaperclipIcon, CrosshairIcon, LightbulbIcon].map((I, i) => (
            <span key={i} className="grid size-7 place-items-center rounded-md bg-button">
              <I size={14} />
            </span>
          ))}
          <span className="grid size-7 place-items-center rounded-md bg-accent/15 text-accent">
            <SparkleIcon size={14} weight="fill" />
          </span>
          <span className="ml-1 font-mono text-[11px] text-accent">88%</span>
          <motion.span
            data-cursor="send"
            animate={{ scale: demo.phase === "sent" ? [1, 0.82, 1] : 1 }}
            transition={{ duration: 0.3 }}
            className={clsx(
              "ml-auto grid size-8 place-items-center rounded-full",
              working
                ? "bg-button text-fg"
                : text.length
                  ? "bg-accent text-accent-fg"
                  : "bg-accent/45 text-accent-fg",
            )}
          >
            {working ? <SquareIcon size={11} weight="fill" /> : <ArrowUpIcon size={15} weight="bold" />}
          </motion.span>
        </div>
      </div>
    </div>
  );
}

/** What it noticed, pinned where it saw it (fractions of the frame). */
const notes = [
  { x: 0.6, y: 0.16, text: "plain pink wall", delay: 0.5 },
  { x: 0.56, y: 0.78, text: "cobalt blazer", delay: 0.9 },
  { x: 0.06, y: 0.47, text: "soft key from the left", delay: 1.3 },
];

function Preview({ demo, time, running }: { demo: Demo; time: MotionValue<number>; running: boolean }) {
  const see = seeing(demo.phase);
  const look: Look = worked(demo.phase) ? demo.scenario.look : 0;
  const faceBox = useRef<HTMLDivElement>(null);
  const personBox = useRef<HTMLDivElement>(null);
  const faceLabel = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);

  // Every frame: the playhead, the clock and the tracking boxes, without a React render.
  const onTime = useCallback(
    (t: number) => {
      time.set(t);
      if (clock.current) clock.current.textContent = `0:0${t.toFixed(1)}`;
      const { face, person } = boxesAt(t);
      const place = (el: HTMLElement | null, b: number[]) => {
        if (!el) return;
        el.style.left = `${(b[0]! - b[2]! / 2) * 100}%`;
        el.style.top = `${(b[1]! - b[3]! / 2) * 100}%`;
        el.style.width = `${b[2]! * 100}%`;
        el.style.height = `${b[3]! * 100}%`;
      };
      place(faceBox.current, face);
      place(personBox.current, person);
      if (faceLabel.current) faceLabel.current.textContent = `face ${Math.round(face[4]! * 100)}%`;
    },
    [time],
  );

  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center bg-sunken/40 px-6 pt-4">
      <div className="flex items-center gap-4 font-mono text-[12px] text-muted">
        <div className="flex gap-1">
          <span className="rounded bg-raised px-2 py-0.5 text-fg">Video</span>
          <span className="px-2 py-0.5">Cover</span>
        </div>
        <div className="flex gap-1">
          {["9:16", "4:5", "1:1", "16:9"].map((r) => (
            <span key={r} className={clsx("rounded px-2 py-0.5", r === "9:16" && "bg-raised text-fg")}>
              {r}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-1.5 text-[11px] tracking-widest text-faint">
          <ChatCircleIcon size={13} /> COMMENTS
        </span>
      </div>
      <div className="relative mt-3 aspect-[432/820] h-[392px] overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
        <Stage look={look} seeing={see} running={running} onTime={onTime} face={faceAt} />
        {/* What it sees, from Cutroom's own detectors on this clip. */}
        <motion.div
          className="pointer-events-none absolute inset-0"
          animate={{ opacity: see ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        >
          <div ref={personBox} className="absolute rounded-[3px] border border-dashed border-white/50">
            <span className="absolute -top-[18px] left-0 rounded-sm bg-white/85 px-1 font-mono text-[9.5px] font-semibold text-black">
              person 95% · tracked
            </span>
          </div>
          <div ref={faceBox} className="absolute">
            {[
              "top-0 left-0 border-t-2 border-l-2",
              "top-0 right-0 border-t-2 border-r-2",
              "bottom-0 left-0 border-b-2 border-l-2",
              "right-0 bottom-0 border-r-2 border-b-2",
            ].map((c) => (
              <span key={c} className={clsx("absolute size-3 border-accent", c)} />
            ))}
            <span
              ref={faceLabel}
              className="absolute -bottom-[19px] left-1/2 -translate-x-1/2 rounded-sm bg-accent px-1 font-mono text-[9.5px] font-semibold whitespace-nowrap text-accent-fg"
            />
          </div>
          <AnimatePresence>
            {see &&
              notes.map((n) => (
                <motion.span
                  key={n.text}
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ ...spring, delay: n.delay }}
                  className="absolute flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] whitespace-nowrap text-white backdrop-blur"
                  style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
                >
                  <span className="size-1 rounded-full bg-accent" />
                  {n.text}
                </motion.span>
              ))}
          </AnimatePresence>
        </motion.div>
        <span className="absolute top-2.5 left-2.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white/80 backdrop-blur">
          sc1 · take_3
        </span>
        {see && <span className="working-ring rounded-xl" />}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span className="grid size-9 place-items-center rounded-full bg-fg text-bg">
          <PauseIcon size={15} weight="fill" />
        </span>
        <span className="tabular font-mono text-[13px] text-fg-2">
          <span ref={clock}>0:00.0</span> <span className="text-faint">/ 0:08.0</span>
        </span>
        <EyeIcon size={16} className="text-muted" />
      </div>
    </div>
  );
}

const sights = [
  ["Person 1", "tracked on 200 / 200 frames"],
  ["Face", "93% · eyes to camera"],
  ["Background", "plain pink wall · easy to replace"],
  ["Light", "soft key from the left"],
  ["Wardrobe", "cobalt blazer, white top"],
  ["Sound", "none · wants music"],
];

function SeesPanel({ demo }: { demo: Demo }) {
  const see = seeing(demo.phase);
  const after = worked(demo.phase);
  const checking = demo.phase === "applying";
  return (
    <div className="flex w-[282px] shrink-0 flex-col border-l border-line bg-panel px-3 py-3">
      <div className="flex gap-1 rounded-lg bg-sunken p-1 text-[12.5px] text-muted">
        {["Story", "Sees", "Library", "Files"].map((t) => (
          <span
            key={t}
            className={clsx("flex-1 rounded-md py-1 text-center", t === "Sees" && "bg-raised text-fg")}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="mt-3 mb-2 flex items-center justify-between px-1">
        <span className="text-[14px] font-semibold">What it sees</span>
        <span className={clsx("font-mono text-[11px]", see ? "shimmer" : "text-faint")}>
          {see ? "looking…" : "every frame"}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {sights.map(([k, v], i) => (
          <motion.div
            key={k}
            animate={{
              backgroundColor: see ? "rgba(245,165,36,0.08)" : "rgba(30,30,29,1)",
              borderColor: see ? "rgba(245,165,36,0.3)" : "rgba(255,255,255,0)",
            }}
            transition={{ delay: see ? i * 0.18 : 0, duration: 0.4 }}
            className="flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5"
          >
            <span className="w-[74px] shrink-0 text-[12px] font-medium text-fg-2">{k}</span>
            <span className="truncate text-[11.5px] text-muted">{v}</span>
          </motion.div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-1.5 px-1 text-[13px] font-semibold">
        <CaretRightIcon size={12} className="rotate-90 text-faint" /> Checks
        <span className="ml-auto font-mono text-[12px] text-accent tabular">
          {checking ? "…" : after ? "17 / 17" : "16 / 17"}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2 px-1 text-[12px]">
        <AnimatePresence mode="popLayout" initial={false}>
          {after && !checking ? (
            <motion.div
              key="ok"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={spring}
              className="flex items-center gap-2 text-ok"
            >
              <CheckCircleIcon size={15} weight="fill" /> Cutout edges clean on every frame
            </motion.div>
          ) : (
            <motion.div
              key="warn"
              exit={{ opacity: 0, x: 20 }}
              className={clsx("flex items-center gap-2 text-fg-3", checking && "animate-pulse")}
            >
              <span className="size-[15px] shrink-0 rounded-full border-2 border-accent/70" /> Nothing on
              screen changes for 8s
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-center gap-2 text-fg-3">
          <CheckCircleIcon size={15} weight="fill" className="text-ok/70" /> Face clear of the TikTok UI
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------- */

const LANES: { key: Lane; label: string; h: number }[] = [
  { key: "video", label: "Video", h: 40 },
  { key: "cutout", label: "Cutout", h: 24 },
  { key: "background", label: "Background", h: 24 },
  { key: "titles", label: "Titles", h: 24 },
  { key: "look", label: "Look", h: 24 },
  { key: "sound", label: "Sound", h: 24 },
];

function Timeline({ demo, time, compact }: { demo: Demo; time: MotionValue<number>; compact: boolean }) {
  const labelW = 100;
  const laneW = (compact ? SIZE.compact.w : SIZE.full.w) - labelW - 28;
  const pct = (t: number) => `${(t / DURATION) * 100}%`;
  const x = useTransform(time, (t) => (t / DURATION) * laneW);
  const after = worked(demo.phase);
  const sc = demo.scenario;

  return (
    <div className="relative h-[238px] shrink-0 border-t border-line bg-panel pt-2 pr-4 pl-3">
      <div className="flex h-6 items-center">
        <span className="flex w-[100px] items-center">
          <span className="flex items-center gap-1 rounded-md bg-button px-2 py-0.5 text-[12px] text-fg-2">
            <PlusIcon size={11} /> Add
          </span>
        </span>
        <div className="relative h-full flex-1 font-mono text-[10.5px] text-faint">
          {Array.from({ length: DURATION + 1 }, (_, i) => (
            <span key={i} className="absolute top-1" style={{ left: pct(i) }}>
              0:0{i}
            </span>
          ))}
        </div>
      </div>
      <div className="relative mt-1">
        {LANES.map((lane) => (
          <div key={lane.key} className="flex items-center" style={{ height: lane.h + 8 }}>
            <span className="w-[100px] shrink-0 font-mono text-[12px] text-muted">{lane.label}</span>
            <div className="relative h-full flex-1" style={{ height: lane.h }}>
              {lane.key === "video" && (
                <div className="absolute inset-0 overflow-hidden rounded-md bg-[url(/demo/creator.jpg)] bg-[length:auto_100%] bg-repeat-x opacity-90 ring-1 ring-white/10">
                  <span className="absolute top-1 left-1.5 rounded bg-black/50 px-1 font-mono text-[10.5px] text-white/90">
                    take_3.mov
                  </span>
                </div>
              )}
              {lane.key === "sound" && !after && (
                <div className="absolute inset-0 rounded-[5px] border border-dashed border-white/10 text-center text-[11px] leading-[22px] text-faint">
                  no sound
                </div>
              )}
              <AnimatePresence>
                {after &&
                  sc.added
                    .filter((a) => a.lane === lane.key)
                    .map((a, i) => (
                      <AddedBlock key={`${sc.key}-${a.label}`} a={a} i={i + LANES.indexOf(lane)} />
                    ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
        <motion.div
          className="pointer-events-none absolute -top-8 bottom-0 w-[2px] bg-accent shadow-[0_0_12px_var(--color-accent)]"
          style={{ left: labelW, x }}
        >
          <div className="absolute -top-0.5 -left-[5px] h-3 w-3 rounded-[3px] bg-accent" />
        </motion.div>
      </div>
    </div>
  );
}

const laneColor: Record<Lane, string> = {
  video: "bg-[#3f5866]",
  cutout: "bg-[#3d2f57] text-[#dccbff]",
  background: "bg-[#21474d] text-[#b5f1ff]",
  titles: "bg-[#5c4410] text-[#ffe2a0] font-semibold",
  look: "bg-[#4f2140] text-[#ffc1e6]",
  sound: "bg-[#5a3415] text-[#ffc896]",
};

function AddedBlock({ a, i }: { a: Added; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -26, scaleX: 0.2 }}
      animate={{ opacity: 1, y: 0, scaleX: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ ...soft, delay: 0.06 * i }}
      className={clsx(
        "absolute inset-y-0 z-10 origin-left overflow-hidden rounded-[5px] text-[11px] ring-[1.5px] ring-accent/80",
        laneColor[a.lane],
      )}
      style={{
        left: `${(a.from / DURATION) * 100}%`,
        width: `calc(${((a.to - a.from) / DURATION) * 100}% - 2px)`,
      }}
    >
      <span className="absolute top-0 truncate px-2 leading-[24px]">{a.label}</span>
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: "300%" }}
        transition={{ duration: 1.1, delay: 0.3 + 0.06 * i, ease: "easeInOut" }}
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />
    </motion.div>
  );
}

/* ---------------------------------------------------------------------------------------------------- */

/** A pointer that drives the demo: into the composer, onto send, then over the first change chip. */
function Cursor({ demo, root }: { demo: Demo; root: React.RefObject<HTMLDivElement | null> }) {
  const scale = useContext(ScaleCtx);
  const x = useMotionValue(700);
  const y = useMotionValue(900);
  const [press, setPress] = useState(0);
  const target =
    demo.phase === "typing"
      ? "composer"
      : demo.phase === "sent"
        ? "send"
        : demo.phase === "done"
          ? "chip"
          : null;

  useEffect(() => {
    if (!target) return;
    const t = window.setTimeout(
      () => {
        const r = root.current;
        const el = r?.querySelector<HTMLElement>(`[data-cursor="${target}"]`);
        if (!r || !el) return;
        const a = r.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        const tx = (b.left - a.left) / scale + (target === "composer" ? 60 : b.width / scale / 2);
        const ty = (b.top - a.top) / scale + (target === "composer" ? 22 : b.height / scale / 2);
        const opts = { type: "spring", stiffness: 70, damping: 16 } as const;
        animate(x, tx, opts);
        animate(y, ty, opts);
        if (target !== "chip") window.setTimeout(() => setPress((p) => p + 1), 520);
      },
      target === "chip" ? 900 : 60,
    );
    return () => window.clearTimeout(t);
  }, [target, scale, root, x, y]);

  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-50" style={{ x, y }}>
      <motion.div
        key={press}
        initial={{ scale: 1 }}
        animate={{ scale: [1, 0.8, 1] }}
        transition={{ duration: 0.25 }}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
        >
          <path
            d="M5 3l14 7.5-6.2 1.6L10 18.5z"
            fill="#fff"
            stroke="#141413"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </motion.div>
      <AnimatePresence>
        <motion.span
          key={`ring-${press}`}
          initial={{ scale: 0.2, opacity: press ? 0.8 : 0 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute -top-2 -left-2 size-6 rounded-full border-2 border-accent"
        />
      </AnimatePresence>
    </motion.div>
  );
}

const models = [
  ["Person cutout", "200 / 200 frames"],
  ["Faces", "1 found · 93%"],
  ["People", "1 tracked · 95%"],
  ["Speech", "none found"],
];

/** Cards that pop out of the window while it works: what it ran to see, the file it edits, the checks. */
function Floaters({ demo }: { demo: Demo }) {
  const sc = demo.scenario;
  const showSee = demo.phase === "thinking";
  const showDiff = (demo.phase === "tools" && demo.tools === sc.tools.length) || demo.phase === "applying";
  const showDone = demo.phase === "done";
  return (
    <>
      <AnimatePresence>
        {showSee && (
          <motion.div
            key={`see-${sc.key}`}
            initial={{ opacity: 0, x: -40, y: 20, rotate: -6, scale: 0.85 }}
            animate={{ opacity: 1, x: 0, y: 0, rotate: -2, scale: 1 }}
            exit={{ opacity: 0, x: -30, scale: 0.8, filter: "blur(6px)" }}
            transition={soft}
            className="absolute top-[190px] -left-[120px] z-40 w-[300px] overflow-hidden rounded-xl border border-white/10 bg-[#1b1b1a]/95 p-3 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-muted">
              <ScanIcon size={13} className="text-accent" /> seeing on this computer
            </div>
            {models.map(([m, d], i) => (
              <div key={m} className="mb-1.5">
                <div className="flex justify-between text-[12px]">
                  <span className="text-fg-2">{m}</span>
                  <span className="font-mono text-[10.5px] text-faint">{d}</span>
                </div>
                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/8">
                  <motion.div
                    className="h-full bg-accent"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1.1, delay: 0.15 + i * 0.3, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showDiff && (
          <motion.div
            key={`diff-${sc.key}`}
            initial={{ opacity: 0, x: -40, y: 20, rotate: -6, scale: 0.85 }}
            animate={{ opacity: 1, x: 0, y: 0, rotate: -2.5, scale: 1 }}
            exit={{ opacity: 0, x: 60, y: 120, scale: 0.6, rotate: 4, filter: "blur(6px)" }}
            transition={soft}
            className="absolute top-[260px] -left-[120px] z-40 w-[340px] overflow-hidden rounded-xl border border-white/10 bg-[#1b1b1a]/95 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 font-mono text-[11px] text-muted">
              <span className="size-2 rounded-full bg-accent" />
              project/{sc.file}
              <span className="ml-auto text-ok">+{sc.diff.length}</span>
            </div>
            <div className="py-2 font-mono text-[11.5px] leading-[1.7]">
              {sc.diff.map((l, i) => (
                <motion.div
                  key={l}
                  initial={{ opacity: 0, x: -10, backgroundColor: "rgba(125,211,167,0.25)" }}
                  animate={{ opacity: 1, x: 0, backgroundColor: "rgba(125,211,167,0.07)" }}
                  transition={{ delay: 0.15 + i * 0.12, duration: 0.5 }}
                  className="flex gap-2 px-3 whitespace-pre text-[#bfe6cf]"
                >
                  <span className="text-ok/60">+</span>
                  {l}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showDone && (
          <motion.div
            key={`done-${sc.key}`}
            initial={{ opacity: 0, y: 30, scale: 0.8, rotate: 4 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 2 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ ...soft, delay: 0.6 }}
            className="absolute top-[420px] -right-[96px] z-40 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#1b1b1a]/95 px-3.5 py-2.5 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <span className="grid size-7 place-items-center rounded-full bg-ok/15 text-ok">
              <CheckCircleIcon size={17} weight="fill" />
            </span>
            <div>
              <div className="text-[13px] font-semibold text-fg">Checks passed</div>
              <div className="font-mono text-[11px] text-muted">17 / 17 · ready to export</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
