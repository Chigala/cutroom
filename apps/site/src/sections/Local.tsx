import { CloudArrowUpIcon, FileIcon, LaptopIcon, LockSimpleIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ClaudeLogo, CodexLogo } from "../ui/AgentLogos.tsx";
import { Reveal, Words } from "../ui/Reveal.tsx";

/** What runs on the computer itself. */
const local = [
  ["Speech", "every word, timed"],
  ["Person cutouts", "every frame"],
  ["Faces & people", "found and tracked"],
  ["Shots & beats", "cuts, pauses, rhythm"],
  ["Sounds", "laughs, whooshes, music"],
  ["Render", "your MP4, exported"],
];

/** What travels between Cutroom and the user's own agent, both ways. */
const outbound = ["“punchier hook”", "transcript.json", "3 frames"];
const inbound = ["edit timeline.json", "new title.html"];

const files = ["timeline.json", "transcript.json", "graphics/title.html", "looks/warm.css"];

export function Local() {
  return (
    <section className="relative isolate overflow-clip py-28 md:py-40">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_40%_at_35%_55%,rgba(245,165,36,0.09),transparent)]" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <span className="font-mono text-[12px] tracking-[0.2em] text-accent uppercase">
              On your computer
            </span>
          </Reveal>
          <h2 className="mt-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[52px]">
            <Words text="Your footage stays home. Your agent does the thinking." />
          </h2>
        </div>

        <Reveal delay={0.1}>
          <div className="mt-16 grid items-center gap-5 lg:grid-cols-[1.35fr_0.55fr_0.9fr]">
            <Machine />
            <Wire />
            <AgentNode />
          </div>
        </Reveal>

        <div className="mt-10 grid grid-cols-3 gap-2 sm:mt-14 sm:gap-3">
          <Stat
            from={2400}
            to={0}
            format={(v) =>
              v >= 1000 ? `${(v / 1000).toFixed(1)} GB` : v >= 1 ? `${Math.round(v)} MB` : "0 bytes"
            }
            label="of footage uploaded"
          />
          <Stat from={0} to={0} format={(v) => `$${Math.round(v)}`} label="extra a month" />
          <Stat from={0} to={1} format={(v) => `${Math.round(v)}`} label="installer, no setup" />
        </div>
      </div>
    </section>
  );
}

