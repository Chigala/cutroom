import {
  AppleLogoIcon,
  ChatCircleIcon as CommentIcon,
  DownloadSimpleIcon,
  HeartIcon,
  LinuxLogoIcon,
  ShareFatIcon,
  WindowsLogoIcon,
} from "@phosphor-icons/react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { type Look, Stage } from "../demo/Stage.tsx";
import { faceAt } from "../demo/track.ts";
import { downloads, VERSION } from "../downloads.ts";
import { Words } from "../ui/Reveal.tsx";
import { DownloadButton } from "./Hero.tsx";

const noop = () => {};

const looks: { look: Look; prompt: string }[] = [
  { look: 1, prompt: "Put me in Tokyo at night" },
  { look: 2, prompt: "A huge title behind me" },
  { look: 3, prompt: "Make it a synthwave video" },
  { look: 4, prompt: "Make it cinematic" },
];

/** Hearts, comments and shares climbing up the side, the way the edited version would do once posted. */
function Engagement({ on }: { on: boolean }) {
  return (
    <div className="absolute right-2.5 bottom-[18%] flex flex-col items-center gap-3.5 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
      <Count on={on} Icon={HeartIcon} to={48200} fill />
      <Count on={on} Icon={CommentIcon} to={1312} />
      <Count on={on} Icon={ShareFatIcon} to={6904} fill />
    </div>
  );
}

