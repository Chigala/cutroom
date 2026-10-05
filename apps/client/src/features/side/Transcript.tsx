/**
 * Edit the video by editing its words. Shows what is said in the cut, in order; selecting words and
 * pressing Delete cuts them out of the video, E emphasizes them in the captions, double-click fixes a
 * misheard word. The word being spoken lights up as it plays.
 */
import { cutWordsOps, type SpokenWord, spokenWords } from "@vedit/project";
import { clsx } from "clsx";
import { Scissors, Sparkles, Type } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { send, useChat } from "../../state/chat.ts";
import { useJobs } from "../../state/jobs.ts";
import { seekTime, useFrameEffect } from "../../state/playback.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";

interface Paragraph {
  readonly key: string;
  readonly words: readonly { word: SpokenWord; i: number }[];
}

/** A new paragraph at each long pause or change of clip, so the text reads like the edit flows. */
function paragraphs(words: readonly SpokenWord[]): Paragraph[] {
  const out: { key: string; words: { word: SpokenWord; i: number }[] }[] = [];
  words.forEach((word, i) => {
    const prev = words[i - 1];
    if (!prev || word.source !== prev.source || word.start - prev.end > 0.9)
      out.push({ key: word.ref, words: [] });
    out.at(-1)!.words.push({ word, i });
  });
  return out;
}

export function Transcript() {
  const words = useDoc(spokenWords);
  const hasTranscripts = useDoc((d) => d.transcripts.some((t) => t.words.length));
  const indexing = useJobs((s) =>
    Object.values(s.indexing).some((e) => e.stage === "transcribe" || e.stage === "setup"),
  );
  const busy = useChat((s) => s.activeRun !== null);
  const paras = useMemo(() => paragraphs(words), [words]);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const spans = useRef(new Map<number, HTMLSpanElement>());
  const lit = useRef<number>(-1);

  // Karaoke: light the word being spoken without re-rendering the panel.
  useFrameEffect((frame, s) => {
    const t = frame / s.fps;
    let lo = 0;
    let hi = words.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = words[mid]!;
      if (t < w.start) hi = mid - 1;
      else if (t >= w.end) lo = mid + 1;
      else {
        found = mid;
        break;
      }
    }
    if (found === lit.current) return;
    spans.current.get(lit.current)?.removeAttribute("data-now");
    spans.current.get(found)?.setAttribute("data-now", "");
    lit.current = found;
  });

  const selected = (i: number) => selection !== null && i >= selection.from && i <= selection.to;
  const selectedWords = () => (selection ? words.slice(selection.from, selection.to + 1) : []);

  const cut = () => {
    const doc = useProject.getState().doc!;
    const refs = new Set(selectedWords().map((w) => w.ref));
    if (!refs.size) return;
    const n = refs.size;
    if (edit(cutWordsOps(doc, refs), { message: `Cut ${n} ${n === 1 ? "word" : "words"}` }))
      setSelection(null);
  };

  const emphasize = () => {
    const doc = useProject.getState().doc!;
    const chosen = selectedWords();
    if (!chosen.length) return;
    const on = !chosen.every((w) => w.emphasis);
    const existing = new Set(doc.wordEdits.map((e) => e.id));
    edit(
      chosen.map((w) =>
        existing.has(w.ref)
          ? { op: "update" as const, coll: "wordEdits" as const, id: w.ref, patch: { emphasis: on } }
          : { op: "insert" as const, coll: "wordEdits" as const, item: { id: w.ref, emphasis: on } },
      ),
      { message: on ? "Emphasized words" : "Removed emphasis" },
    );
  };

  const fix = (w: SpokenWord, text: string) => {
    setFixing(null);
    const next = text.trim();
    if (!next || next === w.text) return;
    const exists = useProject.getState().doc!.wordEdits.some((e) => e.id === w.ref);
    edit(
      [
        exists
          ? { op: "update", coll: "wordEdits", id: w.ref, patch: { text: next === w.heard ? null : next } }
          : { op: "insert", coll: "wordEdits", item: { id: w.ref, text: next } },
      ],
      { message: `Fixed "${w.heard}" → "${next}"` },
    );
  };

  if (!words.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Type size={22} className="text-faint" strokeWidth={1.5} />
        <span className="text-[13px] text-muted">
          {indexing
            ? "Transcribing your footage. Words appear here as soon as they're ready."
            : hasTranscripts
              ? "Nothing said in the current cut."
              : "No speech yet. Import a clip where someone talks, and every word shows up here."}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex h-7 items-center justify-between px-1">
        {selection ? (
          <div className="flex items-center gap-1 animate-fade-in">
            <ToolButton onClick={cut} title="Cut from the video (Delete)">
              <Scissors size={13} /> Cut
            </ToolButton>
            <ToolButton onClick={emphasize} title="Emphasize in captions (E)">
              <Sparkles size={13} /> Emphasize
            </ToolButton>
            <ToolButton
              disabled={busy}
              onClick={() => {
                const chosen = selectedWords();
                const text = chosen.map((w) => w.text).join(" ");
                void send(`About "${text.slice(0, 120)}": `, {
                  words: chosen.map((w) => w.ref),
                  time: chosen[0]!.start,
                });
                setSelection(null);
              }}
              title="Ask the agent about these words"
            >
              Ask
            </ToolButton>
          </div>
        ) : (
          <span className="text-[13px] font-semibold">{words.length} words in the cut</span>
        )}
        {!selection && <span className="font-mono text-[11px] text-faint">drag · Del · E</span>}
      </div>
      <div
        ref={container}
        tabIndex={0}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Transcript of the cut"
        onKeyDown={(e) => {
          if (!selection) return;
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            e.stopPropagation();
            cut();
          } else if (e.key === "e" || e.key === "E") {
            e.preventDefault();
            e.stopPropagation();
            emphasize();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setSelection(null);
          }
        }}
        onMouseUp={() => {
          dragging.current = false;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-line bg-raised p-3 text-[13.5px] leading-[1.75] text-fg-2 outline-none select-none focus-visible:border-edge"
      >
        {paras.map((p) => (
          <Para
            key={p.key}
            para={p}
            spans={spans.current}
            selected={selected}
            fixing={fixing}
            onFix={fix}
            onStartFix={setFixing}
            onDown={(i, shift) => {
              container.current?.focus();
              if (shift && anchor.current !== null) {
                setSelection({ from: Math.min(anchor.current, i), to: Math.max(anchor.current, i) });
                return;
              }
              anchor.current = i;
              dragging.current = true;
              setSelection({ from: i, to: i });
              seekTime(words[i]!.start);
            }}
            onEnter={(i) => {
              if (!dragging.current || anchor.current === null) return;
              setSelection({ from: Math.min(anchor.current, i), to: Math.max(anchor.current, i) });
            }}
          />
        ))}
      </div>
    </div>
  );
}

