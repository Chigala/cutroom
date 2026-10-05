/**
 * The inspector: every field of the selected item, generated from the project's schemas. For a graphic
 * it also reads the graphic file's own header and builds a form from the params that file declares, so a
 * new graphic you write in HTML gets its editor for free. Every change is one ordinary, undoable op.
 */
import { coverBox } from "@vedit/composition";
import {
  type Anchor,
  anchorAt,
  formatTime,
  type GraphicMeta,
  graphicParams,
  nextId,
  type Op,
  type ParamSpec,
  parseGraphic,
  resolveAnchor,
  timelineOf,
  trimSceneOps,
  type Visual,
  type VisualContent,
} from "@vedit/project";
import { Copy, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { FieldInput, FieldRow, TextBox } from "../../components/FieldInput.tsx";
import { Segmented } from "../../components/ui.tsx";
import { type Field, fieldsFor, labelOf, withDefaults } from "../../lib/fields.ts";
import { seekTime } from "../../state/playback.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { type InspectableColl, select, setUi, useUi } from "../../state/ui.ts";

type Item = { id: string; anchor?: Anchor; duration?: number } & Record<string, unknown>;
type Patch = (patch: Record<string, unknown>) => void;
/** What an optional object left unset resolves to, and why. */
type AutoValues = Record<string, { value: Record<string, unknown>; note: string }>;

const TITLES: Record<InspectableColl, string> = {
  scenes: "Shot",
  zooms: "Zoom",
  titles: "Title",
  captions: "Caption",
  visuals: "Visual",
  effects: "Camera effect",
  sfx: "Sound effect",
  musicClips: "Music clip",
  musicCues: "Music cue",
};

/** Applies a patch to the selected item. A null on a nullable field replaces the whole item, since an
 * update treats null as "remove this field". */
function patchItem(coll: InspectableColl, item: Item, patch: Record<string, unknown>, label: string): void {
  const doc = useProject.getState().doc!;
  const list = doc[coll] as readonly Item[];
  const hasNull = Object.values(patch).some((v) => v === null);
  if (!hasNull) {
    edit([{ op: "update", coll, id: item.id, patch }], { message: label });
    return;
  }
  const index = list.findIndex((x) => x.id === item.id);
  edit(
    [{ op: "remove", coll, id: item.id }, { op: "insert", coll, index, item: { ...item, ...patch } } as Op],
    { message: label, groups: [{ label, ops: [0, 1] }] },
  );
}

export function Inspector() {
  const sel = useUi((s) => s.selection)!;
  const item = useDoc((d) => (d[sel.coll] as readonly Item[]).find((x) => x.id === sel.id));
  const tl = useDoc(timelineOf);

  if (!item) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-[13px] text-muted">
        That item is gone (undone or deleted).
        <button type="button" onClick={() => select(null)} className="text-accent hover:underline">
          Close
        </button>
      </div>
    );
  }

  const start = item.anchor ? resolveAnchor(tl, item.anchor) : (tl.byId.get(item.id)?.start ?? null);
  const label = TITLES[sel.coll];
  const update = (patch: Record<string, unknown>) => {
    // A sound effect is a built-in sound or a clip, never both (a clip would win): choosing one clears
    // the other. An update's null removes the field.
    if (sel.coll === "sfx" && ("name" in patch || "source" in patch)) {
      const other = "name" in patch ? { source: null } : { name: null };
      edit([{ op: "update", coll: "sfx", id: item.id, patch: { ...patch, ...other } }], {
        message: `Edited ${label.toLowerCase()} ${item.id}`,
      });
      return;
    }
    patchItem(sel.coll, item, patch, `Edited ${label.toLowerCase()} ${item.id}`);
  };
  /** Removes an optional field so the renderer decides again (an update's null means "remove"). */
  const unset = (key: string) =>
    edit([{ op: "update", coll: sel.coll, id: item.id, patch: { [key]: null } }], {
      message: `Reset ${labelOf(key).toLowerCase()} on ${item.id}`,
    });

  const remove = () => {
    if (
      edit([{ op: "remove", coll: sel.coll, id: item.id }], {
        message: `Deleted ${label.toLowerCase()} ${item.id}`,
      })
    )
      select(null);
  };
  const duplicate = () => {
    const doc = useProject.getState().doc!;
    const list = doc[sel.coll] as readonly Item[];
    const id = nextId(`${item.id.replace(/\d+$/, "")}`, list);
    const index = list.findIndex((x) => x.id === item.id) + 1;
    let copy: Item = { ...item, id };
    // Place the copy right after the original.
    if (item.anchor && start !== null) {
      const anchor = anchorAt(tl, Math.min(tl.duration - 0.1, start + (item.duration ?? 0.5)));
      if (anchor) copy = { ...copy, anchor };
    }
    if (
      edit([{ op: "insert", coll: sel.coll, index, item: copy } as Op], { message: `Duplicated ${item.id}` })
    )
      select({ coll: sel.coll, id });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-semibold">{label}</span>
          <button
            type="button"
            onClick={() => start !== null && seekTime(start)}
            className="truncate text-left font-mono text-[11px] text-muted hover:text-fg"
          >
            {item.id}
            {start !== null && ` · ${formatTime(start, true)}`}
            {item.duration !== undefined && ` · ${Number(item.duration).toFixed(1)}s`}
          </button>
        </div>
        <IconAction label="Duplicate" onClick={duplicate}>
          <Copy size={14} />
        </IconAction>
        <IconAction label="Delete" onClick={remove}>
          <Trash2 size={14} />
        </IconAction>
        <IconAction label="Close" onClick={() => select(null)}>
          <X size={15} />
        </IconAction>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {sel.coll === "visuals" ? (
          <VisualFields visual={item as unknown as Visual} update={update} />
        ) : sel.coll === "scenes" ? (
          <SceneFields item={item} update={update} unset={unset} />
        ) : (
          <Fields fields={fieldsFor(sel.coll)} item={item} update={update} unset={unset} />
        )}
      </div>
    </div>
  );
}

