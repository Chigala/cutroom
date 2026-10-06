/**
 * How hard Claude thinks, the way Claude's own apps put it: one slider from Faster to Smarter over the
 * five effort levels, with the recommended one marked. Used in the composer and in Settings → Claude.
 */

import { QuestionIcon } from "@phosphor-icons/react";
import type { Settings } from "@vedit/bridge";
import { clsx } from "clsx";
import { useRef, useState } from "react";

export const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
] as const satisfies readonly { value: Settings["effort"]; label: string }[];

/** What most edits want; first cuts use High on their own. */
export const RECOMMENDED: Settings["effort"] = "medium";

export const effortLabel = (value: Settings["effort"]) =>
  EFFORTS.find((e) => e.value === value)?.label ?? value;

const HELP =
  "How long Claude thinks before it acts. Higher is smarter on big, creative edits, but slower and uses more of your plan. Medium suits most edits; first cuts always think at High or above.";

export function EffortSlider({
  value,
  onChange,
}: {
  value: Settings["effort"];
  onChange: (value: Settings["effort"]) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const at = Math.max(
    0,
    EFFORTS.findIndex((e) => e.value === value),
  );
  const last = EFFORTS.length - 1;
  const pos = (i: number) => `${(i / last) * 100}%`;
  const stopAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * last);
  };
  const pick = (i: number) => {
    if (EFFORTS[i] && EFFORTS[i].value !== value) onChange(EFFORTS[i].value);
  };
  const shown = dragging ? at : hover;
  const recommended = EFFORTS.findIndex((e) => e.value === RECOMMENDED);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] text-muted">Effort</span>
          <span className="text-[15px] font-medium text-fg">{effortLabel(value)}</span>
        </span>
        <button
          type="button"
          title={HELP}
          aria-label={`About effort: ${HELP}`}
          className="flex size-6 cursor-help items-center justify-center rounded-full text-faint hover:bg-button hover:text-fg-2"
        >
          <QuestionIcon size={15} />
        </button>
      </div>
      {/* Track, stops, thumb and labels share one box (inset by the thumb's radius), so they line up. */}
      <div className="px-[9px]">
        <div className="-mx-[9px] mb-2 flex justify-between text-[12px] text-faint">
          <span>Faster</span>
          <span>Smarter</span>
        </div>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Effort"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={at}
          aria-valuetext={effortLabel(value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") pick(Math.max(0, at - 1));
            else if (e.key === "ArrowRight" || e.key === "ArrowUp") pick(Math.min(last, at + 1));
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            pick(stopAt(e.clientX));
          }}
          onPointerMove={(e) => {
            if (dragging) pick(stopAt(e.clientX));
            else setHover(stopAt(e.clientX));
          }}
          onPointerUp={() => setDragging(false)}
          onPointerLeave={() => setHover(null)}
          className="group relative h-6 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-fg/30 focus-visible:ring-offset-4 focus-visible:ring-offset-panel"
        >
          {/* The rail, and how far along it the chosen level is. */}
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-control" />
          <div
            className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-fg-3/70 transition-[width] duration-200 ease-out"
            style={{ width: pos(at) }}
          />
          {EFFORTS.map((e, i) => (
            <span
              key={e.value}
              aria-hidden
              className={clsx(
                "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
                i <= at ? "bg-bg/60" : "bg-faint/70",
              )}
              style={{ left: pos(i) }}
            />
          ))}
          <span
            aria-hidden
            className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-[0_1px_4px_rgba(0,0,0,0.5)] ring-[3px] ring-panel transition-[left,transform] duration-200 ease-out group-active:scale-110"
            style={{ left: pos(at) }}
          />
          {shown !== null && (
            <span
              className="pointer-events-none absolute bottom-full mb-2.5 -translate-x-1/2 rounded-lg bg-raised px-2.5 py-1 text-[12.5px] whitespace-nowrap text-fg shadow-[0_6px_20px_rgba(0,0,0,0.45)] ring-1 ring-line-strong animate-fade-in"
              style={{ left: pos(shown) }}
            >
              {EFFORTS[shown]!.label}
            </span>
          )}
        </div>
        <div className="relative mt-2 h-4 text-[12px]">
          <span
            className={clsx(
              "absolute -translate-x-1/2 whitespace-nowrap",
              at === recommended ? "text-fg-3" : "text-faint",
            )}
            style={{ left: pos(recommended) }}
          >
            Recommended
          </span>
        </div>
      </div>
    </div>
  );
}
