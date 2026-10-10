/**
 * The right-hand side of onboarding: a stage with some depth (a soft amber light that follows the pointer,
 * a fine grid, a gentle tilt) and, on it, a small living scene for each screen. Each one shows the thing
 * the screen is about happening, rather than an icon standing for it. Everything is still when motion is
 * reduced.
 */

import { AppleLogoIcon, CheckIcon, GithubLogoIcon, GoogleLogoIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ClaudeLogo, CodexLogo } from "../../components/AgentLogo.tsx";

export const ease = [0.22, 1, 0.36, 1] as const;
const spring = { type: "spring", stiffness: 260, damping: 30 } as const;
const AMBER = "#F5A524";

/** Elapsed seconds of a repeating sequence, for scenes that loop. */
function useLoop(seconds: number, run = true): number {
  const [t, setT] = useState(0);
  const start = useRef(performance.now());
  useEffect(() => {
    if (!run) return;
    start.current = performance.now();
    const id = window.setInterval(() => setT(((performance.now() - start.current) / 1000) % seconds), 80);
    return () => window.clearInterval(id);
  }, [seconds, run]);
  return t;
}

/** Draws its children at a fixed size and scales them to fill the space they're given. */
function Fit({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [width, height]);
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden">
      <div
        className="absolute top-1/2 left-1/2"
        style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ stage */

export function Stage({ children, tall }: { children: ReactNode; tall?: boolean }) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [3.5, -3.5]), { stiffness: 120, damping: 20 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-4.5, 4.5]), { stiffness: 120, damping: 20 });
  const lx = useSpring(useTransform(mx, [-0.5, 0.5], [25, 75]), { stiffness: 90, damping: 20 });
  const ly = useSpring(useTransform(my, [-0.5, 0.5], [20, 80]), { stiffness: 90, damping: 20 });
  const light = useMotionTemplate`radial-gradient(520px circle at ${lx}% ${ly}%, rgba(245,165,36,0.11), transparent 62%)`;
  return (
    <div className="[perspective:1400px]">
      <motion.div
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          mx.set((e.clientX - r.left) / r.width - 0.5);
          my.set((e.clientY - r.top) / r.height - 0.5);
        }}
        onPointerLeave={() => {
          mx.set(0);
          my.set(0);
        }}
        style={reduce ? undefined : { rotateX: rx, rotateY: ry }}
        className={clsx(
          "relative isolate flex items-center justify-center overflow-hidden rounded-[28px] border border-line bg-panel shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)]",
          tall ? "aspect-[4/5]" : "aspect-[5/4]",
        )}
      >
        <div className="ob-grid pointer-events-none absolute inset-0 -z-10" />
        <motion.div className="pointer-events-none absolute inset-0 -z-10" style={{ background: light }} />
        <div className="ob-ambient pointer-events-none absolute -z-10 size-[70%] rounded-full bg-accent/[0.07] blur-[90px]" />
        {children}
        <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-white/[0.05] ring-inset" />
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- the mini edit */

/** What the speaker says in the clip's loop, page by page, as the captions show it. */
const WORDS = [
  ["OKAY", 0.4],
  ["SO", 0.8],
  ["HERE'S", 1.15],
  ["THE", 1.5],
  ["THING", 1.8],
  ["NOBODY", 2.5],
  ["TELLS", 2.95],
  ["YOU", 3.3],
  ["ABOUT", 3.9],
  ["EDITING", 4.3],
] as const;

const page = (t: number) => {
  const i = WORDS.findLastIndex(([, at]) => t >= at);
  if (i < 0) return { words: [] as string[], current: -1 };
  const first = i - (i % 3);
  return { words: WORDS.slice(first, Math.min(first + 3, i + 1)).map(([w]) => w), current: i - first };
};

/**
 * The clip playing, captions popping in word by word, a punch-in on the beat, and the playhead running
 * over a timeline that fills in as the edits land. `applied`: the edits are on (the welcome screen turns
 * them on part-way through; the last screen shows them done).
 */
