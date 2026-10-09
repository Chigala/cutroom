import { AnimatePresence, animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

const ease = [0.22, 1, 0.36, 1] as const;
const HOLD = 3400;

/** Graphics the agent made for the hero clip, one after another over a live frame of it. */
const graphics = [
  { file: "lower-third.html", Art: LowerThird },
  { file: "kinetic-title.html", Art: KineticTitle },
  { file: "retention-ring.html", Art: Ring },
  { file: "callout.html", Art: Callout },
];

export function GraphicsCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10%" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = window.setInterval(() => setN((x) => x + 1), HOLD);
    return () => window.clearInterval(t);
  }, [inView]);
  const g = graphics[n % graphics.length]!;

  return (
    <div
      ref={ref}
      className="relative h-[210px] w-full max-w-[340px] overflow-hidden rounded-xl ring-1 ring-white/10"
    >
      {/* The footage, drifting slowly so the frame feels alive. */}
      <motion.img
        src="/demo/before.jpg"
        alt=""
        className="absolute inset-0 size-full object-cover object-[50%_28%]"
        animate={{ scale: [1.05, 1.14, 1.05], x: [0, -8, 0] }}
        transition={{ duration: 14, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
      <AnimatePresence initial={false}>
        <motion.div
          key={n}
          className="absolute inset-0"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.45 } }}
        >
          <g.Art />
        </motion.div>
      </AnimatePresence>
      {/* Which file is playing: every graphic is a file the agent wrote for this video. */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white/85 backdrop-blur">
        <span className="size-1.5 rounded-full bg-accent" />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={g.file}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            graphics/{g.file}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/10">
        <motion.div
          key={n}
          className="h-full bg-accent"
          initial={{ width: "0%" }}
          animate={{ width: inView ? "100%" : "0%" }}
          transition={{ duration: HOLD / 1000, ease: "linear" }}
        />
      </div>
    </div>
  );
}

function LowerThird() {
  return (
    <div className="absolute bottom-6 left-4 flex items-stretch gap-2.5">
      <motion.span
        className="w-[3px] origin-bottom rounded-full bg-accent"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.5, ease }}
      />
      <div className="overflow-hidden">
        <motion.div
          className="text-[19px] leading-tight font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 140, damping: 18, delay: 0.2 }}
        >
          Maya Laurent
        </motion.div>
        <motion.div
          className="text-[12px] text-white/80"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease, delay: 0.45 }}
        >
          Creator · Paris
        </motion.div>
      </div>
    </div>
  );
}

function KineticTitle() {
  const word = "MONDAYS";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25">
      <div className="flex overflow-hidden">
        {word.split("").map((c, i) => (
          <motion.span
            key={i}
            className="text-[46px] leading-none font-black tracking-tight text-white"
            initial={{ y: "110%", rotate: 12 }}
            animate={{ y: 0, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 16, delay: i * 0.045 }}
          >
            {c}
          </motion.span>
        ))}
      </div>
      <motion.span
        className="mt-1 h-[4px] origin-left rounded-full bg-accent"
        style={{ width: 150 }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, ease, delay: 0.4 }}
      />
      <motion.span
        className="mt-2 font-mono text-[11px] tracking-[0.35em] text-white/85"
        initial={{ opacity: 0, letterSpacing: "0.8em" }}
        animate={{ opacity: 1, letterSpacing: "0.35em" }}
        transition={{ duration: 0.8, ease, delay: 0.55 }}
      >
        ARE A MOOD
      </motion.span>
    </div>
  );
}

function Ring() {
  const v = useMotionValue(0);
  const shown = useTransform(v, (x) => `${Math.round(x)}%`);
  const dash = useTransform(v, (x) => `${(x / 100) * 176} 176`);
  useEffect(() => {
    const c = animate(v, 87, { duration: 1.4, ease, delay: 0.15 });
    return () => c.stop();
  }, [v]);
  return (
    <div className="absolute inset-y-0 right-0 flex w-[55%] items-center justify-center bg-gradient-to-l from-black/65 to-transparent">
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 160, damping: 16 }}
      >
        <svg aria-hidden="true" width="74" height="74" viewBox="0 0 64 64" className="-rotate-90">
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
          <motion.circle
            cx="32"
            cy="32"
            r="28"
            fill="none"
            stroke="#f5a524"
            strokeWidth="5"
            strokeLinecap="round"
            style={{ strokeDasharray: dash }}
          />
        </svg>
        <motion.span className="-mt-[50px] mb-[26px] text-[17px] font-bold text-white tabular">
          {shown}
        </motion.span>
        <span className="text-center text-[11px] leading-tight text-white/85">
          stay past
          <br />3 seconds
        </span>
      </motion.div>
    </div>
  );
}

function Callout() {
  return (
    <div className="absolute inset-0">
      <motion.span
        className="absolute top-[64%] left-[34%] size-3 rounded-full bg-accent shadow-[0_0_0_4px_rgba(245,165,36,0.35)]"
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.3, 1] }}
        transition={{ duration: 0.5 }}
      />
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full"
        viewBox="0 0 340 210"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M120 140 L180 92 L262 92"
          fill="none"
          stroke="#f5a524"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, ease, delay: 0.2 }}
        />
      </svg>
      <motion.div
        className="absolute top-[30%] right-3 rounded-lg bg-white px-2.5 py-1.5 text-black shadow-lg"
        initial={{ opacity: 0, y: 8, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.6 }}
      >
        <div className="text-[12px] leading-tight font-bold">Cobalt blazer</div>
        <div className="text-[10.5px] text-black/60">vintage, oversized</div>
      </motion.div>
    </div>
  );
}
