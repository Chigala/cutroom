/**
 * In the composer, beside Send: how hard the agent thinks, and which model, like Claude's own picker.
 * The same settings as Settings → Claude.
 */
import { clsx } from "clsx";
import { Check, ChevronDown, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings, useSettings } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";

export const EFFORTS = [
  { value: "low", label: "Quick", hint: "Fastest, for small changes" },
  { value: "medium", label: "Balanced", hint: "Most edits" },
  { value: "high", label: "Careful", hint: "Big edits and first cuts" },
  { value: "max", label: "Max", hint: "Thinks longest, slowest" },
] as const;

export const MODELS = [
  { value: "claude-opus-5-5", label: "Opus 5.5", hint: "Best edits" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Faster" },
] as const;

export function ThinkingPicker({ disabled }: { disabled?: boolean }) {
  const settings = useSettings((s) => s.settings);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void loadSettings();
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!settings) return null;
  const effort = EFFORTS.find((e) => e.value === settings.effort) ?? EFFORTS[2];
  const model = MODELS.find((m) => m.value === settings.model);
  const save = (patch: Parameters<typeof saveSettings>[0]) =>
    void saveSettings(patch).catch((err: Error) => toast(`Couldn't change it: ${err.message}`, "warn"));

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={`${model?.label ?? settings.model}, thinking: ${effort.label}`}
        onClick={() => setOpen(!open)}
        className={clsx(
          "inline-flex h-[30px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs whitespace-nowrap disabled:opacity-40",
          open ? "bg-selected text-fg" : "bg-control text-fg-2 hover:bg-selected",
        )}
      >
        <Lightbulb size={13} className="shrink-0" />
        {effort.label}
        <ChevronDown size={12} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-2 w-[232px] overflow-hidden rounded-xl border border-line-strong bg-panel p-1 shadow-2xl animate-rise"
        >
          <MenuLabel>How hard it thinks</MenuLabel>
          {EFFORTS.map((e) => (
            <MenuItem
              key={e.value}
              label={e.label}
              hint={e.hint}
              on={settings.effort === e.value}
              onPick={() => {
                save({ effort: e.value });
                setOpen(false);
              }}
            />
          ))}
          <div className="my-1 border-t border-line" />
          <MenuLabel>Model</MenuLabel>
          {MODELS.map((m) => (
            <MenuItem
              key={m.value}
              label={m.label}
              hint={m.hint}
              on={settings.model === m.value}
              onPick={() => {
                save({ model: m.value });
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuLabel({ children }: { children: string }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-[11px] text-faint">{children}</div>;
}

function MenuItem({
  label,
  hint,
  on,
  onPick,
}: {
  label: string;
  hint: string;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onPick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-button"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] text-fg">{label}</span>
        <span className="text-[11px] text-muted">{hint}</span>
      </span>
      {on && <Check size={14} className="shrink-0 text-accent" />}
    </button>
  );
}
