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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[15px]">
          <span className="text-muted">Effort</span>{" "}
          <span className="ml-1 text-fg">{effortLabel(value)}</span>
        </span>
        <button
          type="button"
          title={HELP}
          aria-label={`About effort: ${HELP}`}
          className="cursor-help rounded-full text-faint hover:text-fg-2"
        >
          <QuestionIcon size={16} />
        </button>
      </div>
      <div className="flex justify-between text-[13px] text-muted">
        <span>Faster</span>
        <span>Smarter</span>
      </div>
      <div className="px-3">
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
          className="relative h-8 cursor-pointer touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-fg/30"
        >
          {/* The bar, lit up to the chosen level. */}
          <div className="absolute inset-x-[-12px] top-1/2 h-8 -translate-y-1/2 rounded-xl bg-control" />
          <div
            className="absolute top-1/2 left-[-12px] h-8 -translate-y-1/2 rounded-xl bg-gradient-to-r from-control to-selected transition-[width] duration-200"
            style={{ width: `calc(${pos(at)} + 24px)` }}
          />
          {EFFORTS.map((e, i) => (
            <span
              key={e.value}
              className={clsx(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                i === recommended ? "h-3 w-[2px] bg-fg-3/70" : "size-1 bg-faint",
              )}
              style={{ left: pos(i) }}
            />
          ))}
          <span
            className="absolute top-1/2 h-7 w-6 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-fg shadow-md transition-[left] duration-200"
            style={{ left: pos(at) }}
          />
          {shown !== null && (
            <span
              className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-2.5 py-1 text-[13px] whitespace-nowrap text-fg shadow-lg animate-fade-in"
              style={{ left: pos(shown) }}
            >
              {EFFORTS[shown]!.label}
            </span>
          )}
        </div>
        <div className="relative mt-2 h-4">
          <span
            className="absolute -translate-x-1/2 text-[12px] whitespace-nowrap text-faint"
            style={{ left: pos(recommended) }}
          >
            Recommended
          </span>
        </div>
      </div>
    </div>
  );
}