function IconAction({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted hover:bg-button hover:text-fg"
    >
      {children}
    </button>
  );
}

/** Generic fields for any item: one row per schema property. */
function Fields({
  fields,
  item,
  update,
  unset,
  auto,
}: {
  fields: readonly Field[];
  item: Record<string, unknown>;
  update: Patch;
  unset?: (key: string) => void;
  auto?: AutoValues;
}) {
  const tl = useDoc(timelineOf);
  return (
    <>
      {fields.map((f) => {
        if (f.kind === "time") {
          const anchor = item[f.key] as Anchor | undefined;
          const t = anchor ? resolveAnchor(tl, anchor) : null;
          return (
            <FieldRow
              key={f.key}
              field={{
                label: f.label,
                hint: "Seconds into the video. It stays pinned to the shot it lands on.",
              }}
            >
              <TextBox
                mono
                value={t === null ? "" : t.toFixed(2)}
                onCommit={(v) => {
                  const n = Number(v);
                  const next = Number.isFinite(n)
                    ? anchorAt(tl, Math.max(0, Math.min(tl.duration - 0.05, n)))
                    : null;
                  if (next) update({ [f.key]: next });
                }}
              />
            </FieldRow>
          );
        }
        if (f.kind === "object") {
          // Left unset, an optional object shows what the renderer will actually use, marked Auto. Nothing
          // is written until a value changes, and then the whole object is, so the other values stay put.
          const stored = item[f.key] as Record<string, unknown> | undefined;
          const isAuto = stored === undefined;
          const value = withDefaults(f, stored ?? auto?.[f.key]?.value);
          return (
            <fieldset key={f.key} className="flex flex-col gap-2 rounded-lg border border-line p-2.5">
              <legend className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted">
                {f.label}
                {isAuto && f.optional && (
                  <span className="rounded bg-control px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-fg-2">
                    Auto
                  </span>
                )}
              </legend>
              <span className="text-[10.5px] leading-snug text-faint">
                {isAuto && auto?.[f.key] ? auto[f.key]!.note : f.hint}
              </span>
              <Fields
                fields={f.children ?? []}
                item={value}
                update={(patch) => update({ [f.key]: { ...value, ...patch } })}
              />
              {!isAuto && f.optional && unset && (
                <button
                  type="button"
                  onClick={() => unset(f.key)}
                  className="flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-[11px] text-muted hover:bg-button hover:text-fg"
                >
                  <RotateCcw size={11} /> Reset to auto
                </button>
              )}
            </fieldset>
          );
        }
        return (
          <FieldRow key={f.key} field={f}>
            <FieldInput field={f} value={item[f.key]} onCommit={(v) => update({ [f.key]: v })} />
          </FieldRow>
        );
      })}
    </>
  );
}

