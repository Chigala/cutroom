/**
 * One editable field. Selects and toggles commit right away; text and numbers commit on blur or Enter;
 * sliders commit once on release, so a drag is one undo step, not fifty.
 */

import { clsx } from "clsx";
import { useEffect, useState } from "react";
import type { Field } from "../lib/fields.ts";

const box =
  "w-full rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge";

/** A labelled field. A fieldset, not a <label>: some fields hold several controls (sliders, a color plus its hex). */
export function FieldRow({
  field,
  children,
}: {
  field: Pick<Field, "label" | "hint">;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="mb-1 p-0 text-[11px] font-medium text-muted">{field.label}</legend>
      {children}
      {field.hint && <span className="text-[10.5px] leading-snug text-faint">{field.hint}</span>}
    </fieldset>
  );
}

export function FieldInput({
  field,
  value: stored,
  onCommit,
}: {
  field: Field;
  value: unknown;
  onCommit: (value: unknown) => void;
}) {
  // A field that was left out shows what the schema fills in, not an empty control.
  const value = stored === undefined ? field.default : stored;
  switch (field.kind) {
    case "select":
      return (
        <select
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onCommit(e.target.value === "" ? null : e.target.value)}
          className={box}
        >
          {(field.nullable || value === undefined) && <option value="">None</option>}
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onCommit(!value)}
          className={clsx(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            value ? "bg-accent" : "bg-control",
          )}
        >
          <span
            className={clsx(
              "absolute top-0.5 size-4 rounded-full bg-white transition-[left]",
              value ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>
      );
    case "color":
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={typeof value === "string" ? value : "#ffffff"}
            onBlur={(e) => onCommit(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-line-strong bg-transparent"
          />
          <TextBox value={typeof value === "string" ? value : ""} onCommit={onCommit} mono />
        </div>
      );
    case "range":
      return (
        <Slider
          field={field}
          value={typeof value === "number" ? value : (field.min ?? 0)}
          onCommit={onCommit}
        />
      );
    case "number":
      return <NumberBox value={typeof value === "number" ? value : null} field={field} onCommit={onCommit} />;
    case "choices": {
      // Any of a few fixed options, toggled.
      const on = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => (
            <button
              key={o}
              type="button"
              className={clsx(
                "rounded-md border px-2 py-0.5 text-xs",
                on.has(o)
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-line-strong text-muted hover:text-fg",
              )}
              onClick={() =>
                onCommit((field.options ?? []).filter((x) => (x === o ? !on.has(o) : on.has(x))))
              }
            >
              {o}
            </button>
          ))}
        </div>
      );
    }
    case "lines":
      return (
        <TextBox
          multiline
          value={Array.isArray(value) ? value.join("\n") : ""}
          onCommit={(v) =>
            onCommit(
              String(v)
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case "longtext":
      return <TextBox multiline value={typeof value === "string" ? value : ""} onCommit={onCommit} />;
    default:
      // Anything without a control of its own: text, or JSON for a value that isn't (never "[object Object]").
      if (value !== null && typeof value === "object")
        return (
          <TextBox
            multiline
            mono
            value={JSON.stringify(value, null, 2)}
            onCommit={(v) => {
              try {
                onCommit(JSON.parse(v));
              } catch {}
            }}
          />
        );
      return (
        <TextBox
          value={value === null || value === undefined ? "" : String(value)}
          onCommit={(v) => onCommit(v === "" && field.nullable ? null : v)}
        />
      );
  }
}

export function TextBox({
  value,
  onCommit,
  multiline,
  mono,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  // Read the element, not state: a blur can land before React has re-rendered the last keystroke.
  const commit = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.currentTarget.value;
    if (next !== value) onCommit(next);
  };
  const props = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !multiline) (e.target as HTMLElement).blur();
      if (e.key === "Escape") {
        setDraft(value);
        (e.target as HTMLElement).blur();
      }
    },
    className: clsx(box, mono && "font-mono text-xs"),
  };
  return multiline ? (
    <textarea rows={3} {...props} className={clsx(props.className, "resize-y leading-snug")} />
  ) : (
    <input {...props} />
  );
}

function NumberBox({
  value,
  field,
  onCommit,
}: {
  value: number | null;
  field: Field;
  onCommit: (v: unknown) => void;
}) {
  return (
    <TextBox
      mono
      value={value === null ? "" : String(value)}
      onCommit={(v) => {
        if (v.trim() === "" && field.nullable) return onCommit(null);
        const n = Number(v);
        if (Number.isFinite(n)) onCommit(n);
      }}
    />
  );
}

function Slider({ field, value, onCommit }: { field: Field; value: number; onCommit: (v: unknown) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={field.min ?? 0}
        max={field.max ?? 1}
        step={field.step ?? 0.01}
        value={draft}
        onChange={(e) => {
          setDraft(Number(e.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--color-accent)]"
      />
      <span className="w-10 text-right font-mono text-[11px] text-fg-3 tabular">
        {Number.isInteger(field.step) ? draft : draft.toFixed(2)}
      </span>
    </div>
  );
}
