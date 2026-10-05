/**
 * The graphic editor: a graphic is a web page (graphics/<id>.html), so you edit its HTML, CSS and
 * (optionally) script and watch it play over your footage as you type. The preview is the real
 * composition, the same renderer export uses, and a strip of frames across the graphic's run shows its
 * motion at a glance. Or describe what you want and Claude writes it. Saving is one undoable update to
 * the graphics collection, written to the file like any other edit; changes made to the file in another
 * editor (or by the agent) show up here too.
 */
import type { PlayerRef } from "@remotion/player";
import {
  type Graphic,
  type GraphicMeta,
  graphicPreviewDoc,
  type ProjectDoc,
  parseGraphic,
  STARTER_GRAPHICS,
  type Visual,
  validateGraphic,
} from "@vedit/project";
import { clsx } from "clsx";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Button, Segmented } from "../../components/ui.tsx";
import { send } from "../../state/chat.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { toast } from "../../state/toast.ts";
import { setUi, useUi } from "../../state/ui.ts";
import { AskClaude, CodeArea, PreviewPlayer } from "../code/parts.tsx";
import { ParamFields } from "../inspector/Inspector.tsx";

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function GraphicEditor() {
  const id = useUi((s) => s.editingGraphic)!;
  const graphics = useDoc((d) => d.graphics);
  const saved = graphics.find((g) => g.id === id);
  const [draft, setDraft] = useState(saved?.html ?? "");
  const [preview, setPreview] = useState(draft);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [layout, setLayout] = useState<Visual["layout"]>("overlay");
  const [creating, setCreating] = useState(false);
  const player = useRef<PlayerRef>(null);
  const errors = useRuntimeErrors(id, preview);
  const dirty = saved !== undefined && draft !== saved.html;

  // Switching graphics, or an outside edit to this one while it's clean, resets the draft.
  const lastSaved = useRef(saved?.html);
  useEffect(() => {
    if (saved?.html !== lastSaved.current) {
      if (!dirty || lastSaved.current === undefined) {
        setDraft(saved?.html ?? "");
        setPreview(saved?.html ?? "");
      }
      lastSaved.current = saved?.html;
    }
  }, [saved?.html, dirty]);

  // The preview follows the code a beat behind typing.
  useEffect(() => {
    const t = setTimeout(() => setPreview(draft), 250);
    return () => clearTimeout(t);
  }, [draft]);

  const problem = useMemo(() => validateGraphic(draft), [draft]);
  const meta: GraphicMeta | null = useMemo(() => {
    try {
      return parseGraphic(preview).meta;
    } catch {
      return null;
    }
  }, [preview]);

  const save = () => {
    if (!saved || !dirty) return;
    if (problem) return toast(problem, "warn");
    if (
      edit([{ op: "update", coll: "graphics", id, patch: { html: draft } }], {
        message: `Edited graphics/${id}.html`,
      })
    ) {
      lastSaved.current = draft;
      toast("Saved");
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Leave without saving your changes to this graphic?")) return;
    setUi({ editingGraphic: null });
  };

  const switchTo = (next: string) => {
    if (next === id) return;
    if (dirty && !window.confirm("Switch without saving your changes?")) return;
    const g = graphics.find((x) => x.id === next);
    setDraft(g?.html ?? "");
    setPreview(g?.html ?? "");
    lastSaved.current = g?.html;
    setParams({});
    setUi({ editingGraphic: next });
  };

  const remove = () => {
    const users = useProject
      .getState()
      .doc!.visuals.filter((v) => v.content.kind === "graphic" && v.content.graphic === id);
    if (users.length)
      return toast(
        `${users.length} ${users.length === 1 ? "visual uses" : "visuals use"} this graphic. Remove those first.`,
        "warn",
      );
    if (!window.confirm(`Delete graphics/${id}.html?`)) return;
    if (edit([{ op: "remove", coll: "graphics", id }], { message: `Deleted graphics/${id}.html` })) {
      const next = graphics.find((g) => g.id !== id);
      setUi({ editingGraphic: next?.id ?? null });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg animate-fade-in">
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-line pr-5 pl-[84px]">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">Graphics</span>
          <span className="text-faint">/</span>
          <span className="font-mono text-[13px] text-fg-3">graphics/{id}.html</span>
          {dirty && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">unsaved</span>
          )}
        </div>
        <div className="no-drag flex gap-2">
          <Button onClick={close}>
            <ArrowLeft size={14} /> Back to editor
          </Button>
          <Button variant="accent" disabled={!dirty || Boolean(problem)} onClick={save}>
            Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-line bg-panel p-3">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="font-mono text-[11px] tracking-wide text-muted uppercase">graphics/</span>
            <button
              type="button"
              aria-label="New graphic"
              title="New graphic"
              onClick={() => setCreating(true)}
              className="rounded p-1 text-muted hover:bg-button hover:text-fg"
            >
              <Plus size={14} />
            </button>
          </div>
          {creating && (
            <NewGraphic
              graphics={graphics}
              onDone={(created) => {
                setCreating(false);
                if (created) switchTo(created);
              }}
            />
          )}
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {graphics.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => switchTo(g.id)}
                className={clsx(
                  "flex flex-col rounded-md px-2 py-1.5 text-left",
                  g.id === id ? "bg-selected text-fg" : "text-fg-2 hover:bg-raised",
                )}
              >
                <span className="truncate text-[13px]">{nameOf(g)}</span>
                <span className="truncate font-mono text-[10px] text-faint">{g.id}.html</span>
              </button>
            ))}
          </div>
        </nav>

        <section className="flex min-w-0 flex-1 flex-col border-r border-line">
          <CodeArea
            value={draft}
            onChange={setDraft}
            onSave={save}
            label="Graphic HTML and CSS"
            language="html"
          />
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2 text-xs">
            {problem || errors.length ? (
              <span className="text-bad">{problem ?? errors.at(-1)}</span>
            ) : (
              <span className="text-muted">
                HTML and CSS, animated with @keyframes, or a {"<script>"} that draws each frame:
                graphic.onFrame((t, f) =&gt; …), with "libs": ["gsap" | "three" | "lottie"] in the header. The
                video clock drives everything. {"{{name}}"} fills a param.
              </span>
            )}
            <button
              type="button"
              onClick={remove}
              className="flex shrink-0 items-center gap-1 text-muted hover:text-bad"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </section>

        <aside className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto bg-panel p-4">
          <Segmented
            value={layout}
            options={[
              { value: "overlay", label: "Overlay" },
              { value: "split", label: "Split" },
              { value: "full", label: "Full" },
            ]}
            onChange={setLayout}
          />
          <Preview
            html={preview}
            id={id}
            params={params}
            layout={layout}
            duration={meta?.duration ?? 3}
            player={player}
          />
          <AskAboutGraphic id={id} dirty={dirty} />
          {meta && (
            <ParamFields
              meta={meta}
              values={params}
              onCommit={(key, v) => setParams((p) => ({ ...p, [key]: v }))}
            />
          )}
          <p className="text-[11px] leading-relaxed text-faint">
            These values are only for trying the graphic out. Each visual on the timeline sets its own in the
            inspector.
          </p>
        </aside>
      </div>
    </div>
  );
}

