import { ArrowCounterClockwiseIcon, CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { AnimatePresence, motion, useInView } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Reveal, Words } from "../ui/Reveal.tsx";
import { GraphicsCard } from "./GraphicsCard.tsx";

/** A counter that ticks while the card is on screen. */
function useTick(ms: number, ref: React.RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { margin: "-10%" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(t);
  }, [inView, ms]);
  return n;
}

function Card({
  title,
  body,
  children,
  className,
  delay = 0,
}: {
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={className}>
      <motion.div
        whileHover={{ y: -4 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-b from-card to-panel p-6 sm:p-7"
      >
        <div className="pointer-events-none absolute -top-24 -right-24 size-60 rounded-full bg-accent/0 blur-3xl transition-colors duration-700 group-hover:bg-accent/15" />
        <div className="relative flex h-[210px] items-center justify-center">{children}</div>
        <h3 className="relative mt-6 text-[19px] font-semibold tracking-tight">{title}</h3>
        <p className="relative mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
      </motion.div>
    </Reveal>
  );
}

const transcript = "so every morning I make myself a proper coffee like a real one".split(" ");

function Understands() {
  const ref = useRef<HTMLDivElement>(null);
  const n = useTick(260, ref);
  const at = n % (transcript.length + 4);
  return (
    <div ref={ref} className="w-full max-w-[340px]">
      <div className="flex h-14 items-center gap-[3px]">
        {Array.from({ length: 48 }, (_, i) => {
          const h = 18 + Math.abs(Math.sin(i * 1.7) * 30) + Math.abs(Math.cos(i * 0.6)) * 12;
          const lit = i / 48 < at / transcript.length;
          return (
            <motion.span
              key={i}
              className={clsx("w-[3px] rounded-full", lit ? "bg-accent" : "bg-white/15")}
              animate={{ height: lit ? h : h * 0.6 }}
              transition={{ type: "spring", stiffness: 200, damping: 18 }}
            />
          );
        })}
      </div>
      <p className="mt-4 text-[15px] leading-relaxed">
        {transcript.map((w, i) => (
          <span
            key={i}
            className={clsx(
              "transition-colors duration-200",
              i === at ? "rounded bg-accent px-0.5 text-accent-fg" : i < at ? "text-fg-2" : "text-faint",
            )}
          >
            {w}{" "}
          </span>
        ))}
      </p>
      <div className="mt-3 flex gap-1.5 font-mono text-[10.5px] text-faint">
        {["words", "pauses", "shots", "faces", "beats"].map((t, i) => (
          <motion.span
            key={t}
            className="rounded-full border border-line-strong px-2 py-0.5"
            animate={{ borderColor: at % 5 === i ? "rgba(245,165,36,0.7)" : "rgba(255,255,255,0.08)" }}
          >
            {t}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function Point() {
  const ref = useRef<HTMLDivElement>(null);
  const n = useTick(1400, ref);
  const step = n % 4;
  return (
    <div ref={ref} className="relative h-[200px] w-[160px] overflow-hidden rounded-xl ring-1 ring-white/10">
      <img src="/demo/poster.jpg" alt="" className="absolute inset-0 size-full object-cover" />
      <motion.div
        className="absolute"
        animate={{ left: step === 0 ? 120 : 62, top: step === 0 ? 170 : 58 }}
        transition={{ type: "spring", stiffness: 80, damping: 14 }}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
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
        {step >= 1 && (
          <motion.span
            key="pin"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            className="absolute top-[50px] left-[54px] grid size-5 place-items-center rounded-full rounded-bl-none bg-accent text-[10px] font-bold text-accent-fg"
          >
            1
          </motion.span>
        )}
        {step >= 2 && (
          <motion.div
            key="note"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute right-2 bottom-2 left-2 rounded-lg bg-black/70 px-2.5 py-1.5 text-[11.5px] backdrop-blur"
          >
            <span className="font-mono text-accent">0:01</span> Zoom in on his face here
          </motion.div>
        )}
        {step >= 3 && (
          <motion.div
            key="zoom"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 ring-2 ring-accent ring-inset"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const chips = ["Add b-roll 1", "Slow the opening", "Add whoosh 2", "Thin crowded sounds", "Captions: bigger"];

function KeepUndo() {
  const ref = useRef<HTMLDivElement>(null);
  const n = useTick(900, ref);
  const undone = new Set([n % 5, (n + 2) % 5].filter((_, i) => i === 0 || n % 3 === 0));
  return (
    <div ref={ref} className="flex max-w-[330px] flex-wrap justify-center gap-2">
      {chips.map((c, i) => {
        const off = undone.has(i);
        return (
          <motion.span
            layout
            key={c}
            animate={{ opacity: off ? 0.45 : 1 }}
            className="flex items-center gap-2 rounded-full border border-line-strong bg-card py-1.5 pr-1.5 pl-3.5 text-[13px] whitespace-nowrap"
          >
            <span className={clsx(off && "text-faint line-through")}>{c}</span>
            <motion.span
              layout
              className={clsx(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px]",
                off ? "bg-accent text-accent-fg" : "bg-button text-muted",
              )}
            >
              {off ? (
                <>
                  <ArrowCounterClockwiseIcon size={10} weight="bold" /> Redo
                </>
              ) : (
                "Undo"
              )}
            </motion.span>
          </motion.span>
        );
      })}
    </div>
  );
}

const checkList = [
  "Cut lands on a blink at 0:37",
  "Nothing changes for 2.8s at 1:04",
  "Caption under the TikTok buttons",
  "Two sounds crowd each other at 1:19",
];

function Checks() {
  const ref = useRef<HTMLDivElement>(null);
  const n = useTick(1100, ref);
  const fixed = n % (checkList.length + 3);
  return (
    <div ref={ref} className="w-full max-w-[330px]">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[14px] font-semibold">Checks</span>
        <span className="font-mono text-[13px] text-accent tabular">
          {13 + Math.min(fixed, checkList.length)} / 17
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {checkList.map((c, i) => {
          const ok = i < fixed;
          return (
            <motion.div
              key={c}
              layout
              className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2 text-[13px]"
            >
              <AnimatePresence mode="wait" initial={false}>
                {ok ? (
                  <motion.span key="ok" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }}>
                    <CheckCircleIcon size={16} weight="fill" className="text-ok" />
                  </motion.span>
                ) : (
                  <motion.span key="w" exit={{ scale: 0 }}>
                    <WarningIcon size={16} className="text-accent" />
                  </motion.span>
                )}
              </AnimatePresence>
              <span className={clsx("truncate transition-colors", ok ? "text-faint" : "text-fg-3")}>{c}</span>
              {!ok && i === fixed && (
                <span className="ml-auto rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">
                  Fix
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

const ratios = [
  { r: "9:16", w: 112, h: 200 },
  { r: "4:5", w: 160, h: 200 },
  { r: "1:1", w: 190, h: 190 },
  { r: "16:9", w: 300, h: 169 },
];

function Shapes() {
  const ref = useRef<HTMLDivElement>(null);
  const n = useTick(1500, ref);
  const s = ratios[n % ratios.length]!;
  return (
    <div ref={ref} className="flex flex-col items-center gap-4">
      <motion.div
        animate={{ width: s.w * 0.85, height: s.h * 0.85 }}
        transition={{ type: "spring", stiffness: 160, damping: 20 }}
        className="relative overflow-hidden rounded-xl ring-1 ring-white/15"
      >
        <img src="/demo/poster.jpg" alt="" className="absolute inset-0 size-full object-cover" />
        <motion.span
          layout
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
        >
          every single morning
        </motion.span>
      </motion.div>
      <div className="flex gap-1 rounded-lg bg-white/[0.04] p-1 font-mono text-[11.5px]">
        {ratios.map((r) => (
          <span key={r.r} className="relative px-2.5 py-0.5">
            {r.r === s.r && (
              <motion.span layoutId="ratio" className="absolute inset-0 rounded-md bg-selected" />
            )}
            <span className={clsx("relative", r.r === s.r ? "text-fg" : "text-faint")}>{r.r}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-32">
      <div className="mx-auto max-w-2xl text-center">
        <Reveal>
          <span className="font-mono text-[12px] tracking-[0.2em] text-accent uppercase">What it does</span>
        </Reveal>
        <h2 className="mt-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[52px]">
          <Words text="An editor that knows your footage." />
        </h2>
      </div>
      <div className="mt-16 grid gap-4 md:grid-cols-6">
        <Card
          className="md:col-span-4"
          title="It watches everything you drop in"
          body="Every word said, every pause, shot, face and beat, indexed on your computer. The agent makes the first cut on its own."
        >
          <Understands />
        </Card>
        <Card
          className="md:col-span-2"
          delay={0.08}
          title="Point at the video"
          body="Click a frame and say what's wrong. The comment lands at that moment."
        >
          <Point />
        </Card>
        <Card
          className="md:col-span-3"
          title="Keep or undo every change"
          body="Each edit is its own chip. Undo the whoosh, keep the b-roll."
        >
          <KeepUndo />
        </Card>
        <Card
          className="md:col-span-3"
          delay={0.08}
          title="Graphics made for this video"
          body="Titles, charts and lower thirds designed for your subject, not picked from a template menu."
        >
          <GraphicsCard />
        </Card>
        <Card
          className="md:col-span-3"
          title="Checks catch what you'd miss"
          body="Cuts on a blink, dead air, captions under the app's buttons. Found before you export, fixed in a click."
        >
          <Checks />
        </Card>
        <Card
          className="md:col-span-3"
          delay={0.08}
          title="Every shape, one edit"
          body="TikTok, Reels, Shorts or YouTube. Switch the frame and the layout follows."
        >
          <Shapes />
        </Card>
      </div>
    </section>
  );
}