/** Shots: trimming keeps everything pinned to the shot on the same footage. */
function SceneFields({ item, update, unset }: { item: Item; update: Patch; unset: (key: string) => void }) {
  const source = useDoc((d) => d.sources.find((s) => s.id === item.source));
  const face = useDoc((d) => d.analyses.find((a) => a.id === item.source)?.face);
  const format = useDoc((d) => d.meta.format);
  const fields = fieldsFor("scenes");
  // Unframed shots are cropped by the renderer (toward the face when one was found). Show those numbers,
  // read back from the same coverBox the renderer uses, so the first edit starts from what is on screen.
  const auto = useMemo((): AutoValues | undefined => {
    if (!source?.width || !source.height) return undefined;
    const box = coverBox(format.width, format.height, source, undefined, face);
    const at = (frame: number, size: number, offset: number) =>
      Math.abs(frame - size) < 0.5 ? 0.5 : Math.round((offset / (frame - size)) * 100) / 100;
    const w = Number(box.width);
    const h = Number(box.height);
    return {
      framing: {
        value: {
          x: at(format.width, w, Number(box.left)),
          y: at(format.height, h, Number(box.top)),
          scale: 1,
        },
        note: face
          ? "Not set, so the shot is cropped toward the speaker's face. Change a value to frame it yourself."
          : "Not set, so the shot is centred. Change a value to frame it yourself.",
      },
    };
  }, [source, face, format]);
  const trim = (key: "in" | "out", v: unknown) => {
    const doc = useProject.getState().doc!;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const next = key === "in" ? { in: n, out: item.out as number } : { in: item.in as number, out: n };
    edit(trimSceneOps(doc, item.id, next.in, next.out), { message: `Trimmed ${item.id}` });
  };
  return (
    <>
      <div className="rounded-lg bg-raised px-3 py-2 text-xs text-muted">
        From <span className="text-fg-2">{source?.label ?? String(item.source)}</span>
        {source?.duration ? ` · ${source.duration.toFixed(1)}s long` : ""}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["in", "out"] as const).map((k) => (
          <FieldRow key={k} field={{ label: k === "in" ? "In (s)" : "Out (s)" }}>
            <TextBox mono value={Number(item[k]).toFixed(2)} onCommit={(v) => trim(k, v)} />
          </FieldRow>
        ))}
      </div>
      <Fields
        fields={fields.filter((f) => f.key !== "in" && f.key !== "out")}
        item={item}
        update={update}
        unset={unset}
        auto={auto}
      />
    </>
  );
}

