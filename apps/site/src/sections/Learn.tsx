import { ArrowRightIcon, CheckCircleIcon, FilmStripIcon, SparkleIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Reveal, Words } from "../ui/Reveal.tsx";

/**
 * Learning a style, start to finish: a reference plays and gets measured (the numbers are from a real
 * 136 s reference), the user's own clip plays back in that style, and the two are compared.
 */

const BEAT = 60 / 99.5; // seconds
const STEP = 700;
const MEASURE = 6;
const CHECKS = 5;
const LOOP = MEASURE + 2 + CHECKS + 5;

/** One clock drives the whole section: measurements appear, the style is applied, the checks tick. */
function useSequence(on: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setStep((s) => (s + 1) % LOOP), STEP);
    return () => window.clearInterval(t);
  }, [on]);
  return {
    measured: Math.min(step, MEASURE),
    applied: step >= MEASURE + 1,
    checked: Math.max(0, Math.min(step - MEASURE - 2, CHECKS)),
  };
}

export function Learn() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15%" });
  const { measured, applied, checked } = useSequence(inView);

  return (
    <section id="learn" className="relative isolate overflow-clip py-28 md:py-40">
      <div className="pointer-events-none absolute top-1/3 left-[-10%] -z-10 size-[600px] rounded-full bg-accent/10 blur-[120px]" />
      <div className="pointer-events-none absolute right-[-10%] bottom-0 -z-10 size-[500px] rounded-full bg-[#ff4d6d]/[0.06] blur-[120px]" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <span className="font-mono text-[12px] tracking-[0.2em] text-accent uppercase">
              Learn from a video
            </span>
          </Reveal>
          <h2 className="mt-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[56px]">
            <Words text="Show it a video you love. It learns the style." />
          </h2>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">
              It watches the video play and measures every cut, punch-in and whoosh, the beat under the voice,
              and the captions straight off the screen. Then it edits yours to match, and checks its work
              against the original.
            </p>
          </Reveal>
        </div>

        <div
          ref={ref}
          className="mt-16 grid items-stretch gap-4 lg:grid-cols-[0.82fr_auto_1.3fr_auto_0.82fr]"
        >
          <Reveal className="h-full">
            <Reference />
          </Reveal>
          <Flow on={measured > 0} />
          <Reveal delay={0.08} className="h-full">
            <Measured measured={measured} />
          </Reveal>
          <Flow on={applied} />
          <Reveal delay={0.16} className="h-full">
            <Yours applied={applied} />
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <Compare checked={checked} applied={applied} />
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------------------------- 1. the reference -------------------------------------------- */

/** The reference's cuts (memes-with.mp4 cuts to a reaction and back). */
const REF_CUTS = [2.25, 3.75];

function Reference() {
  const video = useRef<HTMLVideoElement>(null);
  const [cut, setCut] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = () => {
      const t = video.current?.currentTime ?? 0;
      for (const c of REF_CUTS) if (last < c && t >= c) setCut((n) => n + 1);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <Panel step="01" title="The reference">
      <div className="mb-3 flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 font-mono text-[11.5px] text-muted">
        <FilmStripIcon size={12} /> the-one-i-love.mp4
      </div>
      <div className="relative mx-auto aspect-[540/676] w-full overflow-hidden rounded-xl">
        <video
          ref={video}
          src="/demo/memes-with.mp4"
          muted
          autoPlay
          loop
          playsInline
          className="size-full object-cover"
        />
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-20 bg-gradient-to-b from-transparent via-accent/25 to-transparent"
          animate={{ top: ["-25%", "110%"] }}
          transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        {/* Corner brackets: it's looking at the whole frame. */}
        {[
          "top-2 left-2 border-t-2 border-l-2",
          "top-2 right-2 border-t-2 border-r-2",
          "bottom-2 left-2 border-b-2 border-l-2",
          "right-2 bottom-2 border-r-2 border-b-2",
        ].map((c) => (
          <span key={c} className={clsx("absolute size-4 border-accent/80", c)} />
        ))}
        <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] backdrop-blur">
          <span className="shimmer font-semibold">watching · 12 fps</span>
        </span>
        <AnimatePresence>
          <motion.span
            key={cut}
            initial={{ opacity: cut ? 1 : 0, scale: 1.4 }}
            animate={{ opacity: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            className="absolute right-3 bottom-3 rounded-md bg-accent px-2 py-0.5 font-mono text-[11px] font-bold text-accent-fg"
          >
            CUT
          </motion.span>
        </AnimatePresence>
      </div>
    </Panel>
  );
}

/* --------------------------------------------- 2. measuring ------------------------------------------------ */

const findings: { k: string; v: string; d: string; Viz: () => ReactNode }[] = [
  { k: "Cuts", v: "35 hard, 1 whip", d: "33% on the beat · chance 23%", Viz: CutsViz },
  { k: "Punch-ins", v: "1 jump zoom", d: "18% tighter, on the cut", Viz: PunchViz },
  { k: "Rhythm", v: "99.5 bpm", d: "found under the voice", Viz: BeatViz },
  { k: "Sound", v: "10 whooshes", d: "on cuts 20% · chance 6%", Viz: WhooshViz },
  { k: "Captions", v: "read off screen", d: "font, size, place, pop", Viz: CaptionViz },
  { k: "Motion", v: "6 slow pushes", d: "mostly locked off", Viz: PushViz },
];

function Measured({ measured }: { measured: number }) {
  return (
    <Panel step="02" title="Measured, not guessed" aside={`${measured} / ${MEASURE}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {findings.map((f, i) => {
          const on = i < measured;
          return (
            <motion.div
              key={f.k}
              animate={{
                opacity: on ? 1 : 0.18,
                scale: on ? 1 : 0.96,
                borderColor: i === measured - 1 ? "rgba(245,165,36,0.6)" : "rgba(255,255,255,0.06)",
              }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
              className="relative flex flex-col overflow-hidden rounded-xl border bg-white/[0.02] p-2.5"
            >
              <div className="h-[46px]">{on && <f.Viz />}</div>
              <div className="mt-2 font-mono text-[9.5px] tracking-wider text-accent uppercase">{f.k}</div>
              <div className="mt-0.5 text-[13.5px] leading-tight font-semibold">{f.v}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">{f.d}</div>
              {i === measured - 1 && (
                <motion.span
                  layoutId="measure-flash"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/15 to-transparent"
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
}

function CutsViz() {
  const cuts = [2, 6, 9, 13, 17, 21];
  return (
    <div className="relative flex h-full items-end gap-[2px]">
      {Array.from({ length: 24 }, (_, n) => (
        <span key={n} className={clsx("relative h-full flex-1", n % 4 === 0 && "bg-white/[0.07]")}>
          {cuts.includes(n) && (
            <motion.span
              className="absolute inset-x-0 bottom-0 rounded-sm bg-accent"
              initial={{ height: 0 }}
              animate={{ height: "100%" }}
              transition={{ delay: cuts.indexOf(n) * 0.08, type: "spring", stiffness: 300, damping: 20 }}
            />
          )}
        </span>
      ))}
    </div>
  );
}

function PunchViz() {
  return (
    <div className="flex h-full items-center gap-2">
      <div className="relative h-full w-[34px] overflow-hidden rounded ring-1 ring-white/15">
        <motion.img
          src="/demo/head.jpg"
          alt=""
          className="size-full object-cover"
          animate={{ scale: [1, 1, 1.18, 1.18] }}
          transition={{ duration: 1.6, times: [0, 0.45, 0.5, 1], repeat: Number.POSITIVE_INFINITY }}
        />
      </div>
      <motion.span
        className="font-mono text-[12px] font-bold text-accent"
        animate={{ opacity: [0.3, 0.3, 1, 1] }}
        transition={{ duration: 1.6, times: [0, 0.45, 0.5, 1], repeat: Number.POSITIVE_INFINITY }}
      >
        +18%
      </motion.span>
    </div>
  );
}

function BeatViz() {
  return (
    <div className="flex h-full items-center gap-3">
      <div className="relative grid size-8 place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-accent"
          animate={{ scale: [0.6, 1.4], opacity: [0.9, 0] }}
          transition={{ duration: BEAT, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
        />
        <motion.span
          className="size-3 rounded-full bg-accent"
          animate={{ scale: [1.3, 1] }}
          transition={{ duration: BEAT, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
        />
      </div>
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((n) => (
          <motion.span
            key={n}
            className="h-4 w-1.5 rounded-full bg-white/25"
            animate={{ backgroundColor: ["rgba(245,165,36,1)", "rgba(255,255,255,0.25)"] }}
            transition={{
              duration: BEAT,
              delay: n * BEAT,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: BEAT * 3,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function WhooshViz() {
  return (
    <div className="flex h-full items-center gap-[2px]">
      {Array.from({ length: 26 }, (_, n) => {
        const hit = n % 8 === 3;
        return (
          <motion.span
            key={n}
            className={clsx("w-full rounded-full", hit ? "bg-accent" : "bg-white/20")}
            animate={{ height: hit ? ["20%", "95%", "20%"] : `${15 + ((n * 29) % 25)}%` }}
            transition={
              hit
                ? { duration: 0.9, delay: n * 0.03, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.6 }
                : {}
            }
          />
        );
      })}
    </div>
  );
}

function CaptionViz() {
  return (
    <div className="relative flex h-full items-center justify-center">
      <motion.span
        className="relative px-1.5 text-[19px] leading-none font-black text-white [-webkit-text-stroke:1.5px_black] [paint-order:stroke]"
        initial={{ scale: 0.6 }}
        animate={{ scale: [0.6, 1.12, 1] }}
        transition={{ duration: 0.5 }}
      >
        LMAO
        <motion.span
          className="absolute -inset-1 rounded-sm border border-dashed border-accent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        />
      </motion.span>
      <motion.span
        className="absolute right-0 bottom-0 font-mono text-[9px] text-accent"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        64px · low
      </motion.span>
    </div>
  );
}

function PushViz() {
  return (
    <div className="flex h-full items-center">
      <div className="relative h-full w-[60px] overflow-hidden rounded ring-1 ring-white/15">
        <motion.img
          src="/demo/latte.jpg"
          alt=""
          className="size-full object-cover"
          animate={{ scale: [1, 1.12] }}
          transition={{
            duration: 3,
            repeat: Number.POSITIVE_INFINITY,
            repeatType: "reverse",
            ease: "easeInOut",
          }}
        />
        <motion.span
          className="absolute rounded-sm border border-accent/80"
          animate={{ inset: ["6px", "2px"] }}
          transition={{
            duration: 3,
            repeat: Number.POSITIVE_INFINITY,
            repeatType: "reverse",
            ease: "easeInOut",
          }}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------- 3. yours, in that style ------------------------------------- */

const caption = ["SO", "HERE'S", "THE", "THING", "ABOUT", "MONDAYS"];

function Yours({ applied }: { applied: boolean }) {
  // On-beat punch-ins and word-by-word captions in the reference's style, once the style is applied.
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!applied) return;
    const t = window.setInterval(() => setBeat((b) => b + 1), BEAT * 2 * 1000);
    return () => window.clearInterval(t);
  }, [applied]);
  const zoomed = applied && beat % 4 >= 2;

  return (
    <Panel step="03" title="Yours, in that style" accent={applied}>
      <div className="mb-3 flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 font-mono text-[11.5px] text-muted">
        <SparkleIcon size={12} className={applied ? "text-accent" : undefined} />
        {applied ? "style: the-one-i-love" : "monday-vlog.mov"}
      </div>
      <div
        className={clsx(
          "relative mx-auto aspect-[540/676] w-full overflow-hidden rounded-xl transition-shadow duration-700",
          applied && "shadow-[0_0_0_1.5px_rgba(245,165,36,0.7),0_20px_60px_-15px_rgba(245,165,36,0.5)]",
        )}
      >
        {/* creator.mp4 is the clip stacked over its matte: show only the top half. */}
        <motion.div
          className="absolute inset-0"
          animate={{ scale: zoomed ? 1.18 : 1 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          style={{ transformOrigin: "50% 32%" }}
        >
          <video
            src="/demo/creator.mp4"
            muted
            autoPlay
            loop
            playsInline
            className="absolute top-0 left-0 h-[200%] w-full object-cover object-top"
          />
        </motion.div>
        <AnimatePresence>
          {applied && (
            <motion.div
              key="cap"
              className="absolute inset-x-0 bottom-[16%] flex justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={beat}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: [0.5, 1.15, 1], opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  transition={{ duration: 0.28 }}
                  className="text-[28px] leading-none font-black text-white [-webkit-text-stroke:2px_black] [paint-order:stroke]"
                >
                  {caption[beat % caption.length]}
                </motion.span>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {applied && zoomed && beat % 4 === 2 && (
            <motion.span
              key={`w${beat}`}
              initial={{ opacity: 1, x: -20 }}
              animate={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.5 }}
              className="absolute top-3 right-3 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-accent backdrop-blur"
            >
              whoosh
            </motion.span>
          )}
        </AnimatePresence>
        {!applied && (
          <div className="absolute inset-0 grid place-items-center bg-black/35 backdrop-blur-[1px]">
            <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] text-white/80">
              waiting for the style…
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* --------------------------------------------- compare ----------------------------------------------------- */

const compare = [
  "Cuts on the beat as often",
  "Same jump zoom size",
  "Whooshes on the cuts",
  "Captions placed and timed the same",
  "Pushes on the slow parts",
];
const refTicks = [8, 21, 33, 46, 58, 71, 83, 92];
const startTicks = [5, 17, 37, 40, 63, 66, 88, 95];

function Compare({ checked, applied }: { checked: number; applied: boolean }) {
  const done = checked === CHECKS;
  const v = useMotionValue(0);
  const pct = useTransform(v, (x) => `${Math.round(x)}%`);
  useEffect(() => {
    const c = animate(v, (checked / CHECKS) * 100, { duration: 0.6, ease: "easeOut" });
    return () => c.stop();
  }, [checked, v]);

  return (
    <div className="mt-4 grid gap-6 rounded-3xl border border-white/[0.07] bg-panel/80 p-6 lg:grid-cols-[1.5fr_1fr]">
      <div>
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="font-mono text-[11px] text-faint">04</span> Compared, side by side
        </div>
        <div className="mt-5 flex flex-col gap-4">
          {[
            { label: "Reference", ticks: refTicks, color: "bg-white/70" },
            { label: "Yours", ticks: applied ? refTicks : startTicks, color: "bg-accent" },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span className="w-[72px] shrink-0 font-mono text-[11px] text-muted">{row.label}</span>
              <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06]">
                {/* The beat grid both are measured against. */}
                {Array.from({ length: 24 }, (_, n) => (
                  <span
                    key={n}
                    className="absolute inset-y-0 w-px bg-white/[0.06]"
                    style={{ left: `${(n / 24) * 100}%` }}
                  />
                ))}
                {row.ticks.map((t, n) => (
                  <motion.span
                    key={n}
                    className={clsx("absolute inset-y-1.5 w-[3px] rounded-full", row.color)}
                    animate={{ left: `${t}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 14, delay: n * 0.05 }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Each cut lined up against the reference's, on the same beat grid.
        </p>
      </div>

      <div className="flex flex-col">
        <div className="flex items-end justify-between">
          <span className="text-[13px] text-muted">Match</span>
          <motion.span
            className={clsx("text-[38px] leading-none font-semibold tabular", done ? "text-ok" : "text-fg")}
          >
            {pct}
          </motion.span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {compare.map((c, i) => (
            <div key={c} className="flex items-center gap-2.5 text-[14px]">
              <AnimatePresence mode="wait" initial={false}>
                {i < checked ? (
                  <motion.span
                    key="y"
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 20 }}
                  >
                    <CheckCircleIcon size={18} weight="fill" className="text-ok" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="n"
                    exit={{ scale: 0 }}
                    className="size-[18px] rounded-full border-2 border-white/15"
                  />
                )}
              </AnimatePresence>
              <span className={i < checked ? "text-fg-2" : "text-faint"}>{c}</span>
            </div>
          ))}
        </div>
        <motion.div
          animate={{ opacity: done ? 1 : 0, y: done ? 0 : 8 }}
          className="mt-4 rounded-xl bg-accent/10 px-3.5 py-2.5 text-[13px] text-accent ring-1 ring-accent/30"
        >
          Saved to your Inspirations, ready for the next video.
        </motion.div>
      </div>
    </div>
  );
}

