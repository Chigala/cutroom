import {
  FilmStripIcon,
  PersonIcon,
  ScanSmileyIcon,
  SunHorizonIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import sees from "../demo/sees.json";
import { Words } from "../ui/Reveal.tsx";

/** The first frame's boxes, from Cutroom's own detectors on the hero clip. */
const [, fx, fy, fw, fh, , px, py, pw, ph] = (sees as number[][])[0]!;

const layers = [
  { name: "Pixels", note: "Every frame, decoded on your machine.", Icon: FilmStripIcon },
  { name: "Person", note: "Cut out on every frame, hair and all.", Icon: PersonIcon },
  { name: "Face & body", note: "Found, then followed through the shot.", Icon: ScanSmileyIcon },
  { name: "Scene", note: "What's in it, how it's lit, what's worn.", Icon: SunHorizonIcon },
  { name: "Sound", note: "Every word, pause, beat and effect.", Icon: WaveformIcon },
];

/**
 * "It sees everything": one frame comes apart into the layers Cutroom reads from it, in 3D, as you scroll.
 */
export function Sees() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.6 });
  // It starts already leaning back (so the first view is a scene, not a flat photo) and keeps tilting as it opens.
  const tilt = useTransform(p, [0, 0.22], [0, 1]);
  const rotateX = useTransform(tilt, [0, 1], [24, 58]);
  const rotateZ = useTransform(tilt, [0, 1], [-14, -38]);
  const spread = useTransform(p, [0.1, 0.85], [0, 1]);
  const scale = useTransform(tilt, [0, 1], [0.95, 0.84]);
  // Opening the stack lifts its top layers, so the whole stack settles lower to stay clear of the heading.
  const y = useTransform(spread, [0, 1], ["0%", "20%"]);
  // The layer being described: one at a time, as the stack opens.
  const [active, setActive] = useState(0);
  useMotionValueEvent(spread, "change", (v) =>
    setActive(Math.min(layers.length - 1, Math.floor(v * layers.length * 0.999))),
  );

  return (
    <section ref={ref} id="sees" className="relative h-[260vh]">
      <div className="sticky top-0 h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_45%_50%_at_62%_55%,rgba(245,165,36,0.14),transparent)]" />
        <div className="mx-auto grid h-full max-w-6xl grid-rows-[auto_1fr] items-center gap-2 px-4 pt-20 pb-6 sm:px-6 md:grid-cols-[minmax(0,400px)_1fr] md:grid-rows-1 md:gap-6 md:py-0">
          <div className="text-center md:text-left">
            <span className="font-mono text-[12px] tracking-[0.2em] text-accent uppercase">
              It sees everything
            </span>
            <h2 className="mt-3 text-[34px] leading-[1.03] font-semibold tracking-[-0.035em] sm:text-[46px]">
              <Words text="Every frame, read like a page." />
            </h2>
            <p className="mt-4 hidden text-[15.5px] leading-relaxed text-muted md:block">
              Before it touches your edit, it looks, on your computer. That's how it can move a background or
              land a cut on a laugh.
            </p>
            <Stepper active={active} spread={spread} />
          </div>

          {/* The stage: a faint floor grid under the stack, which fills the column. */}
          <div className="relative h-full max-h-[720px] min-h-0 w-full [perspective:2200px]">
            <div className="pointer-events-none absolute inset-[6%] rounded-[40px] [background-image:linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_72%)]" />
            <motion.div
              style={{ rotateX, rotateZ, scale, y, transformStyle: "preserve-3d" }}
              className="absolute top-1/2 left-1/2 aspect-[432/820] h-[56%] -translate-x-1/2 md:h-[78%] -translate-y-1/2"
            >
              {layers.map((l, i) => (
                <Layer key={l.name} i={i} spread={spread} tilt={tilt} active={active} />
              ))}
              {/* A scan running down the frame while it's still in one piece. */}
              <motion.div
                style={{ opacity: useTransform(spread, [0, 0.15], [1, 0]) }}
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
              >
                <motion.div
                  className="absolute inset-x-0 h-[22%] bg-gradient-to-b from-transparent via-accent/30 to-transparent"
                  animate={{ top: ["-25%", "105%"] }}
                  transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Layer({
  i,
  spread,
  tilt,
  active,
}: {
  i: number;
  spread: MotionValue<number>;
  tilt: MotionValue<number>;
  active: number;
}) {
  const z = useTransform(spread, (s) => i * s * 84);
  const fade = useTransform(tilt, [0, 0.4], [i === 0 ? 1 : 0, 1]);
  return (
    <motion.div
      style={{ translateZ: z, opacity: fade, transformStyle: "preserve-3d" }}
      className={clsx(
        "absolute inset-0 rounded-2xl transition-[border-color,box-shadow] duration-500",
        i > 0 && "border bg-white/[0.025]",
        i > 0 &&
          (i === active
            ? "border-accent/80 shadow-[0_0_60px_-6px_rgba(245,165,36,0.55)]"
            : "border-white/15 shadow-[0_0_40px_-10px_rgba(245,165,36,0.2)]"),
      )}
    >
      <div
        className={clsx(
          "size-full transition-opacity duration-500",
          i === active || i === 0 ? "opacity-100" : "opacity-55",
        )}
      >
        <LayerArt i={i} />
      </div>
    </motion.div>
  );
}

/** The layers as steps: a rail that fills as you scroll, and the current one opened up with what it found. */
function Stepper({ active, spread }: { active: number; spread: MotionValue<number> }) {
  const fill = useTransform(spread, [0, 1], ["0%", "100%"]);
  return (
    <div className="relative mt-7 hidden md:block">
      <div className="absolute top-3 bottom-3 left-[15px] w-px bg-white/10">
        <motion.div
          style={{ height: fill }}
          className="w-full bg-accent shadow-[0_0_10px_var(--color-accent)]"
        />
      </div>
      <div className="flex flex-col gap-1">
        {layers.map((l, i) => {
          const on = i === active;
          const done = i < active;
          return (
            <motion.div
              key={l.name}
              layout
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className={clsx(
                "relative rounded-2xl py-2 pr-3 pl-11 transition-colors duration-300",
                on && "bg-white/[0.04] ring-1 ring-accent/25",
              )}
            >
              <motion.span
                layout
                className={clsx(
                  "absolute top-2.5 left-[5px] grid size-[21px] place-items-center rounded-full transition-colors duration-300",
                  on
                    ? "bg-accent text-accent-fg"
                    : done
                      ? "bg-accent/20 text-accent"
                      : "bg-sunken text-faint ring-1 ring-white/10",
                )}
              >
                <l.Icon size={12} weight="bold" />
              </motion.span>
              <motion.div layout="position" className="flex items-baseline gap-2.5">
                <span className="font-mono text-[11px] text-faint tabular">0{i + 1}</span>
                <span
                  className={clsx(
                    "text-[16px] font-semibold transition-colors",
                    on ? "text-fg" : done ? "text-fg-3" : "text-faint",
                  )}
                >
                  {l.name}
                </span>
              </motion.div>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.div
                    key="open"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 30 }}
                    className="overflow-hidden"
                  >
                    <p className="pt-1 text-[14px] leading-snug text-muted">{l.note}</p>
                    <div className="pt-2.5 pb-1">
                      <Readout i={i} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/** What that layer found in this clip (from the real run on it), small and live. */
function Readout({ i }: { i: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (i !== 2 && i !== 0) return;
    const id = window.setInterval(() => setT((x) => (x + 1) % 80), 100);
    return () => window.clearInterval(id);
  }, [i]);
  const chip = "rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-fg-3";
  switch (i) {
    case 0:
      return (
        <div className="flex flex-wrap gap-1.5">
          <span className={chip}>frame {String(Math.round(t * 3)).padStart(3, "0")} / 240</span>
          <span className={chip}>30 fps</span>
          <span className={chip}>432 × 820</span>
        </div>
      );
    case 1:
      return (
        <div className="flex items-center gap-3">
          <div className="h-12 w-[26px] overflow-hidden rounded bg-accent/25 ring-1 ring-accent/40">
            <img src="/demo/cutout.webp" alt="" className="size-full object-cover" />
          </div>
          <div className="flex-1">
            <div className="flex justify-between font-mono text-[11px] text-fg-3">
              <span>matte</span>
              <span>240 / 240</span>
            </div>
            <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full bg-accent"
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        </div>
      );
    case 2: {
      const r = (sees as number[][])[t]!;
      return (
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-[11px] font-semibold text-accent-fg">
            face {Math.round(r[5]! * 100)}%
          </span>
          <span className={chip}>
            x {r[1]!.toFixed(2)} · y {r[2]!.toFixed(2)}
          </span>
          <span className={chip}>person {Math.round(r[10]! * 100)}%</span>
        </div>
      );
    }
    case 3:
      return (
        <div className="flex flex-wrap gap-1.5">
          {["white wall", "soft, even light", "lilac top", "eyes to camera"].map((x, n) => (
            <motion.span
              key={x}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: n * 0.08 }}
              className={chip}
            >
              {x}
            </motion.span>
          ))}
        </div>
      );
    default:
      return (
        <div className="flex h-7 items-center gap-[3px]">
          {Array.from({ length: 34 }, (_, n) => (
            <motion.span
              key={n}
              className={clsx("w-[3px] rounded-full", n % 9 === 0 ? "bg-accent" : "bg-white/30")}
              animate={{
                height: [`${25 + ((n * 37) % 60)}%`, `${70 - ((n * 23) % 50)}%`, `${25 + ((n * 37) % 60)}%`],
              }}
              transition={{
                duration: 1.2,
                repeat: Number.POSITIVE_INFINITY,
                delay: n * 0.03,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      );
  }
}

function LayerArt({ i }: { i: number }) {
  switch (i) {
    case 0:
      return <img src="/demo/creator.jpg" alt="" className="size-full rounded-2xl object-cover" />;
    case 1:
      return (
        <img
          src="/demo/cutout.webp"
          alt=""
          className="size-full rounded-2xl object-cover drop-shadow-[0_0_2px_#f5a524] [filter:drop-shadow(0_0_14px_rgba(245,165,36,0.6))]"
        />
      );
    case 2:
      return (
        <div className="relative size-full">
          <div
            className="absolute rounded-sm border-2 border-dashed border-white/70"
            style={{
              left: `${(px! - pw! / 2) * 100}%`,
              top: `${(py! - ph! / 2) * 100}%`,
              width: `${pw! * 100}%`,
              height: `${ph! * 100}%`,
            }}
          >
            <span className="absolute -top-6 left-0 rounded bg-white px-1.5 font-mono text-[11px] font-bold text-black">
              person 95%
            </span>
          </div>
          <div
            className="absolute rounded-md border-[2.5px] border-accent shadow-[0_0_24px_rgba(245,165,36,0.6)]"
            style={{
              left: `${(fx! - fw! / 2) * 100}%`,
              top: `${(fy! - fh! / 2) * 100}%`,
              width: `${fw! * 100}%`,
              height: `${fh! * 100}%`,
            }}
          >
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded bg-accent px-1.5 font-mono text-[11px] font-bold text-accent-fg">
              face 93%
            </span>
            {[
              [32, 42],
              [66, 42],
              [50, 60],
              [36, 78],
              [64, 78],
            ].map(([x, y]) => (
              <span
                key={`${x}-${y}`}
                className="absolute size-2 -translate-1/2 rounded-full bg-accent"
                style={{ left: `${x}%`, top: `${y}%` }}
              />
            ))}
          </div>
        </div>
      );
    case 3:
      return (
        <div className="relative size-full">
          {[
            ["plain white wall", 8, 8],
            ["soft, even light", 6, 44],
            ["eyes to camera", 52, 20],
            ["beige trousers", 50, 74],
            ["lilac top", 38, 50],
          ].map(([t, x, y]) => (
            <span
              key={t as string}
              className="absolute flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[12px] whitespace-nowrap text-white ring-1 ring-white/15"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span className="size-1.5 rounded-full bg-accent" />
              {t}
            </span>
          ))}
        </div>
      );
    default:
      return (
        <div className="flex size-full flex-col justify-end gap-2 p-4">
          <div className="flex flex-wrap gap-1">
            {"so here's what nobody tells you about mondays".split(" ").map((w, n) => (
              <span
                key={n}
                className={clsx(
                  "rounded px-1.5 py-0.5 text-[11px]",
                  n === 4 ? "bg-accent text-accent-fg" : "bg-white/10 text-white/80",
                )}
              >
                {w}
              </span>
            ))}
          </div>
          <div className="flex h-14 items-center gap-[2px]">
            {Array.from({ length: 44 }, (_, n) => (
              <span
                key={n}
                className={clsx("w-full rounded-full", n % 11 === 0 ? "bg-accent" : "bg-white/30")}
                style={{ height: `${20 + Math.abs(Math.sin(n * 1.3)) * 70}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between font-mono text-[10px] text-white/60">
            <span>128 bpm</span>
            <span>pause 0.6s</span>
            <span>whoosh</span>
          </div>
        </div>
      );
  }
}
