import { AppleLogoIcon, DownloadSimpleIcon, LinuxLogoIcon, WindowsLogoIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { AnimatePresence, motion, useInView, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AppWindow } from "../demo/AppWindow.tsx";
import { scenarios, timing } from "../demo/scenarios.ts";
import { useDemo } from "../demo/useDemo.ts";
import { detectOs, MAC_DOWNLOAD, type Os } from "../downloads.ts";

const ease = [0.22, 1, 0.36, 1] as const;
export const osIcon = { mac: AppleLogoIcon, windows: WindowsLogoIcon, linux: LinuxLogoIcon };

export function useOs() {
  const [os, setOs] = useState<Os>("mac");
  useEffect(() => setOs(detectOs()), []);
  return os;
}

function useCompact() {
  const [compact, set] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 820px)");
    const on = () => set(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return compact;
}

/** Always the Mac build for now: Windows and Linux are coming soon (said under the button). */
export function DownloadButton({ big = false }: { big?: boolean }) {
  return (
    <motion.a
      href={MAC_DOWNLOAD}
      whileHover={{ scale: 1.03, y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      className={clsx(
        "group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-accent font-semibold whitespace-nowrap text-accent-fg shadow-[0_10px_40px_-8px_rgba(245,165,36,0.6)]",
        big ? "px-7 py-4 text-[17px]" : "px-5 py-3 text-[15px]",
      )}
    >
      <AppleLogoIcon size={big ? 20 : 18} weight="fill" />
      Download for Mac
      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
    </motion.a>
  );
}

export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const inView = useInView(stage, { margin: "0px 0px -10% 0px" });
  const demo = useDemo(inView);
  const compact = useCompact();

  // The window starts tilted back and lies flat as you scroll to it.
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 0.25"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const rotateX = useTransform(p, [0, 1], [24, 0]);
  const scale = useTransform(p, [0, 1], [0.88, 1]);
  const y = useTransform(p, [0, 1], [60, 0]);
  const glow = useTransform(p, [0, 1], [0.35, 1]);

  return (
    <section className="relative isolate px-4 pt-32 sm:px-6 sm:pt-40">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />
      <motion.div
        className="pointer-events-none absolute top-[-10%] left-1/2 -z-10 h-[720px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(245,165,36,0.20),transparent)] blur-2xl"
        animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />

      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <motion.a
          href="#download"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease, delay: 0.9 }}
          className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pr-3 pl-1 text-[13px] text-fg-3 backdrop-blur"
        >
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[12px] font-semibold text-accent">
            New
          </span>
          Free for Mac · Windows and Linux soon
        </motion.a>

        <h1 className="font-display text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[76px] md:text-[92px]">
          {["You", "direct."].map((w, i) => (
            <HeroWord key={w} delay={1.0 + i * 0.08}>
              {w}
            </HeroWord>
          ))}
          <br />
          {["The", "agent"].map((w, i) => (
            <HeroWord key={w} delay={1.18 + i * 0.08}>
              {w}
            </HeroWord>
          ))}
          <HeroWord delay={1.36}>
            <span className="sheen">edits.</span>
          </HeroWord>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.9, ease, delay: 1.5 }}
          className="mt-7 max-w-2xl text-[17px] leading-relaxed text-muted sm:text-[20px]"
        >
          A video editor built from the ground up for AI. It sees every frame and hears every word, so you can
          just ask for <Picker demo={demo} />.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease, delay: 1.65 }}
          className="mt-9 flex flex-col items-center gap-3"
        >
          <DownloadButton />
          <a href="#download" className="flex items-center gap-1.5 text-[13px] text-faint hover:text-fg-3">
            <DownloadSimpleIcon size={13} /> Free · Works with Claude Code and Codex · Windows and Linux soon
          </a>
        </motion.div>
      </div>

      <div
        ref={stage}
        className="relative mx-auto mt-16 max-w-[1240px] [perspective:1800px] sm:mt-20 lg:px-16"
      >
        <motion.div
          style={{ opacity: glow }}
          className="pointer-events-none absolute inset-x-[8%] top-[6%] bottom-[10%] -z-10 rounded-[40px] bg-accent/25 blur-[90px]"
        />
        <motion.div
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease, delay: 1.7 }}
        >
          <motion.div style={{ rotateX, scale, y, transformOrigin: "50% 0%" }}>
            <AppWindow demo={demo} compact={compact} running={inView} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function HeroWord({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <span className="inline-block overflow-hidden pr-[0.22em] pb-[0.1em] align-bottom last:pr-0">
      <motion.span
        className="inline-block"
        initial={{ y: "110%", rotate: 6, filter: "blur(10px)" }}
        animate={{ y: 0, rotate: 0, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 90, damping: 16, delay }}
      >
        {children}
      </motion.span>
      {/* The words are separate boxes, so the text itself needs its spaces (search results, screen readers). */}
      <span className="sr-only"> </span>
    </span>
  );
}

/** The clickable words: the current run is lit, with a bar filling while it plays. */
function Picker({ demo }: { demo: ReturnType<typeof useDemo> }) {
  return (
    <span className="inline">
      {scenarios.map((s, i) => {
        const on = demo.index === i;
        return (
          <span key={s.key}>
            <button
              type="button"
              onClick={() => demo.pick(i)}
              className={clsx(
                "relative inline-block rounded-md transition-colors duration-300",
                on ? "text-accent" : "text-fg-2 hover:text-fg",
              )}
            >
              {s.word}
              <span className="absolute inset-x-0 -bottom-0.5 h-[2px] overflow-hidden rounded-full bg-white/10">
                <AnimatePresence>
                  {on && (
                    <motion.span
                      key={`${s.key}-${demo.phase === "done"}`}
                      className="absolute inset-y-0 left-0 bg-accent"
                      initial={{ width: demo.phase === "done" ? "50%" : "0%" }}
                      animate={{ width: demo.phase === "done" ? "100%" : "50%" }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: demo.phase === "done" ? timing.done / 1000 : 5,
                        ease: "linear",
                      }}
                    />
                  )}
                </AnimatePresence>
              </span>
            </button>
            {i < scenarios.length - 2 ? ", " : i === scenarios.length - 2 ? " or " : ""}
          </span>
        );
      })}
    </span>
  );
}