const nameOf = (g: Graphic) => {
  try {
    return parseGraphic(g.html).meta.name;
  } catch {
    return g.id;
  }
};

/** Runtime errors the open graphic reported (scripted graphics), newest last. Cleared on each edit. */
function useRuntimeErrors(id: string, html: string): string[] {
  const [errors, setErrors] = useState<string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new draft starts with a clean slate
  useEffect(() => setErrors([]), [id, html]);
  useEffect(() => {
    const on = (e: Event) => {
      const { graphic, message } = (e as CustomEvent<{ graphic: string; message: string }>).detail ?? {};
      if (graphic === id && message)
        setErrors((list) => (list.includes(message) ? list : [...list, message]));
    };
    window.addEventListener("vedit:graphic-error", on);
    return () => window.removeEventListener("vedit:graphic-error", on);
  }, [id]);
  return errors;
}

/** Points across a graphic's run worth seeing: in, entrance, settle, hold, exit, out. */
const STRIP = [0.04, 0.15, 0.3, 0.55, 0.85, 0.97];

/** The graphic playing over a shot of your footage (the same project the agent looks at), with a strip
 * of frames across its run. */
function Preview({
  html,
  id,
  params,
  layout,
  duration,
  player,
}: {
  html: string;
  id: string;
  params: Record<string, unknown>;
  layout: Visual["layout"];
  duration: number;
  player: RefObject<PlayerRef | null>;
}) {
  const doc = useProject((s) => s.doc!);
  const previewDoc = useMemo(
    () => buildPreview(doc, { id, html }, params, layout, duration),
    [doc, id, html, params, layout, duration],
  );
  const fps = previewDoc.meta.format.fps;
  const run = previewDoc.visuals[0]?.duration ?? duration;
  const frames = STRIP.map((p) => {
    const frame = Math.round(p * run * fps);
    return { frame, label: `${(frame / fps).toFixed(2)}s in` };
  });
  return <PreviewPlayer doc={previewDoc} frames={frames} player={player} />;
}

