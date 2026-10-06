/**
 * A graphic's params as a form, built from what the graphic file declares in its header: a new graphic
 * you write in HTML gets its editor for free.
 */
import { XIcon } from "@phosphor-icons/react";
import { type GraphicMeta, graphicParams, type ParamSpec } from "@vedit/project";
import { FieldInput, FieldRow, TextBox } from "../../components/FieldInput.tsx";
import type { Field } from "../../lib/fields.ts";

const PARAM_KIND: Record<ParamSpec["type"], Field["kind"]> = {
  text: "text",
  number: "number",
  list: "lines",
  choice: "select",
  boolean: "boolean",
  color: "color",
};

/** A form built from the params a graphic file declares in its header. */
export function ParamFields({
  meta,
  values,
  onCommit,
}: {
  meta: GraphicMeta;
  values: Readonly<Record<string, unknown>>;
  onCommit: (key: string, value: unknown) => void;
}) {
  const merged = graphicParams(meta, values);
  const entries = Object.entries(meta.params);
  if (!entries.length) return <p className="text-xs text-faint">This graphic takes no params.</p>;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-2.5">
      <span className="text-[11px] font-medium text-muted">{meta.name}</span>
      {entries.map(([key, spec]) => {
        // The graphic's own description of the param, and for text the *stars* emphasis syntax.
        const described = (spec as { description?: string }).description;
        const hint = [
          described,
          spec.type === "text" || spec.type === "list" ? "Wrap words in *stars* to highlight them." : "",
        ]
          .filter(Boolean)
          .join(" ");
        const field: Field = {
          key,
          label: spec.label ?? key.charAt(0).toUpperCase() + key.slice(1),
          kind: PARAM_KIND[spec.type] ?? "text",
          ...(hint && { hint }),
          ...(spec.options && { options: spec.options }),
          ...(spec.type === "number" && { step: 0.1 }),
        };
        const value = merged[key];
        const records =
          spec.type === "list" && [value, spec.default].some((v) => Array.isArray(v) && isRecord(v[0]));
        return (
          <FieldRow key={key} field={field}>
            {records ? (
              <RecordList
                rows={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
                sample={Array.isArray(spec.default) ? (spec.default as Record<string, unknown>[]) : []}
                onCommit={(v) => onCommit(key, v)}
              />
            ) : (
              <FieldInput field={field} value={value} onCommit={(v) => onCommit(key, v)} />
            )}
          </FieldRow>
        );
      })}
    </div>
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A list param whose items are records ({label, value} bars, {name, price} rows): one row per item, one
 * box per key. Columns come from the items and the header's default, and a column whose example is a
 * number stays a number.
 */
function RecordList({
  rows,
  sample,
  onCommit,
}: {
  rows: readonly Record<string, unknown>[];
  sample: readonly Record<string, unknown>[];
  onCommit: (rows: Record<string, unknown>[]) => void;
}) {
  const columns = [...new Set([...sample, ...rows].filter(isRecord).flatMap((r) => Object.keys(r)))];
  const numeric = new Set(
    columns.filter((c) => [...sample, ...rows].some((r) => isRecord(r) && typeof r[c] === "number")),
  );
  const setCell = (i: number, col: string, raw: string) => {
    const n = Number(raw);
    const v = numeric.has(col) && raw.trim() !== "" && Number.isFinite(n) ? n : raw;
    if (rows[i]?.[col] === v) return;
    onCommit(rows.map((r, j) => (j === i ? { ...r, [col]: v } : r)));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr)) 20px` }}
      >
        {columns.map((c) => (
          <span key={c} className="truncate px-0.5 font-mono text-[10px] text-faint">
            {c}
          </span>
        ))}
        <span />
        {rows.map((row, i) => [
          ...columns.map((c) => (
            <TextBox
              key={`${i}:${c}`}
              mono={numeric.has(c)}
              value={row[c] === undefined ? "" : String(row[c])}
              onCommit={(v) => setCell(i, c, v)}
            />
          )),
          <button
            key={`${i}:remove`}
            type="button"
            aria-label={`Remove row ${i + 1}`}
            onClick={() => onCommit(rows.filter((_, j) => j !== i))}
            className="flex items-center justify-center rounded text-faint hover:bg-button hover:text-fg"
          >
            <XIcon size={12} />
          </button>,
        ])}
      </div>
      <button
        type="button"
        onClick={() =>
          onCommit([...rows, Object.fromEntries(columns.map((c) => [c, numeric.has(c) ? 0 : ""]))])
        }
        className="self-start rounded-md px-1.5 py-1 text-[11px] text-muted hover:bg-button hover:text-fg"
      >
        + Add row
      </button>
    </div>
  );
}