function MiniEdit({ applied, t }: { applied: boolean; t: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const head = useMotionValue(0);
  useAnimationFrame(() => {
    const v = video.current;
    if (v?.duration) head.set(v.currentTime / v.duration);
  });
  const left = useTransform(head, (h) => `${h * 100}%`);
  const { words, current } = page(t % 5.2);
  const punched = applied && t % 5.2 > 2.4 && t % 5.2 < 3.9;
  return (
    <div className="flex h-full w-full flex-col gap-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[18px] bg-sunken ring-1 ring-white/10">
        <motion.video
          ref={video}
          src="onboarding/memes-without.mp4"
          muted
          autoPlay
          loop
          playsInline
          animate={{ scale: punched ? 1.14 : 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          style={{ transformOrigin: "50% 34%" }}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-x-0 bottom-[11%] flex justify-center px-3">
          <AnimatePresence mode="wait">
            {applied && words.length > 0 && (
              <motion.div
                key={words[0]}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                className="flex flex-wrap justify-center gap-x-1.5 text-center text-[17px] leading-tight font-black tracking-tight text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.7)]"
              >
                {words.map((w, i) => (
                  <motion.span
                    key={w + i}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1, color: i === current ? AMBER : "#ffffff" }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  >
                    {w}
                  </motion.span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {punched && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute top-3 left-3 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-accent backdrop-blur"
            >
              punch-in · 1.14×
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* The timeline: the clip, then the lanes the edits add, under one playhead. */}
      <div className="relative flex flex-col gap-1 rounded-xl bg-sunken/80 p-2 ring-1 ring-white/[0.06]">
        <div className="flex h-5 gap-1">
          {[34, 22, 44].map((w, i) => (
            <span
              key={w}
              className={clsx("rounded-md", i === 1 ? "bg-[#55555E]" : "bg-fg/85")}
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
        <div className="relative h-3">
          {[
            [3, 16],
            [22, 18],
            [43, 14],
            [60, 20],
            [84, 13],
          ].map(([at, w], i) => (
            <motion.span
              key={at}
              initial={false}
              animate={{ opacity: applied ? 1 : 0, scaleX: applied ? 1 : 0.2 }}
              transition={{ ...spring, delay: applied ? 0.08 * i : 0 }}
              className="absolute top-0 h-3 origin-left rounded-[4px] bg-accent/80"
              style={{ left: `${at}%`, width: `${w}%` }}
            />
          ))}
        </div>
        <motion.span
          className="absolute top-1 bottom-1 w-[2px] rounded-full bg-accent shadow-[0_0_10px_rgba(245,165,36,0.8)]"
          style={{ left }}
        />
      </div>
    </div>
  );
}

/** Welcome: you ask, the agent watches, and the edit lands, on a loop. */
export function WelcomeScene() {
  const t = useLoop(11);
  const asked = t > 0.9;
  const thinking = t > 2.2 && t < 3.6;
  const applied = t > 3.6;
  const changes = ["Captions · 10 words", "Punch-in on the beat", "Cut the long pause"];
  return (
    <div className="grid h-full w-full grid-cols-[1fr_0.92fr] gap-4 p-6">
      <MiniEdit applied={applied} t={t} />
      <div className="flex flex-col justify-center gap-2.5">
        <AnimatePresence>
          {asked && (
            <motion.div
              key="ask"
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={spring}
              className="self-end rounded-2xl rounded-br-md bg-raised px-3.5 py-2.5 text-[13px] leading-snug text-fg ring-1 ring-white/[0.06]"
            >
              Add captions, and punch in on the good bit
            </motion.div>
          )}
          {thinking && (
            <motion.span
              key="think"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="shimmer text-[12.5px] font-medium"
            >
              Watching every frame…
            </motion.span>
          )}
          {applied && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={spring}
              className="flex flex-col gap-1.5"
            >
              {changes.map((c, i) => (
                <motion.span
                  key={c}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring, delay: 0.12 + i * 0.12 }}
                  className="flex items-center gap-2 rounded-xl bg-sunken/80 px-3 py-2 text-[12px] text-fg-2 ring-1 ring-white/[0.06]"
                >
                  <span className="flex size-4 items-center justify-center rounded-full bg-accent text-accent-fg">
                    <CheckIcon size={10} weight="bold" />
                  </span>
                  {c}
                </motion.span>
              ))}
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="pl-1 text-[11px] text-faint"
              >
                Keep · Undo
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** All set: the edit done and playing, with a little light on it. */
export function ReadyScene() {
  const t = useLoop(10.4);
  return (
    <div className="relative flex h-full w-full items-center justify-center p-6">
      <motion.div
        className="absolute size-[62%] rounded-full bg-accent/20 blur-[70px]"
        animate={{ opacity: [0.45, 0.85, 0.45], scale: [0.92, 1.05, 0.92] }}
        transition={{ duration: 5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...spring, delay: 0.15 }}
        className="relative h-full w-[58%]"
      >
        <MiniEdit applied t={t} />
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.7 }}
          className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-accent-fg shadow-[0_8px_30px_-6px_rgba(245,165,36,0.7)]"
        >
          Your first edit, in a minute
        </motion.span>
      </motion.div>
      <Sparks />
    </div>
  );
}

/** A small burst of amber, once. */
function Sparks() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        const d = 150 + (i % 3) * 40;
        return (
          <motion.span
            key={a}
            className="absolute size-1.5 rounded-full bg-accent"
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
            transition={{ duration: 1.4, ease, delay: 0.5 + (i % 4) * 0.04 }}
          />
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------------------------- account */

const PROVIDER_LOGOS = [GoogleLogoIcon, GithubLogoIcon, AppleLogoIcon];

/** The account: your card, the ways in circling it; it turns over to show you once you're in. */
export function AccountScene({
  user,
  signingIn,
}: {
  user?: { name: string; email: string };
  signingIn: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <Fit width={460} height={420}>
      <div className="relative flex h-full w-full items-center justify-center">
        {/* The ways in, orbiting; drawing in close while the browser is open. */}
        <motion.div
          className="absolute"
          animate={{
            rotate: reduce ? 0 : 360,
            scale: user ? 1.25 : signingIn ? 0.72 : 1,
            opacity: user ? 0 : 1,
          }}
          transition={{
            rotate: { duration: signingIn ? 6 : 22, ease: "linear", repeat: Number.POSITIVE_INFINITY },
            scale: spring,
            opacity: { duration: 0.4 },
          }}
          style={{ width: 330, height: 330 }}
        >
          <div className="absolute inset-0 rounded-full border border-dashed border-white/[0.08]" />
          {PROVIDER_LOGOS.map((Logo, i) => {
            const a = (i / PROVIDER_LOGOS.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <motion.span
                key={a}
                className="absolute flex size-11 items-center justify-center rounded-2xl bg-raised text-fg ring-1 ring-white/10 shadow-lg"
                style={{ left: 165 + Math.cos(a) * 165 - 22, top: 165 + Math.sin(a) * 165 - 22 }}
                animate={{ rotate: reduce ? 0 : -360 }}
                transition={{
                  duration: signingIn ? 6 : 22,
                  ease: "linear",
                  repeat: Number.POSITIVE_INFINITY,
                }}
              >
                <Logo size={20} weight="bold" />
              </motion.span>
            );
          })}
        </motion.div>

        {signingIn && !user && (
          <motion.span
            className="absolute size-44 rounded-full border border-accent/40"
            animate={{ scale: [0.8, 1.35], opacity: [0.7, 0] }}
            transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
          />
        )}

        {/* The card: you, once you're in. */}
        <div className="[perspective:900px]">
          <motion.div
            className="relative h-[170px] w-[226px] [transform-style:preserve-3d]"
            animate={{ rotateY: user ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
          >
            <Card>
              <Mark size={42} />
              <span className="text-[15px] font-semibold text-fg">Your Cutroom account</span>
              <span className="text-[12px] text-faint">
                {signingIn ? "Finish signing in in your browser…" : "Updates · early features · purchases"}
              </span>
            </Card>
            <Card back>
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-[20px] font-bold text-accent-fg">
                {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[210px] truncate text-[15px] font-semibold text-fg">
                {user?.name || user?.email}
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-ok">
                <CheckIcon size={12} weight="bold" /> Signed in
              </span>
            </Card>
          </motion.div>
        </div>
        {user && <Sparks />}
      </div>
    </Fit>
  );
}

function Card({ children, back }: { children: ReactNode; back?: boolean }) {
  return (
    <div
      className={clsx(
        "absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-[22px] bg-gradient-to-b from-card to-sunken px-5 text-center ring-1 ring-white/10 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] [backface-visibility:hidden]",
        back && "[transform:rotateY(180deg)]",
      )}
    >
      {children}
    </div>
  );
}

/** The mark: two clips and the amber playhead between them. */
export function Mark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect width="100" height="100" rx="22.5" fill="#16161A" />
      <rect x="13" y="41" width="31" height="20" rx="4.5" fill="#FFFFFF" />
      <rect x="56" y="41" width="31" height="20" rx="4.5" fill="#55555E" />
      <rect x="48.25" y="29" width="3.5" height="46" rx="1.75" fill={AMBER} />
      <path
        d="M44 22.5 H56 V28 L50 33.5 L44 28 Z"
        fill={AMBER}
        stroke={AMBER}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* --------------------------------------------------------------------------------------------- privacy */

const SENT = ["so", "here's", "the", "thing", "▣", "nobody", "tells", "▣", "you"];

/**
 * What stays and what goes: your clips inside this computer, never leaving it, while a stream of words
 * and the odd frame travels to the agent.
 */
export function PrivacyScene({ agent }: { agent: "claude" | "codex" }) {
  const reduce = useReducedMotion();
  return (
    <Fit width={500} height={400}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 500 400" aria-hidden="true">
        <defs>
          <linearGradient id="ob-flow" x1="0" x2="1">
            <stop offset="0" stopColor={AMBER} stopOpacity="0" />
            <stop offset="0.5" stopColor={AMBER} stopOpacity="0.5" />
            <stop offset="1" stopColor={AMBER} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M262 200 C 320 120, 360 120, 410 175"
          fill="none"
          stroke="url(#ob-flow)"
          strokeWidth="1.5"
          strokeDasharray="3 6"
        />
      </svg>

      {/* This computer, and the clips in it. */}
      <div className="absolute top-[16%] left-[7%] flex h-[62%] w-[48%] flex-col rounded-[22px] bg-sunken/70 p-3 ring-1 ring-white/10">
        <motion.div
          className="pointer-events-none absolute -inset-px rounded-[22px] ring-1 ring-accent/40"
          animate={{ opacity: [0.25, 0.7, 0.25] }}
          transition={{ duration: 3.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <span className="mb-2 flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-faint uppercase">
          This computer
        </span>
        <div className="grid flex-1 grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }, (_, i) => (
            <motion.div
              key={i}
              className="relative overflow-hidden rounded-lg bg-gradient-to-br from-raised to-panel ring-1 ring-white/[0.06]"
              animate={reduce || i % 4 !== 1 ? {} : { x: [0, 7, 0] }}
              transition={{
                duration: 0.9,
                delay: 1.5 + i * 0.7,
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 4,
              }}
            >
              <span className="absolute bottom-1 left-1.5 font-mono text-[8px] text-faint">
                0:{String(8 + i * 3).padStart(2, "0")}
              </span>
              <span className="absolute top-1/2 left-1/2 size-0 -translate-x-1/2 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent border-l-fg-3/50" />
            </motion.div>
          ))}
        </div>
      </div>

      {/* The words and a few frames, on their way to the agent. */}
      {!reduce &&
        SENT.map((w, i) => (
          <motion.span
            key={w + i}
            className={clsx(
              "absolute rounded-md px-1.5 py-0.5 font-mono text-[10px]",
              w === "▣" ? "bg-accent/25 text-accent" : "bg-white/[0.08] text-fg-2",
            )}
            style={{ top: 0, left: 0, offsetPath: "path('M 262 200 C 320 120, 360 120, 410 175')" }}
            initial={{ offsetDistance: "0%", opacity: 0 }}
            animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 2.6,
              delay: i * 0.55,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: SENT.length * 0.55 - 2.6,
              ease: "easeInOut",
            }}
          >
            {w}
          </motion.span>
        ))}

      {/* The agent. */}
      <div className="absolute top-[36%] right-[7%] flex flex-col items-center gap-2">
        <motion.span
          className="flex size-16 items-center justify-center rounded-2xl bg-raised text-fg ring-1 ring-white/10 shadow-lg"
          animate={{
            boxShadow: [
              "0 0 0 0 rgba(245,165,36,0)",
              "0 0 0 10px rgba(245,165,36,0.08)",
              "0 0 0 0 rgba(245,165,36,0)",
            ],
          }}
          transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY }}
        >
          {agent === "codex" ? <CodexLogo size={30} /> : <ClaudeLogo size={30} />}
        </motion.span>
        <span className="font-mono text-[10px] tracking-wide text-faint uppercase">Your agent</span>
      </div>

      <div className="absolute inset-x-[7%] bottom-[7%] flex justify-between text-[11.5px] text-muted">
        <span>Footage · stays here</span>
        <span className="text-fg-3">Words and a few frames · to your agent</span>
      </div>
    </Fit>
  );
}

/* --------------------------------------------------------------------------------------------- agents */

/** Text typed out a character at a time, once. */
function Typed({ text, start = 0, speed = 32 }: { text: string; start?: number; speed?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    let i = 0;
    let timer = 0;
    const begin = window.setTimeout(() => {
      timer = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) window.clearInterval(timer);
      }, speed);
    }, start);
    return () => {
      window.clearTimeout(begin);
      window.clearInterval(timer);
    };
  }, [text, start, speed]);
  return <>{text.slice(0, n)}</>;
}

/** Claude Code's own sign-in, in a terminal, typed out; it lights up when it's done. */
export function TerminalScene({ signedIn, email }: { signedIn: boolean; email?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className={clsx(
        "flex w-[80%] flex-col overflow-hidden rounded-2xl bg-sunken shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] ring-1 transition-[box-shadow] duration-700",
        signedIn ? "ring-ok/40 shadow-[0_0_60px_-10px_rgba(125,211,167,0.35)]" : "ring-white/10",
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="size-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="size-2.5 rounded-full bg-[#28c840]/80" />
        <span className="ml-3 font-mono text-[11px] text-faint">claude</span>
      </div>
      <div className="flex min-h-[150px] flex-col gap-2 p-5 font-mono text-[12.5px] leading-relaxed">
        <span className="text-fg-2">
          <span className="text-accent">$</span> <Typed text="claude auth login" start={300} />
        </span>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="text-muted"
        >
          Opening your browser to sign in…
        </motion.span>
        <AnimatePresence mode="wait">
          {signedIn ? (
            <motion.span
              key="ok"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-ok"
            >
              ✓ Signed in{email ? ` as ${email}` : ""}. Ready to edit.
            </motion.span>
          ) : (
            <motion.span
              key="wait"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 1.6 }}
              className="flex items-center gap-1 text-faint"
            >
              Waiting for you to sign in
              <span className="ob-caret inline-block h-3.5 w-[7px] bg-fg-3/70" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Codex: its mark, breathing while it waits, settled once you're in. */
export function CodexScene({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-6">
      <div className="relative flex items-center justify-center">
        {!signedIn &&
          [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute size-20 rounded-[26px] border border-accent/40"
              animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
              transition={{
                duration: 2.4,
                delay: i * 0.8,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeOut",
              }}
            />
          ))}
        <motion.span
          className={clsx(
            "relative flex size-20 items-center justify-center rounded-[26px] bg-raised text-fg ring-1",
            signedIn ? "ring-ok/50" : "ring-white/10",
          )}
          animate={{ scale: signedIn ? [1, 1.08, 1] : 1 }}
          transition={{ duration: 0.5 }}
        >
          <CodexLogo size={38} />
        </motion.span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[15px] font-medium text-fg">Sign in with ChatGPT</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={String(signedIn)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={clsx("text-[13px]", signedIn ? "text-ok" : "text-faint")}
          >
            {signedIn ? "✓ Signed in. Codex is ready to edit." : "Waiting for you to sign in…"}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------------------- captions */

/** A voice, as a waveform that moves. */
export function Waveform({ bars = 64 }: { bars?: number }) {
  return (
    <div className="flex h-12 w-full items-center justify-between" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="ob-bar w-[3px] rounded-full bg-fg-3/60"
          style={{
            height: `${22 + ((i * 37) % 70)}%`,
            animationDelay: `${-((i * 113) % 1200)}ms`,
            animationDuration: `${900 + ((i * 71) % 700)}ms`,
          }}
        />
      ))}
    </div>
  );
}