/** Describe a graphic and Claude writes it: a new one, or a change to the one that's open. */
function AskAboutGraphic({ id, dirty }: { id: string; dirty: boolean }) {
  const go = (prompt: string) => {
    void send(prompt, {}, "thorough");
    toast("Claude is on it. Follow along in the chat.");
    return true;
  };
  return (
    <AskClaude
      label="Describe the graphic"
      placeholder="e.g. the words slam in one by one, overshoot, then a particle burst on the highlighted word"
      change={(want) => {
        if (dirty) {
          toast("Save or undo your edits to this graphic first, so Claude starts from them.", "warn");
          return false;
        }
        return go(
          `Change the motion graphic graphics/${id}.html: ${want}. Keep its params unless the change needs new ones. Check its motion on frames across its run before you finish. Don't place it on the timeline.`,
        );
      }}
      create={(want) =>
        go(
          `Make a new motion graphic: ${want}. Save it as its own file in graphics/ with sensible params, and check its motion on frames across its run before you finish. Don't place it on the timeline unless I ask.`,
        )
      }
    />
  );
}

/**
 * The preview project: the same one the agent's `look` renders (graphicPreviewDoc), so you and Claude
 * judge a graphic on the same frames. The draft stands in for the saved file, and a project with no
 * footage yet gets a plain colour field to play over.
 */
function buildPreview(
  doc: ProjectDoc,
  graphic: Graphic,
  params: Record<string, unknown>,
  layout: Visual["layout"],
  duration: number,
): ProjectDoc {
  const withDraft: ProjectDoc = {
    ...doc,
    graphics: [...doc.graphics.filter((g) => g.id !== graphic.id), graphic],
  };
  const base: ProjectDoc = withDraft.scenes.length
    ? withDraft
    : {
        ...withDraft,
        sources: [
          ...withDraft.sources,
          {
            id: "preview-bg",
            kind: "solid",
            label: "",
            color: "#2B4F63",
            duration: duration + 0.5,
            hdr: false,
            hasAudio: false,
            status: "ready",
            proxy: false,
            speech: false,
            summary: "",
            tags: [],
          },
        ],
        scenes: [{ id: "preview", source: "preview-bg", in: 0, out: duration + 0.5, note: "", volume: 0 }],
      };
  try {
    return graphicPreviewDoc(base, { graphic: graphic.id, params, layout, duration })?.doc ?? base;
  } catch {
    // A header that doesn't parse yet: the footer already says what's wrong.
    return { ...base, visuals: [] };
  }
}

/** Name a new graphic and pick what to start from: one of yours, or a starter. */
function NewGraphic({
  graphics,
  onDone,
}: {
  graphics: readonly Graphic[];
  onDone: (created: string | null) => void;
}) {
  const [name, setName] = useState("");
  const bases = [...graphics, ...STARTER_GRAPHICS.filter((s) => !graphics.some((g) => g.id === s.id))];
  const [base, setBase] = useState(bases[0]?.id ?? "");
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const taken = graphics.some((g) => g.id === id);
  const create = () => {
    if (!ID.test(id) || taken) return;
    const from = bases.find((b) => b.id === base);
    let html = from?.html ?? "";
    // Give the copy its own name in the header.
    html = html.replace(/("name"\s*:\s*")[^"]*(")/, `$1${name.trim().replace(/"/g, "")}$2`);
    if (edit([{ op: "insert", coll: "graphics", item: { id, html } }], { message: `New graphic ${id}` }))
      onDone(id);
  };
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border border-line-strong bg-raised p-2.5 animate-rise">
      <input
        // biome-ignore lint/a11y/noAutofocus: the user just asked for a new graphic
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") create();
          if (e.key === "Escape") onDone(null);
        }}
        placeholder="Name, e.g. Price tag"
        aria-label="New graphic name"
        className="rounded-md border border-line-strong bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-edge"
      />
      <label className="flex flex-col gap-1 text-[11px] text-muted">
        Start from
        <select
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="rounded-md border border-line-strong bg-bg px-2 py-1.5 text-[13px] text-fg outline-none"
        >
          {bases.map((b) => (
            <option key={b.id} value={b.id}>
              {nameOf(b)}
            </option>
          ))}
        </select>
      </label>
      {id && (
        <span className={clsx("font-mono text-[10px]", taken ? "text-bad" : "text-faint")}>
          graphics/{id}.html{taken ? " exists" : ""}
        </span>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" variant="accent" disabled={!ID.test(id) || taken} onClick={create}>
          Create
        </Button>
      </div>
    </div>
  );
}