/* --------------------------------------------- shared ------------------------------------------------------ */

function Panel({
  step,
  title,
  aside,
  accent,
  children,
}: {
  step: string;
  title: string;
  aside?: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex h-full flex-col rounded-3xl border bg-panel/90 p-4 transition-colors duration-700",
        accent ? "border-accent/30" : "border-white/[0.07]",
      )}
    >
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="font-mono text-[11px] text-faint">{step}</span>
        <span className="text-[15px] font-semibold">{title}</span>
        {aside && <span className="ml-auto font-mono text-[11px] text-faint tabular">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** The arrow between stages: dashes flow along it once there's something to pass on. */
function Flow({ on }: { on: boolean }) {
  return (
    <div className="hidden items-center lg:flex">
      <div className="relative flex w-8 items-center">
        <motion.span
          className="h-[2px] w-full rounded-full"
          style={{
            backgroundImage: "linear-gradient(90deg, #f5a524 50%, transparent 50%)",
            backgroundSize: "8px 2px",
          }}
          animate={on ? { backgroundPositionX: ["0px", "16px"], opacity: 1 } : { opacity: 0.2 }}
          transition={on ? { duration: 0.6, repeat: Number.POSITIVE_INFINITY, ease: "linear" } : {}}
        />
        <ArrowRightIcon
          size={14}
          className={clsx("absolute -right-1.5 transition-colors", on ? "text-accent" : "text-faint")}
        />
      </div>
    </div>
  );
}
