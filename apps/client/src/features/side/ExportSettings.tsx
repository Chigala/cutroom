/**
 * export.json, field by field: the one set of settings kept as controls. Everything else about how the
 * video looks and sounds (looks, captions, music, mix, cover, checks, brand kits, STYLE.md) is asked for
 * in chat, where Claude changes the same files.
 */
import { FieldInput, FieldRow } from "../../components/FieldInput.tsx";
import { fieldsForSingleton } from "../../lib/fields.ts";
import { edit, useDoc } from "../../state/project.ts";

export function ExportSettings() {
  const value = useDoc((d) => d.exportSettings) as Record<string, unknown>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] tracking-[0.06em] text-muted uppercase">Export</span>
        <span className="font-mono text-[10px] text-faint">export.json</span>
      </div>
      {fieldsForSingleton("exportSettings").map((f) => (
        <FieldRow key={f.key} field={f}>
          <FieldInput
            field={f}
            value={value[f.key]}
            onCommit={(v) =>
              edit([{ op: "merge", key: "exportSettings", patch: { [f.key]: v } }], {
                message: `Export: ${f.label.toLowerCase()}`,
              })
            }
          />
        </FieldRow>
      ))}
      <p className="m-0 text-xs leading-relaxed text-faint">
        The look, captions, music and the rest: ask in chat.
      </p>
    </div>
  );
}
