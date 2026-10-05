import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "accent" | "ghost" | "control";

const variants: Record<Variant, string> = {
  default: "bg-button border border-line-strong text-fg hover:bg-chip",
  accent: "bg-accent text-accent-fg font-semibold hover:bg-accent-hover",
  ghost: "bg-transparent border border-line-strong text-fg-3 hover:bg-button",
  control: "bg-control text-fg-2 hover:bg-selected",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg whitespace-nowrap transition-colors duration-100",
        "disabled:opacity-40 disabled:pointer-events-none",
        size === "md" ? "h-[34px] px-3.5 text-[13px] font-medium" : "h-[30px] px-2.5 text-xs",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-button transition-colors",
        "disabled:opacity-40 disabled:pointer-events-none size-8",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** "+3 zooms · Undo": one reviewable change. */
export function ChangeChip({
  label,
  undone,
  onUndo,
  onRedo,
}: {
  label: string;
  undone: boolean;
  onUndo: () => void;
  onRedo?: () => void;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border py-1 pr-1 pl-2.5 text-xs animate-fade-in",
        undone ? "border-line text-faint line-through decoration-faint/60" : "border-edge text-fg",
      )}
    >
      {label}
      {undone ? (
        onRedo && (
          <button
            type="button"
            onClick={onRedo}
            className="h-[22px] rounded-full bg-chip px-2 text-[11px] text-fg-3 no-underline hover:bg-selected"
          >
            Redo
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={onUndo}
          className="h-[22px] rounded-full bg-chip px-2 text-[11px] text-fg-3 hover:bg-selected hover:text-fg"
        >
          Undo
        </button>
      )}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex rounded-[9px] bg-button p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-[30px] flex-1 rounded-[7px] text-[13px] transition-colors",
            value === o.value ? "bg-selected text-fg" : "text-muted hover:text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong px-1 font-mono text-[10px] text-muted">{children}</kbd>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[11px] tracking-[0.06em] text-muted uppercase">{children}</span>
      {right}
    </div>
  );
}
