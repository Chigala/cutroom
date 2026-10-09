import { FileIcon, FolderOpenIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Reveal, Words } from "../ui/Reveal.tsx";

const tree = [
  { name: "project.json", depth: 0 },
  { name: "timeline.json", depth: 0 },
  { name: "transcript.json", depth: 0 },
  { name: "graphics/", depth: 0, dir: true },
  { name: "lower-third.html", depth: 1 },
  { name: "hook-title.html", depth: 1 },
  { name: "looks/", depth: 0, dir: true },
  { name: "warm-film.css", depth: 1 },
  { name: "checks.md", depth: 0 },
];

/** Edits that play one after another in the file view. Each one replaces a line, like a real diff. */
const edits = [
  {
    file: "timeline.json",
    who: "Claude",
    lines: [
      '{ "id": "sc1", "from": 0.0, "to": 2.1 },',
      '{ "id": "sc2", "from": 2.1, "to": 4.0 },',
      '{ "id": "sc3", "from": 4.0, "to": 6.0 }',
    ],
    at: 1,
    next: '{ "id": "sc2", "from": 2.4, "to": 3.6, "speed": 1.15 },',
    note: "Tighten the middle",
  },
  {
    file: "looks/warm-film.css",
    who: "You, in VS Code",
    lines: [".frame {", "  filter: contrast(1.05) saturate(0.9);", "  grain: 0.12;", "}"],
    at: 1,
    next: "  filter: contrast(1.12) saturate(1.1) sepia(0.08);",
    note: "Warmer, by hand",
  },
  {
    file: "graphics/hook-title.html",
    who: "Claude",
    lines: ['<h1 class="hook">', "  I quit coffee for 30 days", "</h1>"],
    at: 1,
    next: '  I quit coffee for <em class="accent">30 days</em>',
    note: "Make the number pop",
  },
];

export function Files() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20%" });
  const [i, setI] = useState(0);
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const t = window.setTimeout(
      () => {
        if (!applied) setApplied(true);
        else {
          setApplied(false);
          setI((n) => (n + 1) % edits.length);
        }
      },
      applied ? 2600 : 1300,
    );
    return () => window.clearTimeout(t);
  }, [inView, applied]);
  const e = edits[i]!;

  return (
    <section
      id="files"
      className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-28 sm:px-6 md:grid-cols-[1fr_1.15fr] md:py-40"
    >
      <div>
        <Reveal>
          <span className="font-mono text-[12px] tracking-[0.2em] text-accent uppercase">
            Everything is a file
          </span>
        </Reveal>
        <h2 className="mt-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[52px]">
          <Words text="Your edit is a folder you can read." />
        </h2>
        <Reveal delay={0.15}>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-muted">
            The timeline, the titles, the look: all plain files. The agent edits them, you can too, in any
            editor. Nothing hides in a black box, and every change can be undone.
          </p>
        </Reveal>
      </div>

      <Reveal delay={0.1}>
        <div
          ref={ref}
          className="relative overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]"
        >
          <div className="flex h-10 items-center gap-2 border-b border-line px-4">
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="ml-3 font-mono text-[12px] text-faint">~/Cutroom/morning-coffee-talk</span>
          </div>
          <div className="flex min-h-[300px]">
            <div className="hidden w-[190px] shrink-0 border-r border-line py-3 sm:block">
              <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[12px] text-muted">
                <FolderOpenIcon size={14} /> morning-coffee-talk
              </div>
              {tree.map((f) => {
                const on = e.file.endsWith(f.name) && !f.dir;
                return (
                  <div
                    key={f.name}
                    className={clsx(
                      "relative flex items-center gap-1.5 py-[3px] font-mono text-[12px]",
                      on ? "text-fg" : "text-faint",
                    )}
                    style={{ paddingLeft: 20 + f.depth * 14 }}
                  >
                    {on && (
                      <motion.span
                        layoutId="file-hl"
                        className="absolute inset-0 bg-accent/12"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                    {f.dir ? (
                      <FolderOpenIcon size={12} className="relative" />
                    ) : (
                      <FileIcon size={12} className="relative" />
                    )}
                    <span className="relative">{f.name}</span>
                    {on && applied && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="relative ml-auto mr-3 size-1.5 rounded-full bg-accent"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="min-w-0 flex-1 py-3 font-mono text-[12.5px] leading-[1.9]">
              <div className="flex items-center justify-between px-4 pb-2 text-[11px] text-faint">
                <span>{e.file}</span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={`${i}-${applied}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={clsx(
                      "rounded-full px-2 py-0.5",
                      applied ? "bg-accent/15 text-accent" : "bg-white/5",
                    )}
                  >
                    {applied ? `${e.who} · ${e.note}` : "watching for changes"}
                  </motion.span>
                </AnimatePresence>
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={i}
                  initial={{ opacity: 0, filter: "blur(6px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(6px)" }}
                  transition={{ duration: 0.35 }}
                >
                  {e.lines.map((l, n) => (
                    <div key={n}>
                      {n === e.at && applied ? (
                        <>
                          <motion.div
                            initial={{ opacity: 1 }}
                            animate={{ opacity: 0.55 }}
                            className="flex gap-3 truncate bg-bad/10 px-4 text-[#f3a9a9] line-through decoration-bad/40"
                          >
                            <span className="w-4 shrink-0 text-right text-bad/60">−</span>
                            {l}
                          </motion.div>
                          <motion.div
                            initial={{ opacity: 0, x: -12, backgroundColor: "rgba(125,211,167,0.3)" }}
                            animate={{ opacity: 1, x: 0, backgroundColor: "rgba(125,211,167,0.08)" }}
                            transition={{ type: "spring", stiffness: 260, damping: 24 }}
                            className="flex gap-3 truncate px-4 text-[#bfe6cf]"
                          >
                            <span className="w-4 shrink-0 text-right text-ok/60">+</span>
                            {e.next}
                          </motion.div>
                        </>
                      ) : (
                        <div className="flex gap-3 truncate px-4 text-fg-3">
                          <span className="w-4 shrink-0 text-right text-faint/60">{n + 1}</span>
                          {l}
                        </div>
                      )}
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