/** Visuals: layout and timing, then either the graphic's own params or the cutaway's clip. */
function VisualFields({
  visual,
  update,
}: {
  visual: Visual;
  update: (patch: Record<string, unknown>) => void;
}) {
  const graphics = useDoc((d) => d.graphics);
  const sources = useDoc((d) => d.sources);
  const common = fieldsFor("visuals").filter((f) => f.key !== "sfx");
  const content = visual.content;
  const graphic = content.kind === "graphic" ? graphics.find((g) => g.id === content.graphic) : undefined;
  const parsed = useMemo(() => {
    if (!graphic) return null;
    try {
      return parseGraphic(graphic.html);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [graphic]);

  return (
    <>
      <Segmented
        value={content.kind}
        options={[
          { value: "graphic", label: "Graphic" },
          { value: "cutaway", label: "Cutaway" },
          { value: "media", label: "Media" },
        ]}
        onChange={(kind) => {
          if (kind === content.kind) return;
          const first =
            kind === "graphic" ? graphics[0] : sources.find((s) => s.kind === "video" || s.kind === "image");
          if (!first) return;
          update({
            content:
              kind === "graphic"
                ? { kind, graphic: first.id, params: {} }
                : kind === "media"
                  ? {
                      kind,
                      source: first.id,
                      in: 0,
                      loop: true,
                      box: { x: 0.5, y: 0.3, width: 0.62 },
                      rotate: 0,
                      style: "card",
                    }
                  : { kind, source: first.id, in: 0 },
          });
        }}
      />
      {content.kind === "graphic" ? (
        <>
          <FieldRow field={{ label: "Graphic" }}>
            <div className="flex gap-1.5">
              <select
                value={content.graphic}
                onChange={(e) => update({ content: { ...content, graphic: e.target.value } })}
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge"
              >
                {!graphic && <option value={content.graphic}>{content.graphic} (missing)</option>}
                {graphics.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Edit this graphic's HTML and CSS"
                onClick={() => setUi({ editingGraphic: content.graphic })}
                className="flex items-center gap-1 rounded-md bg-control px-2 text-xs text-fg-2 hover:bg-selected"
              >
                <Pencil size={12} /> Edit
              </button>
            </div>
          </FieldRow>
          {parsed && "error" in parsed ? (
            <p className="rounded-md border border-bad/30 bg-bad/10 px-2.5 py-2 text-xs text-fg-2">
              {parsed.error}
            </p>
          ) : parsed ? (
            <ParamFields
              meta={parsed.meta}
              values={content.params}
              onCommit={(key, v) =>
                update({ content: { ...content, params: { ...content.params, [key]: v } } })
              }
            />
          ) : null}
        </>
      ) : (
        <>
          <FieldRow field={{ label: "Clip" }}>
            <select
              value={content.source}
              onChange={(e) => update({ content: { ...content, source: e.target.value } })}
              className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge"
            >
              {sources
                .filter((s) => s.kind === "video" || s.kind === "image")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          </FieldRow>
          <FieldRow field={{ label: "Start in clip (s)" }}>
            <TextBox
              mono
              value={String(content.in)}
              onCommit={(v) =>
                Number.isFinite(Number(v)) && update({ content: { ...content, in: Math.max(0, Number(v)) } })
              }
            />
          </FieldRow>
          {content.kind === "media" && <MediaFields content={content} update={update} />}
        </>
      )}
      <Fields fields={common} item={visual as unknown as Record<string, unknown>} update={update} />
      <FieldRow field={{ label: "Entry sound", hint: "Default plays a whoosh or pop; None is silent" }}>
        <select
          // "none" is silence; a missing field is the default sound. Old files may still hold null for silence.
          value={visual.sfx === undefined ? "__default" : visual.sfx === null ? "none" : visual.sfx}
          onChange={(e) => {
            const v = e.target.value;
            // In an update, null removes the field: that means "use the default".
            edit(
              [
                {
                  op: "update",
                  coll: "visuals",
                  id: visual.id,
                  patch: { sfx: v === "__default" ? null : v },
                },
              ],
              {
                message:
                  v === "__default"
                    ? `Default sound for ${visual.id}`
                    : v === "none"
                      ? `Silenced ${visual.id}`
                      : `${v} for ${visual.id}`,
              },
            );
          }}
          className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge"
        >
          <option value="__default">Default</option>
          <option value="none">None</option>
          {(fieldsFor("visuals").find((f) => f.key === "sfx")?.options ?? [])
            .filter((o) => o !== "none")
            .map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
        </select>
      </FieldRow>
    </>
  );
}

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
            <X size={12} />
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

/** A media box's place and look: style, size, position, tilt, looping. */
function MediaFields({
  content,
  update,
}: {
  content: Extract<VisualContent, { kind: "media" }>;
  update: (patch: Partial<Visual>) => void;
}) {
  const set = (patch: Partial<typeof content>) => update({ content: { ...content, ...patch } });
  const num = (v: string, lo: number, hi: number) =>
    Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : null;
  return (
    <>
      <FieldRow field={{ label: "Style", hint: "Card for GIFs and memes; Sticker for see-through stickers" }}>
        <select
          value={content.style}
          onChange={(e) => set({ style: e.target.value as typeof content.style })}
          className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge"
        >
          <option value="card">Card</option>
          <option value="sticker">Sticker</option>
          <option value="plain">Plain</option>
        </select>
      </FieldRow>
      <FieldRow field={{ label: "Size (% of width)" }}>
        <TextBox
          mono
          value={String(Math.round(content.box.width * 100))}
          onCommit={(v) => {
            const n = num(v, 8, 100);
            if (n !== null) set({ box: { ...content.box, width: n / 100 } });
          }}
        />
      </FieldRow>
      <FieldRow field={{ label: "Position (% across, % down)" }}>
        <div className="flex gap-1.5">
          <TextBox
            mono
            value={String(Math.round(content.box.x * 100))}
            onCommit={(v) => {
              const n = num(v, 0, 100);
              if (n !== null) set({ box: { ...content.box, x: n / 100 } });
            }}
          />
          <TextBox
            mono
            value={String(Math.round(content.box.y * 100))}
            onCommit={(v) => {
              const n = num(v, 0, 100);
              if (n !== null) set({ box: { ...content.box, y: n / 100 } });
            }}
          />
        </div>
      </FieldRow>
      <FieldRow field={{ label: "Tilt (degrees)" }}>
        <TextBox
          mono
          value={String(content.rotate)}
          onCommit={(v) => {
            const n = num(v, -25, 25);
            if (n !== null) set({ rotate: n });
          }}
        />
      </FieldRow>
      <label className="flex items-center gap-2 text-[13px] text-fg-2">
        <input type="checkbox" checked={content.loop} onChange={(e) => set({ loop: e.target.checked })} />
        Loop while it's on screen
      </label>
    </>
  );
}
