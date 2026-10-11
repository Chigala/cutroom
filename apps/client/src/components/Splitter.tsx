import { clsx } from "clsx";

/**
 * A panel's edge: drag to resize it (double-click for the usual size, arrow keys by a step). The limits
 * are read when a drag starts, so a panel never takes the room the video needs.
 */
export function Splitter({
  edge,
  label,
  value,
  initial,
  limits,
  onChange,
}: {
  /** Which edge of its panel it sits on (the panel grows away from it). */
  edge: "left" | "right" | "top";
  label: string;
  value: number;
  initial: number;
  limits: () => { min: number; max: number };
  /** The new size; `save` once the drag ends. */
  onChange: (size: number, save: boolean) => void;
}) {
  const across = edge !== "top";
  const set = (v: number, save = true) => {
    const { min, max } = limits();
    onChange(Math.min(Math.max(min, max), Math.max(min, v)), save);
  };
  const { min, max } = limits();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element; this is the ARIA pattern for one.
    <div
      role="separator"
      aria-orientation={across ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onDoubleClick={() => set(initial)}
      onKeyDown={(e) => {
        const grow = { left: "ArrowLeft", right: "ArrowRight", top: "ArrowUp" }[edge];
        const shrink = { left: "ArrowRight", right: "ArrowLeft", top: "ArrowDown" }[edge];
        if (e.key !== grow && e.key !== shrink) return;
        e.preventDefault();
        e.stopPropagation();
        set(value + (e.key === grow ? 16 : -16));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const start = across ? e.clientX : e.clientY;
        const from = value;
        const { min, max } = limits();
        const sign = edge === "right" ? 1 : -1;
        let last = from;
        document.body.style.cursor = across ? "col-resize" : "row-resize";
        const move = (ev: PointerEvent) => {
          last = Math.min(
            Math.max(min, max),
            Math.max(min, from + sign * ((across ? ev.clientX : ev.clientY) - start)),
          );
          onChange(last, false);
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          document.body.style.cursor = "";
          onChange(last, true);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      }}
      className={clsx(
        "group/split absolute z-20 outline-none",
        across ? "top-0 h-full w-1.5 cursor-col-resize" : "inset-x-0 top-0 h-1.5 cursor-row-resize",
        edge === "left" && "left-0",
        edge === "right" && "right-0",
      )}
    >
      <span
        className={clsx(
          "absolute bg-accent opacity-0 transition-opacity group-hover/split:opacity-60 group-focus-visible/split:opacity-100 group-active/split:opacity-100",
          across ? "inset-y-0 w-px" : "inset-x-0 top-0 h-px",
          edge === "left" && "left-0",
          edge === "right" && "right-0",
        )}
      />
    </div>
  );
}
