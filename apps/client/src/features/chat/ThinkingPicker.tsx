/**
 * In the composer, beside Send: how hard the agent thinks (the effort slider, as in Claude's apps) and
 * which model: Claude's, or Codex's for the ChatGPT plan, whichever agent edits. The same settings as
 * Settings → Agent.
 */

import { CaretDownIcon, CheckIcon, LightbulbIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { AGENTS, AgentLogo } from "../../components/AgentLogo.tsx";
import { claudeModels, newestEach, useClaude } from "../../state/claude.ts";
import { checkCodex, useCodex } from "../../state/codex.ts";
import { loadSettings, saveSettings, useSettings } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";
import { EffortSlider, effortLabel } from "./EffortSlider.tsx";

export function ThinkingPicker({ disabled }: { disabled?: boolean }) {
  const settings = useSettings((s) => s.settings);
  const codex = useCodex((s) => s.status);
  const claude = useClaude((s) => s.status);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void loadSettings();
  }, []);
  const onCodex = settings?.harness === "codex";
  useEffect(() => {
    if (onCodex) void checkCodex();
  }, [onCodex]);
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
  const effort = effortLabel(settings.effort);
  // The models of the agent that edits, as its account offers them: Claude's (the newest of each kind,
  // and the one chosen), or Codex's ("" is Codex's default for the plan).
  const fallback = codex?.models.find((m) => m.isDefault);
  const hint = (description?: string) => description?.split(/[.!]/)[0] ?? "";
  const offered = claudeModels(claude);
  const chosen = offered.find((m) => m.id === settings.model);
  const models: readonly { value: string; label: string; hint: string }[] = onCodex
    ? [
        {
          value: "",
          label: fallback ? `${fallback.name} (default)` : "Codex's default",
          hint: "For your ChatGPT plan",
        },
        ...(codex?.models ?? [])
          .filter((m) => m.id !== fallback?.id)
          .map((m) => ({ value: m.id, label: m.name, hint: hint(m.description) })),
      ]
    : [...newestEach(offered), ...(chosen && !newestEach(offered).includes(chosen) ? [chosen] : [])].map(
        (m) => ({ value: m.id, label: m.name, hint: hint(m.description) }),
      );
  const current = onCodex ? settings.codexModel : settings.model;
  const model = models.find((m) => m.value === current);
  const save = (patch: Parameters<typeof saveSettings>[0]) =>
    void saveSettings(patch).catch((err: Error) => toast(`Couldn't change it: ${err.message}`, "warn"));

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Thinking: ${effort}`}
        disabled={disabled}
        title={`${model?.label ?? current}, effort: ${effort}`}
        onClick={() => setOpen(!open)}
        className={clsx(
          "inline-flex h-[30px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs whitespace-nowrap disabled:opacity-40",
          open ? "bg-selected text-fg" : "bg-control text-fg-2 hover:bg-selected",
        )}
      >
        <LightbulbIcon size={13} className="shrink-0" />
        <span className="hidden @[400px]:inline">{effort}</span>
        <CaretDownIcon size={12} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-2 w-[320px] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.5)] animate-rise"
        >
          <div className="px-4 pt-4 pb-3">
            <EffortSlider value={settings.effort} onChange={(effort) => save({ effort })} />
          </div>
          <div className="border-t border-line" />
          <div className="p-1.5">
            <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-[12px] text-faint">
              <AgentLogo id={settings.harness} size={12} />
              {AGENTS[settings.harness].name} model
            </div>
            {models.map((m) => (
              <MenuItem
                key={m.value}
                label={m.label}
                hint={m.hint}
                on={current === m.value}
                onPick={() => {
                  save(onCodex ? { codexModel: m.value } : { model: m.value });
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
      className={clsx(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
        on ? "bg-button" : "hover:bg-button",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] text-fg">{label}</span>
        <span className="text-[12px] text-muted">{hint}</span>
      </span>
      {on && <CheckIcon size={15} weight="bold" className="shrink-0 text-fg-2" />}
    </button>
  );
}
