/**
 * In the composer: how full the agent's context got on its last request (the ring), and how much of its
 * plan's 5-hour and weekly limits are used, with when each resets (the popover). Figures are the chosen
 * agent's own (Claude's plan and ChatGPT's apart) and come as requests run; until then, nothing.
 */
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { type Usage, useChat } from "../../state/chat.ts";
import { useSettings } from "../../state/settings.ts";

/** A limit this far used is worth a glance; past the second, a warning. */
const NOTE = 75;
const WARN = 90;

const tokens = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

function resets(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `resets at ${time}`;
  return `resets ${d.toLocaleDateString([], { weekday: "short" })} at ${time}`;
}

const PLANS: Record<string, string> = {
  pro: "Pro",
  max: "Max",
  plus: "Plus",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
};

const NONE: Usage = {};

export function UsageMeter() {
  const harness = useSettings((s) => s.settings?.harness ?? "claude");
  const usage = useChat((s) => s.usage[harness] ?? NONE);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
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

  const { context, limits } = usage;
  if (!context && !limits?.fiveHour && !limits?.weekly) return null;
  const contextPct = context ? Math.min(100, (context.used / context.window) * 100) : 0;
  // The tightest limit, shown beside the ring once it's worth knowing about.
  const tight = [
    limits?.fiveHour && { label: "5h", pct: limits.fiveHour.pct },
    limits?.weekly && { label: "week", pct: limits.weekly.pct },
  ]
    .filter((l) => !!l)
    .sort((a, b) => b.pct - a.pct)[0];

  // The popover spans the composer box (its positioned ancestor), so a narrow chat column never clips it.
  return (
    <div ref={root}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Claude usage"
        title="Context and plan usage"
        onClick={() => setOpen(!open)}
        className={clsx(
          "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-[11px] tabular-nums",
          open ? "bg-selected text-fg" : "text-faint hover:bg-control hover:text-fg-2",
        )}
      >
        <Ring pct={context ? contextPct : 0} />
        {tight && tight.pct >= NOTE && (
          <span className={tight.pct >= WARN ? "text-bad" : "text-accent"}>
            {Math.round(tight.pct)}% {tight.label}
          </span>
        )}
      </button>
      {open && <Details usage={usage} contextPct={contextPct} />}
    </div>
  );
}

function Details({ usage, contextPct }: { usage: Usage; contextPct: number }) {
  const { context, limits } = usage;
  const plan = limits?.plan && (PLANS[limits.plan] ?? limits.plan);
  return (
    <div
      role="dialog"
      aria-label="Claude usage"
      className="absolute right-0 bottom-full z-30 mb-2 flex w-full max-w-[320px] flex-col gap-4 rounded-2xl border border-line-strong bg-panel p-4 shadow-2xl animate-rise"
    >
      {context && (
        <Meter
          label="Context"
          pct={contextPct}
          detail={`The last request used ${tokens(context.used)} of ${tokens(context.window)} tokens. Each request starts fresh, with the recent conversation.`}
        />
      )}
      {(limits?.fiveHour || limits?.weekly) && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-fg">Plan usage</span>
            {plan && <span className="text-[11px] text-faint">Claude {plan}</span>}
          </div>
          {limits.fiveHour && (
            <Meter
              label="5-hour limit"
              pct={limits.fiveHour.pct}
              {...(limits.fiveHour.resetsAt && { detail: resets(limits.fiveHour.resetsAt) })}
            />
          )}
          {limits.weekly && (
            <Meter
              label="Weekly limit"
              pct={limits.weekly.pct}
              {...(limits.weekly.resetsAt && { detail: resets(limits.weekly.resetsAt) })}
            />
          )}
          <p className="text-[11px] leading-snug text-faint">
            Shared with Claude Code and claude.ai on the same account. Updated as requests run.
          </p>
        </div>
      )}
    </div>
  );
}

function Meter({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  const shown = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-fg-2">{label}</span>
        <span className="tabular-nums text-muted">{Math.round(shown)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-control">
        <div
          className={clsx(
            "h-full rounded-full transition-[width] duration-300",
            shown >= WARN ? "bg-bad" : shown >= NOTE ? "bg-accent" : "bg-fg-3",
          )}
          style={{ width: `${shown}%` }}
        />
      </div>
      {detail && <span className="text-[11px] leading-snug text-faint">{detail}</span>}
    </div>
  );
}

/** A small ring, filled to how much of the context the last request used. */
function Ring({ pct }: { pct: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="-rotate-90">
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, pct) / 100)}
        className={pct >= WARN ? "text-bad" : pct >= NOTE ? "text-accent" : undefined}
      />
    </svg>
  );
}