function Count({ on, Icon, to, fill }: { on: boolean; Icon: typeof HeartIcon; to: number; fill?: boolean }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)}K` : `${Math.round(x)}`));
  useEffect(() => {
    if (!on) return;
    const c = animate(v, to, { duration: 6, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [on, v, to]);
  return (
    <div className="flex flex-col items-center">
      <Icon
        size={22}
        weight={fill ? "fill" : "bold"}
        className={Icon === HeartIcon ? "text-[#ff4d6d]" : undefined}
      />
      <motion.span className="mt-0.5 text-[10px] font-semibold tabular">{text}</motion.span>
    </div>
  );
}

/**
 * The close: the logo, alive. What you shot plays on the left, the same clip edited live on the right (cycling
 * through the hero's looks), and the amber playhead drops onto the cut between them as the section scrolls in.
 */
export function Download() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.15"] });
  const p = useSpring(scrollYProgress, { stiffness: 110, damping: 26 });
  const left = useTransform(p, [0, 0.75], ["-55%", "0%"]);
  const right = useTransform(p, [0, 0.75], ["55%", "0%"]);
  const tiltL = useTransform(p, [0, 0.75], [-10, -3]);
  const tiltR = useTransform(p, [0, 0.75], [10, 3]);
  const drop = useTransform(p, [0.55, 0.95], [0, 1]);
  const headOpacity = useTransform(p, [0.5, 0.6], [0, 1]);
  // Both clips play only while on screen; the edited one cycles through what you could ask for.
  const stage = useRef<HTMLDivElement>(null);
  const live = useInView(stage, { margin: "0px 0px -10% 0px" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setN((x) => x + 1), 3000);
    return () => window.clearInterval(t);
  }, [live]);
  const glow = useTransform(p, [0.8, 1], [0, 1]);

  return (
    <section
      id="download"
      ref={ref}
      className="relative isolate overflow-clip px-4 pt-24 pb-28 sm:px-6 md:pt-32"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_55%_at_50%_45%,rgba(245,165,36,0.16),transparent)]" />
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-60" />

      {/* The mark, alive: the raw clip and the same clip edited, the playhead on the cut between them. */}
      <div
        ref={stage}
        className="relative mx-auto flex max-w-3xl items-center justify-center [perspective:1600px]"
      >
        <motion.figure style={{ x: left, rotateY: tiltL }} className="w-[40%] max-w-[260px]">
          <div className="relative aspect-[432/820] overflow-hidden rounded-[22px] ring-1 ring-white/15">
            <Stage look={0} seeing={false} running={live} onTime={noop} face={faceAt} />
            <span className="absolute top-3 left-3 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white/85 backdrop-blur">
              take_3.mov
            </span>
          </div>
          <figcaption className="mt-4 text-center font-mono text-[11px] tracking-widest text-faint uppercase">
            What you shot
          </figcaption>
        </motion.figure>

        <div className="relative w-[14%] max-w-[90px] self-stretch">
          <motion.div
            style={{ scaleY: drop, opacity: headOpacity }}
            className="absolute top-[-6%] bottom-[9%] left-1/2 flex origin-top -translate-x-1/2 flex-col items-center"
          >
            <svg aria-hidden="true" width="30" height="23" viewBox="0 0 12 9" className="shrink-0">
              <path d="M0 0 H12 V5.5 L6 9 L0 5.5 Z" fill="#f5a524" />
            </svg>
            <span className="-mt-1 w-[4px] flex-1 rounded-full bg-accent" />
            <motion.span
              style={{ opacity: glow }}
              className="absolute inset-x-[-14px] top-0 bottom-0 -z-10 rounded-full bg-accent/50 blur-xl"
            />
          </motion.div>
        </div>

        <motion.figure style={{ x: right, rotateY: tiltR }} className="w-[40%] max-w-[260px]">
          <div className="relative aspect-[432/820] overflow-hidden rounded-[22px] ring-1 ring-accent/50 shadow-[0_30px_90px_-20px_rgba(245,165,36,0.45)]">
            <Stage
              look={looks[n % looks.length]!.look}
              seeing={false}
              running={live}
              onTime={noop}
              face={faceAt}
            />
            <Engagement on={live} />
          </div>
          <figcaption className="mt-4 flex h-5 items-center justify-center whitespace-nowrap text-center font-mono text-[10px] tracking-wide text-accent [clip-path:inset(0_-100vw)] sm:text-[11px]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={n}
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -16, opacity: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
              >
                “{looks[n % looks.length]!.prompt}”
              </motion.span>
            </AnimatePresence>
          </figcaption>
        </motion.figure>
      </div>
      <div className="mx-auto mt-16 flex max-w-3xl flex-col items-center text-center">
        <h2 className="text-[42px] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[68px]">
          <Words text="Make your next video tonight." />
        </h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-5 text-[17px] text-muted"
        >
          Free. Bring Claude Code or Codex and start editing in a minute.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ type: "spring", stiffness: 200, damping: 18, delay: 0.4 }}
          className="relative mt-9"
        >
          <motion.span
            className="absolute inset-0 -z-10 rounded-full bg-accent/40 blur-2xl"
            animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
          <DownloadButton big />
        </motion.div>

        {/* Every build, in one quiet row. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.55 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[13px]"
        >
          {downloads.mac.files.map((f) => (
            <a
              key={f.label}
              href={f.href}
              className="group flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-fg-2 transition-colors hover:border-accent/60 hover:text-fg"
            >
              <AppleLogoIcon size={13} weight="fill" />
              {f.label}
              <DownloadSimpleIcon
                size={12}
                className="text-faint transition-colors group-hover:text-accent"
              />
            </a>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          {[
            [WindowsLogoIcon, "Windows"],
            [LinuxLogoIcon, "Linux"],
          ].map(([I, name]) => {
            const Icon = I as typeof WindowsLogoIcon;
            return (
              <span
                key={name as string}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-faint"
                title="Coming soon"
              >
                <Icon size={13} weight="fill" />
                {name as string}
                <span className="rounded-full bg-accent/12 px-1.5 text-[10.5px] font-medium text-accent">
                  soon
                </span>
              </span>
            );
          })}
        </motion.div>
        <p className="mt-4 font-mono text-[11.5px] text-faint">
          v{VERSION} · macOS 13.3 or later · Apple silicon and Intel
        </p>
        <p className="mt-2 max-w-md text-[12px] leading-relaxed text-faint">
          First launch: macOS says it can't check Cutroom. Open System Settings → Privacy &amp; Security and
          choose Open Anyway, once.
        </p>
      </div>
    </section>
  );
}
