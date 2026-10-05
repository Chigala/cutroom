import {
  BracketsCurlyIcon,
  FileCodeIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { type FileEntry, fileEntries, STARTER_GRAPHICS } from "@vedit/project";
import { useMemo, useState } from "react";
import { IconButton } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { importClips } from "../../lib/import.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { setUi } from "../../state/ui.ts";

/** Where a file opens: graphics and styles in their editors; anything else shows in the folder. */
function openFile(file: string) {
  const graphic = /^graphics\/(.+)\.html$/.exec(file)?.[1];
  const look = /^captions\/looks\/(.+)\.css$/.exec(file)?.[1];
  const style = /^(effects|transitions|grades)\/(.+)\.css$/.exec(file);
  if (graphic) setUi({ editingGraphic: graphic });
  else if (look) setUi({ editingLook: look });
  else if (style)
    setUi({
      editingStyle: {
        kind: ({ effects: "effect", transitions: "transition", grades: "grade" } as const)[
          style[1] as "effects"
        ],
        id: style[2]!,
      },
    });
  else void host.project.reveal(file);
}

/** Opens the first graphic, or starts a new project off with a starter to edit (or ask Claude about). */
function editGraphics() {
  const first = useProject.getState().doc?.graphics[0];
  if (first) return setUi({ editingGraphic: first.id });
  const starter = STARTER_GRAPHICS[0];
  if (
    starter &&
    edit([{ op: "insert", coll: "graphics", item: starter }], {
      message: `Added graphics/${starter.id}.html`,
    })
  )
    setUi({ editingGraphic: starter.id });
}

/**
 * The project is a real folder: every file in it, grouped by folder. Open any of them in your own
 * editor (changes land here as undoable commits); graphics and styles open in their editors here.
 */
export function Files() {
  const dir = useProject((s) => s.dir);
  const doc = useDoc((d) => d);
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = new Map<string, FileEntry[]>();
    for (const f of fileEntries(doc)) {
      if (q && !`${f.path} ${f.describe}`.toLowerCase().includes(q)) continue;
      const at = f.path.lastIndexOf("/");
      const folder = at < 0 ? "" : f.path.slice(0, at + 1);
      out.set(folder, [...(out.get(folder) ?? []), f]);
    }
    return [...out];
  }, [doc, filter]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void importClips()}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg hover:bg-accent-hover"
        >
          <UploadSimpleIcon size={15} /> Import clips…
        </button>
        <IconButton
          label="New or edit graphics (HTML, CSS)"
          onClick={editGraphics}
          className="size-9! border border-line-strong bg-button"
        >
          <SparkleIcon size={15} className="text-accent" />
        </IconButton>
        <IconButton
          label={`Show the project folder: ${dir}`}
          onClick={() => void host.project.reveal()}
          className="size-9! border border-line-strong bg-button"
        >
          <FolderOpenIcon size={15} />
        </IconButton>
      </div>
      <label className="relative block">
        <MagnifyingGlassIcon
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setFilter("");
          }}
          placeholder="Filter files"
          aria-label="Filter files"
          className="w-full rounded-md border border-line bg-sunken py-1.5 pr-2 pl-7 text-xs text-fg outline-none placeholder:text-faint focus:border-edge"
        />
      </label>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        {groups.map(([folder, files]) => (
          <div key={folder} className="flex flex-col pb-1.5">
            <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-panel px-1 py-1 font-mono text-[10.5px] tracking-wide text-faint">
              <FolderIcon size={12} />
              {folder || "project/"}
              <span className="ml-auto tabular">{files.length}</span>
            </div>
            {files.map((f) => {
              const name = f.path.slice(folder.length);
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => openFile(f.path)}
                  title={
                    /^(graphics|captions\/looks|effects|transitions|grades)\//.test(f.path)
                      ? `Edit ${f.path}\n${f.describe}`
                      : `Show ${f.path} in folder\n${f.describe}`
                  }
                  className="flex items-center gap-2 rounded-md py-1 pr-1.5 pl-3 text-left hover:bg-raised"
                >
                  {f.path.endsWith(".html") ? (
                    <FileCodeIcon size={14} className="shrink-0 text-accent" />
                  ) : f.path.endsWith(".css") ? (
                    <FileCodeIcon size={14} className="shrink-0 text-[#8cb8e8]" />
                  ) : f.path.endsWith(".md") ? (
                    <FileTextIcon size={14} className="shrink-0 text-muted" />
                  ) : (
                    <BracketsCurlyIcon size={14} className="shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 shrink-0 truncate font-mono text-xs text-fg">{name}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{f.describe}</span>
                  {f.count !== null && (
                    <span className="font-mono text-[11px] text-faint tabular">{f.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {!groups.length && <p className="px-2 py-3 text-xs text-faint">No files match "{filter}".</p>}
      </div>
      <p className="px-1 text-[11px] leading-snug text-faint">
        Edit any file in your own editor too: changes show up here and undo like any edit.
      </p>
    </div>
  );
}