const Para = memo(function Para({
  para,
  spans,
  selected,
  fixing,
  onFix,
  onStartFix,
  onDown,
  onEnter,
}: {
  para: Paragraph;
  spans: Map<number, HTMLSpanElement>;
  selected: (i: number) => boolean;
  fixing: string | null;
  onFix: (w: SpokenWord, text: string) => void;
  onStartFix: (ref: string | null) => void;
  onDown: (i: number, shift: boolean) => void;
  onEnter: (i: number) => void;
}) {
  return (
    <p className="[content-visibility:auto]">
      {para.words.map(({ word, i }) =>
        fixing === word.ref ? (
          <input
            key={word.ref}
            // biome-ignore lint/a11y/noAutofocus: entered fix mode on purpose
            autoFocus
            defaultValue={word.text}
            aria-label={`Correct "${word.heard}"`}
            onBlur={(e) => onFix(word, e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") onStartFix(null);
            }}
            className="mx-0.5 w-24 rounded bg-bg px-1 text-fg outline-none ring-1 ring-accent"
          />
        ) : (
          <span
            key={word.ref}
            ref={(el) => {
              if (el) spans.set(i, el);
              else spans.delete(i);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              onDown(i, e.shiftKey);
            }}
            onMouseEnter={() => onEnter(i)}
            onDoubleClick={() => onStartFix(word.ref)}
            title={word.text !== word.heard ? `Heard "${word.heard}"` : undefined}
            className={clsx(
              "rounded-[3px] px-[1px] transition-colors data-[now]:bg-fg/15 data-[now]:text-fg",
              selected(i) && "bg-accent/30 text-fg",
              word.emphasis && "font-semibold text-accent",
              word.text !== word.heard &&
                "underline decoration-dotted decoration-accent/70 underline-offset-4",
              word.hidden && "opacity-40",
            )}
          >
            {word.text}{" "}
          </span>
        ),
      )}
    </p>
  );
});

function ToolButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-control px-2.5 text-xs text-fg-2 hover:bg-selected disabled:opacity-40"
    />
  );
}
