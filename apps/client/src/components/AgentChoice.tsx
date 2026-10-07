/** Which agent edits: Claude or Codex, side by side, each with its mark and whose plan it runs on. */
import { HARNESS_IDS, type HarnessId } from "@vedit/bridge";
import { clsx } from "clsx";
import { AGENTS, AgentLogo } from "./AgentLogo.tsx";

export function AgentChoice({
  value,
  onChange,
  size = "md",
}: {
  value: HarnessId;
  onChange: (id: HarnessId) => void;
  /** "lg" in onboarding, where it's the screen's one choice. */
  size?: "md" | "lg";
}) {
  return (
    <fieldset aria-label="Agent" className="m-0 grid grid-cols-2 gap-2 border-0 p-0">
      {HARNESS_IDS.map((id) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(id)}
            className={clsx(
              "flex items-center gap-3 rounded-xl border text-left transition-colors",
              size === "lg" ? "px-4 py-3.5" : "px-3 py-2.5",
              on
                ? "border-accent/70 bg-accent/8"
                : "border-line bg-sunken/50 hover:border-line-strong hover:bg-button",
            )}
          >
            <span
              className={clsx(
                "flex shrink-0 items-center justify-center rounded-lg bg-raised text-fg",
                size === "lg" ? "size-10" : "size-8",
              )}
            >
              <AgentLogo id={id} size={size === "lg" ? 22 : 18} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={clsx("text-fg", size === "lg" ? "text-[15px] font-medium" : "text-[13.5px]")}>
                {AGENTS[id].name}
              </span>
              <span className="truncate text-[12px] text-muted">{AGENTS[id].plan}</span>
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