function Machine() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15%" });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = window.setInterval(() => setShown((n) => (n + 1) % (files.length + 3)), 900);
    return () => window.clearInterval(t);
  }, [inView]);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-panel/90 p-5 shadow-[0_40px_100px_-40px_rgba(0,0,0,0.9)]"
    >
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <LaptopIcon size={18} className="text-accent" /> Your Mac
        </span>
        {/* The upload that never happens. */}
        <span className="relative flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 text-[12px] text-faint">
          <CloudArrowUpIcon size={13} /> <span className="sm:hidden">Uploading</span>
          <span className="hidden sm:inline">Upload footage to a server</span>
          <motion.span
            className="absolute top-1/2 left-2 h-[1.5px] origin-left bg-accent"
            style={{ right: 8 }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: inView ? 1 : 0 }}
            transition={{ duration: 0.6, delay: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        </span>
      </div>

      <div className="relative mt-5 flex items-center gap-2">
        {["/demo/before.jpg", "/demo/head.jpg", "/demo/latte.jpg", "/demo/meme.jpg"].map((src, i) => (
          <motion.img
            key={src}
            src={src}
            alt=""
            className="h-14 w-11 rounded-md object-cover ring-1 ring-white/10"
            animate={inView ? { y: [0, -4, 0] } : {}}
            transition={{
              duration: 2.4,
              delay: i * 0.25,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
          />
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full whitespace-nowrap bg-ok/10 px-2.5 py-1 text-[12px] text-ok">
          <LockSimpleIcon size={12} weight="fill" /> stays here
        </span>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {local.map(([k, v], i) => (
          <div key={k}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-medium text-fg-2">{k}</span>
              <span className="hidden text-[11.5px] text-faint sm:inline">{v}</span>
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent"
                animate={inView ? { x: ["-100%", "300%"] } : {}}
                transition={{
                  duration: 1.8 + (i % 3) * 0.4,
                  delay: i * 0.2,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="relative mt-5 rounded-xl border border-line bg-sunken/80 p-3">
        <div className="mb-2 font-mono text-[11px] text-faint">~/Cutroom/monday-vlog/</div>
        <div className="flex min-h-[30px] flex-wrap gap-1.5">
          <AnimatePresence>
            {files.slice(0, Math.min(shown, files.length)).map((f) => (
              <motion.span
                key={f}
                layout
                initial={{ opacity: 0, scale: 0.8, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
                className="flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[11px] text-fg-3"
              >
                <FileIcon size={11} className="text-accent" /> {f}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** Whether the layout is the wide one (cards side by side, lg and up). */
function useWide() {
  const [wide, set] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => set(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * The line to the agent: two lanes, one packet travelling each way at a time. Words and a few frames go
 * out, edits to files come back. Across on wide screens, down between the stacked cards on a phone.
 */
function Wire() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10%" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = window.setInterval(() => setN((x) => x + 1), 1800);
    return () => window.clearInterval(t);
  }, [inView]);
  const wide = useWide();
  const lanes = [
    { items: outbound, out: true, label: "to your agent" },
    { items: inbound, out: false, label: "back to your Mac" },
  ];
  return (
    <div
      ref={ref}
      className="relative mx-auto grid h-[150px] w-full max-w-[340px] grid-cols-2 gap-3 lg:h-[220px] lg:max-w-none lg:grid-cols-1 lg:grid-rows-2"
    >
      {lanes.map((lane) => (
        <div key={lane.label} className="relative flex flex-col items-center justify-center overflow-hidden">
          {/* The track. */}
          <span
            className={clsx(
              "absolute rounded-full",
              "inset-y-0 left-1/2 w-px -translate-x-1/2 lg:inset-x-0 lg:top-1/2 lg:left-0 lg:h-px lg:w-auto lg:translate-x-0",
              lane.out
                ? "bg-gradient-to-b from-white/5 via-white/25 to-white/5 lg:bg-gradient-to-r"
                : "bg-gradient-to-b from-accent/5 via-accent/40 to-accent/5 lg:bg-gradient-to-r",
            )}
          />
          <AnimatePresence initial={false}>
            <motion.span
              key={n}
              className={clsx(
                "absolute rounded-full px-2.5 py-1 font-mono text-[10.5px] whitespace-nowrap shadow-[0_6px_20px_-6px_rgba(0,0,0,0.8)] ring-1",
                lane.out ? "bg-[#232322] text-fg-2 ring-white/10" : "bg-[#2a2213] text-accent ring-accent/30",
              )}
              initial={{ opacity: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                [wide ? "x" : "y"]: lane.out ? [-50, 50] : [50, -50],
              }}
              transition={{ duration: 1.7, times: [0, 0.15, 0.8, 1], ease: [0.45, 0, 0.2, 1] }}
            >
              {lane.items[n % lane.items.length]}
            </motion.span>
          </AnimatePresence>
          <span className="absolute bottom-0 font-mono text-[10px] text-faint lg:bottom-auto lg:top-0">
            <span className="lg:hidden">{lane.out ? "↓ " : "↑ "}</span>
            <span className="hidden lg:inline">{lane.out ? "→ " : "← "}</span>
            {lane.label}
          </span>
        </div>
      ))}
    </div>
  );
}

const agents = [
  { id: "claude", name: "Claude Code", plan: "On your Claude plan", Logo: ClaudeLogo },
  { id: "codex", name: "Codex", plan: "On your ChatGPT plan", Logo: CodexLogo },
] as const;

/** The agent that edits: Claude Code or Codex, the user's own sign-in either way. More are on the way. */
function AgentNode() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15%" });
  const [pick, setPick] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!inView || held) return;
    const t = window.setInterval(() => setPick((n) => (n + 1) % agents.length), 3200);
    return () => window.clearInterval(t);
  }, [inView, held]);
  const a = agents[pick]!;

  return (
    <div
      ref={ref}
      className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-card to-panel p-6"
    >
      <motion.span
        className="pointer-events-none absolute -inset-px rounded-3xl"
        animate={{
          boxShadow: [
            "0 0 0 0 rgba(245,165,36,0)",
            "0 0 40px 2px rgba(245,165,36,0.18)",
            "0 0 0 0 rgba(245,165,36,0)",
          ],
        }}
        transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY }}
      />
      <span className="font-mono text-[11px] tracking-[0.18em] text-faint uppercase">Your agent</span>

      {/* Which one: switches by itself, or pick one. */}
      <div className="relative mt-3 flex rounded-xl bg-sunken p-1 ring-1 ring-white/[0.06]">
        {agents.map((x, i) => (
          <button
            key={x.id}
            type="button"
            onClick={() => {
              setPick(i);
              setHeld(true);
            }}
            className="relative flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-medium"
          >
            {pick === i && (
              <motion.span
                layoutId="agent-pick"
                className="absolute inset-0 rounded-lg bg-raised ring-1 ring-white/10"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <x.Logo size={15} className={clsx("relative", x.id === "codex" && "text-fg")} />
            <span className={clsx("relative transition-colors", pick === i ? "text-fg" : "text-muted")}>
              {x.name}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3.5">
        <div className="relative grid size-12 place-items-center overflow-hidden rounded-xl bg-white/[0.05] ring-1 ring-white/10">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={a.id}
              initial={{ y: 24, opacity: 0, rotate: -30 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: -24, opacity: 0, rotate: 30 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
            >
              <a.Logo size={26} className={a.id === "codex" ? "text-fg" : undefined} />
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="min-w-0">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ duration: 0.35 }}
            >
              <h3 className="text-[18px] font-semibold tracking-tight">{a.name}</h3>
              <div className="text-[13px] text-accent">{a.plan}</div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <p className="mt-4 text-[14.5px] leading-relaxed text-muted">
        Signed in as you, on the plan you already have. It reads the words and the frames it asks for, and
        answers with edits to your project's files.
      </p>

      {/* What's next. */}
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-3 py-2.5">
        <div className="flex -space-x-1.5">
          {[0, 1, 2].map((n) => (
            <motion.span
              key={n}
              className="grid size-6 place-items-center rounded-full border border-dashed border-white/20 bg-panel text-[12px] text-faint"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2.4, delay: n * 0.4, repeat: Number.POSITIVE_INFINITY }}
            >
              +
            </motion.span>
          ))}
        </div>
        <span className="text-[13px] text-fg-3">More agents coming soon</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
        {["No API keys", "No new subscription", "Undo anything"].map((t) => (
          <span key={t} className="rounded-full border border-line-strong px-2.5 py-0.5 text-fg-3">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  from,
  to,
  format,
  label,
}: {
  from: number;
  to: number;
  format: (v: number) => string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });
  const v = useMotionValue(from);
  const text = useTransform(v, format);
  useEffect(() => {
    if (!inView) return;
    const c = animate(v, to, { duration: 1.8, ease: [0.22, 1, 0.36, 1], delay: 0.2 });
    return () => c.stop();
  }, [inView, v, to]);
  return (
    <div ref={ref} className="rounded-2xl border border-white/[0.07] bg-panel/70 px-3 py-3 sm:px-5 sm:py-4">
      <motion.div className="text-[22px] leading-none font-semibold tracking-tight whitespace-nowrap text-fg tabular sm:text-[34px]">
        {text}
      </motion.div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-muted sm:mt-2 sm:text-[13.5px]">{label}</div>
    </div>
  );
}
