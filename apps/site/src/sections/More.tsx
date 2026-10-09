import { PlusIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Mark } from "../ui/Logo.tsx";
import { Reveal, Words } from "../ui/Reveal.tsx";
import { DownloadButton } from "./Hero.tsx";

const prompts = [
  "Put me in Tokyo at night",
  "Big title behind my head",
  "Edit it like this video",
  "Blur the background like a cinema lens",
  "Cut every pause over half a second",
  "Make the hook punchier",
  "Tighten the middle, it drags",
  "Add a zoom on every laugh",
  "Bold word-by-word captions",
  "Cut the ums",
  "Resolve the open comments",
  "Make it feel like a Pinterest moodboard",
  "Slow the opening",
  "Add a chart for the numbers he says",
  "Sound design pass",
  "Make a 9:16 and a 16:9",
  "Match the style of this reference",
];

export function Marquee() {
  const row = [...prompts, ...prompts];
  return (
    <div className="relative overflow-hidden py-10 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
      <div className="marquee flex w-max gap-3">
        {row.map((p, i) => (
          <span
            key={i}
            className="rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[14px] whitespace-nowrap text-fg-3"
          >
            “{p}”
          </span>
        ))}
      </div>
    </div>
  );
}

const faq = [
  {
    q: "Which agents does it work with?",
    a: "Claude Code and Codex today: pick one in the app and sign in with your own account. More agents are coming soon.",
  },
  {
    q: "What does it actually see?",
    a: "Every frame and every word: who's in the shot and where their face is, a cutout of each person, what's behind them, the shots, pauses, beats and sound effects. It all runs on your computer, so it can swap a background, put a title behind someone or land a cut on a laugh.",
  },
  {
    q: "How does learning from a video work?",
    a: "Drop in a video whose style you like. Cutroom watches it play and measures its cuts, punch-ins, transitions, beat, sound effects and captions, then writes it up as an inspiration. Use it on any video, and it compares its edit with the original to check it got it right.",
  },
  {
    q: "Is it really free?",
    a: "Yes. Cutroom runs on your computer and uses your own Claude Code or Codex sign-in, so it costs nothing beyond the Claude or ChatGPT plan you already have.",
  },
  {
    q: "What do I need?",
    a: "A Mac on macOS 13.3 or later, and Claude Code (on a Claude plan) or Codex (on a ChatGPT plan). Speech recognition downloads itself the first time you import a clip. Windows and Linux versions are coming soon.",
  },
  {
    q: "Does my footage get uploaded?",
    a: "Your video files never leave your computer: transcription, indexing, preview and export all run locally. Your agent reads the project's files, the transcript and the few frames it asks to look at, the way a coding agent reads a code project.",
  },
  {
    q: "Can I still edit by hand?",
    a: "Always. Drag clips on the timeline, edit the words, or open the project folder in any editor. The agent picks up your changes.",
  },
  {
    q: "What does it export?",
    a: "MP4 in any shape: 9:16 for TikTok, Reels and Shorts, 4:5, 1:1 or 16:9, with a cover image.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative isolate overflow-clip py-28 md:py-36">
      <div className="pointer-events-none absolute top-1/4 right-[-10%] -z-10 size-[520px] rounded-full bg-accent/[0.07] blur-[120px]" />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16">
        {/* The intro stays put while the questions scroll past. */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Reveal>
            <span className="font-mono text-[12px] tracking-[0.2em] text-accent uppercase">FAQ</span>
          </Reveal>
          <h2 className="mt-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[52px]">
            <Words text="Questions, answered." />
          </h2>
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-sm text-[16px] leading-relaxed text-muted">
              What it sees, what it costs, and what stays on your computer.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-8 hidden rounded-3xl border border-white/[0.07] bg-gradient-to-b from-card to-panel p-5 lg:block">
              <div className="flex items-center gap-3">
                <Mark size={36} />
                <div>
                  <div className="text-[15px] font-semibold">Try it on your own footage</div>
                  <div className="text-[13px] text-muted">Free · Mac · Claude Code or Codex</div>
                </div>
              </div>
              <div className="mt-4 origin-left scale-[0.9]">
                <DownloadButton />
              </div>
            </div>
          </Reveal>
        </div>

        <div className="flex flex-col gap-2.5">
          {faq.map((f, i) => {
            const on = open === i;
            return (
              <Reveal key={f.q} delay={i * 0.04} y={14}>
                <motion.div
                  layout
                  transition={{ type: "spring", stiffness: 300, damping: 32 }}
                  className={clsx(
                    "group relative overflow-hidden rounded-2xl border transition-[border-color,background-color,box-shadow] duration-300",
                    on
                      ? "border-accent/35 bg-gradient-to-b from-accent/[0.07] to-panel shadow-[0_20px_60px_-30px_rgba(245,165,36,0.5)]"
                      : "border-white/[0.07] bg-panel/70 hover:border-white/15 hover:bg-panel",
                  )}
                >
                  <motion.span
                    className="absolute inset-y-0 left-0 w-[3px] origin-top bg-accent"
                    animate={{ scaleY: on ? 1 : 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 28 }}
                  />
                  <button
                    type="button"
                    onClick={() => setOpen(on ? null : i)}
                    aria-expanded={on}
                    className="flex w-full items-center gap-4 px-5 py-4.5 text-left sm:px-6"
                  >
                    <span
                      className={clsx(
                        "font-mono text-[11px] tabular transition-colors",
                        on ? "text-accent" : "text-faint",
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={clsx(
                        "flex-1 text-[16.5px] font-medium transition-colors",
                        on ? "text-fg" : "text-fg-2",
                      )}
                    >
                      {f.q}
                    </span>
                    <motion.span
                      animate={{ rotate: on ? 45 : 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 22 }}
                      className={clsx(
                        "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
                        on ? "bg-accent text-accent-fg" : "bg-white/[0.05] text-muted group-hover:text-fg",
                      )}
                    >
                      <PlusIcon size={15} weight="bold" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.div
                        initial={{ height: 0, opacity: 0, filter: "blur(4px)" }}
                        animate={{ height: "auto", opacity: 1, filter: "blur(0px)" }}
                        exit={{ height: 0, opacity: 0, filter: "blur(4px)" }}
                        transition={{ type: "spring", stiffness: 260, damping: 30 }}
                        className="overflow-hidden"
                      >
                        <p className="px-5 pb-5 pl-[52px] text-[15px] leading-relaxed text-muted sm:px-6 sm:pl-[60px]">
                          {f.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-center text-[13px] text-faint">
        <span className="flex items-center gap-2">
          <Mark size={20} /> Cutroom © {new Date().getFullYear()}
        </span>
        <a href="/privacy" className="ml-5 transition-colors hover:text-fg-2">
          Privacy
        </a>
        <a href="/terms" className="ml-4 transition-colors hover:text-fg-2">
          Terms
        </a>
      </div>
    </footer>
  );
}
