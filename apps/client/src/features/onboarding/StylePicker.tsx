/**
 * The STYLE.md new projects start with: pick the closest kind of video, then make it yours, or write
 * your own. Used at onboarding and in Settings → Editing. Saved as settings.style (empty: the default),
 * a moment after each change.
 */
import { DEFAULT_STYLE, STYLE_PRESETS } from "@vedit/project";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { saveSettings } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";

const OWN = `# Style

How I like my videos. The agent reads this before every edit, and you can change it any time.

- `;

/** The text being edited, saved a moment after it changes. Empty saved style shows the default. */
export function useStyleDraft(saved: string) {
  const [text, setText] = useState(saved.trim() ? saved : DEFAULT_STYLE);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(text);
  const save = (next: string) => {
    latest.current = next;
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void saveSettings({ style: next.trim() === DEFAULT_STYLE.trim() ? "" : next }).catch((err: Error) =>
        toast(`Couldn't save your style: ${err.message}`, "warn"),
      );
    }, 400);
  };
  // Leaving mid-edit still saves it.
  useEffect(
    () => () => {
      if (timer.current === undefined) return;
      clearTimeout(timer.current);
      const next = latest.current;
      void saveSettings({ style: next.trim() === DEFAULT_STYLE.trim() ? "" : next });
    },
    [],
  );
  return { text, setText: save };
}

const matching = (text: string) => STYLE_PRESETS.find((p) => p.text.trim() === text.trim())?.id ?? "own";

export function PresetGrid({
  text,
  onPick,
  compact,
}: {
  text: string;
  onPick: (text: string) => void;
  /** Names only (Settings); otherwise each with who it's for. */
  compact?: boolean;
}) {
  const at = matching(text);
  const options = [
    ...STYLE_PRESETS.map((p) => ({ id: p.id, name: p.name, line: p.line, text: p.text })),
    { id: "own", name: "Write my own", line: "Describe it in your words, or paste a brief", text: OWN },
  ];
  return (
    <div className={clsx("grid gap-2", compact ? "grid-cols-3" : "grid-cols-2")}>
      {options.map((o) => (
        <button
          type="button"
          key={o.id}
          aria-pressed={at === o.id}
          title={compact ? o.line : undefined}
          onClick={() => at !== o.id && onPick(o.text)}
          className={clsx(
            "flex flex-col gap-0.5 rounded-xl border text-left transition-colors",
            compact ? "px-3 py-2" : "px-3.5 py-2.5",
            // Your own words: its own row, after the starting points.
            o.id === "own" && !compact && "col-span-2",
            at === o.id ? "border-fg/70 bg-raised" : "border-line hover:border-line-strong hover:bg-panel",
          )}
        >
          <span className={clsx("font-medium text-fg", compact ? "text-[12.5px]" : "text-[13.5px]")}>
            {o.name}
          </span>
          {!compact && <span className="text-[12px] leading-snug text-muted">{o.line}</span>}
        </button>
      ))}
    </div>
  );
}

/** STYLE.md itself, to edit. */
export function StyleText({
  text,
  onChange,
  className,
}: {
  text: string;
  onChange: (text: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Picking "Write my own" puts the cursor where the first line goes.
  useEffect(() => {
    if (text === OWN && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(OWN.length, OWN.length);
    }
  }, [text]);
  return (
    <textarea
      ref={ref}
      aria-label="STYLE.md"
      spellCheck
      value={text}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "w-full resize-none bg-transparent font-mono text-[12.5px] leading-[1.65] text-fg-2 outline-none",
        className,
      )}
    />
  );
}
