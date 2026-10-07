/**
 * The editor for effects (effects/*.css), transitions (transitions/*.css) and grades (grades/*.css): each
 * is a small stylesheet the engine applies to your footage, so you edit the CSS and watch it work on
 * your own shots as you type, or describe what you want and Claude writes it. Saving is one undoable
 * update, written to the file like any other edit.
 */

import { ArrowLeftIcon, CheckIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { PlayerRef } from "@remotion/player";
import {
  STARTER_EFFECTS,
  STARTER_GRADES,
  STARTER_TRANSITIONS,
  type StyleFile,
  type StyleKind,
  styleMeta,
  validateStyle,
} from "@vedit/project";
import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { STYLE_COLL, STYLE_FOLDER, styleName, stylePreview } from "../../lib/style-preview.ts";
import { send } from "../../state/chat.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { agentName } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";
import { setUi, useUi } from "../../state/ui.ts";
import { AskClaude, CodeArea, PreviewPlayer } from "../code/parts.tsx";

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

const STARTERS: Record<StyleKind, readonly StyleFile[]> = {
  effect: STARTER_EFFECTS,
  transition: STARTER_TRANSITIONS,
  grade: STARTER_GRADES,
};

const COPY: Record<
  StyleKind,
  { title: string; one: string; hooks: string; placeholder: string; check: string; place: string }
> = {
  effect: {
    title: "Effects",
    one: "effect",
    hooks:
      "CSS for .frame (your footage, under the effect) and .overlay (drawn on top). Vars: --t, --duration, --progress, --accent. Animations play over the effect's own time.",
    placeholder: "e.g. a VHS glitch: rgb split, scan lines and a little jitter, over half a second",
    check: "Check it on frames across its run before you finish.",
    place: "Don't place it on the timeline unless I ask.",
  },
  transition: {
    title: "Transitions",
    one: "transition",
    hooks:
      "CSS for .out (the shot leaving), .in (the shot coming in) and .overlay. Vars: --t, --duration, --progress, --accent. Plays over the cut, half before and half after.",
    placeholder: "e.g. the old shot bounces out to the left and the new one springs in from the right",
    check: "Check it on frames across the cut before you finish.",
    place: "Don't add it to any cut unless I ask.",
  },
  grade: {
    title: "Grades",
    one: "grade",
    hooks:
      "CSS for .picture (all the footage: filter, mix-blend) and .overlay (on top: grain, light, vignette). Vars: --t (the video's time), --accent.",
    placeholder: "e.g. warm Kodak film: lifted blacks, creamy highlights, soft grain",
    check: "Check it on a few frames of my footage before you finish.",
    place: "",
  },
};

/** What's wrong with a file, as the engine reads it, or with its header. */
function problemOf(kind: StyleKind, css: string): string | null {
  const invalid = validateStyle(kind, css);
  if (invalid) return invalid;
  if (/\/\*\s*(effect|transition|grade)\s+\{/.test(css) && !styleMeta(css))
    return "The header comment isn't valid JSON";
  return null;
}

export function KindEditor() {
  const { kind, id } = useUi((s) => s.editingStyle)!;
  const coll = STYLE_COLL[kind];
  const files = useDoc((d) => d[coll]) as readonly StyleFile[];
  const grade = useDoc((d) => d.look.grade);
  const copy = COPY[kind];
  const saved = files.find((f) => f.id === id);
  const [draft, setDraft] = useState(saved?.css ?? "");
  const [preview, setPreview] = useState(draft);
  const [creating, setCreating] = useState(false);
  const player = useRef<PlayerRef>(null);
  const dirty = saved !== undefined && draft !== saved.css;
  const inUse = kind === "grade" && grade === id;

  // Switching files, or an outside edit (the agent, another editor) while clean, resets the draft.
  const lastSaved = useRef(saved?.css);
  useEffect(() => {
    if (saved?.css !== lastSaved.current) {
      if (!dirty || lastSaved.current === undefined) {
        setDraft(saved?.css ?? "");
        setPreview(saved?.css ?? "");
      }
      lastSaved.current = saved?.css;
    }
  }, [saved?.css, dirty]);

  useEffect(() => {
    const t = setTimeout(() => setPreview(draft), 250);
    return () => clearTimeout(t);
  }, [draft]);

  const problem = useMemo(() => problemOf(kind, draft), [kind, draft]);
  const path = `${STYLE_FOLDER[kind]}/${id}.css`;

  const save = () => {
    if (!saved || !dirty) return;
    if (problem) return toast(problem, "warn");
    if (edit([{ op: "update", coll, id, patch: { css: draft } }], { message: `Edited ${path}` })) {
      lastSaved.current = draft;
      toast("Saved");
    }
  };

  const close = () => {
    if (dirty && !window.confirm(`Leave without saving your changes to this ${copy.one}?`)) return;
    setUi({ editingStyle: null });
  };

  const switchTo = (next: string) => {
    if (next === id) return;
    if (dirty && !window.confirm("Switch without saving your changes?")) return;
    const f = files.find((x) => x.id === next);
    setDraft(f?.css ?? "");
    setPreview(f?.css ?? "");
    lastSaved.current = f?.css;
    setUi({ editingStyle: { kind, id: next } });
  };

  /** What in the project uses this file, so it isn't deleted out from under it. */
  const users = () => {
    const doc = useProject.getState().doc!;
    if (kind === "effect") return doc.effects.filter((e) => e.kind === id).length;
    if (kind === "transition") return doc.scenes.filter((s) => s.transition?.kind === id).length;
    return doc.look.grade === id ? 1 : 0;
  };

  const remove = () => {
    const n = users();
    if (n)
      return toast(
        `Your edit uses this ${copy.one}${n > 1 ? ` ${n} times` : ""}. Change those first.`,
        "warn",
      );
    if (!window.confirm(`Delete ${path}?`)) return;
    if (edit([{ op: "remove", coll, id }], { message: `Deleted ${path}` })) {
      const next = files.find((f) => f.id !== id);
      setUi({ editingStyle: next ? { kind, id: next.id } : null });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg animate-fade-in">
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-line pr-5 pl-[84px]">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">{copy.title}</span>
          <span className="text-faint">/</span>
          <span className="font-mono text-[13px] text-fg-3">{path}</span>
          {dirty && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">unsaved</span>
          )}
        </div>
        <div className="no-drag flex gap-2">
          <Button onClick={close}>
            <ArrowLeftIcon size={14} /> Back to editor
          </Button>
          {kind === "grade" && saved && !inUse && (
            <Button
              disabled={dirty}
              title={dirty ? "Save first" : undefined}
              onClick={() =>
                edit([{ op: "merge", key: "look", patch: { grade: id } }], {
                  message: `Grade: ${styleName(saved)}`,
                }) && toast(`Your video now uses ${styleName(saved)}`)
              }
            >
              Use for my video
            </Button>
          )}
          <Button variant="accent" disabled={!dirty || Boolean(problem)} onClick={save}>
            Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-line bg-panel p-3">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="font-mono text-[11px] tracking-wide text-muted uppercase">
              {STYLE_FOLDER[kind]}/
            </span>
            <button
              type="button"
              aria-label={`New ${copy.one}`}
              title={`New ${copy.one}`}
              onClick={() => setCreating(true)}
              className="rounded p-1 text-muted hover:bg-button hover:text-fg"
            >
              <PlusIcon size={14} />
            </button>
          </div>
          {creating && (
            <NewFile
              kind={kind}
              files={files}
              onDone={(created) => {
                setCreating(false);
                if (created) switchTo(created);
              }}
            />
          )}
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {files.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => switchTo(f.id)}
                title={styleMeta(f.css)?.description}
                className={clsx(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  f.id === id ? "bg-selected text-fg" : "text-fg-2 hover:bg-raised",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px]">{styleName(f)}</span>
                  <span className="truncate font-mono text-[10px] text-faint">{f.id}.css</span>
                </span>
                {kind === "grade" && f.id === grade && (
                  <CheckIcon size={13} className="shrink-0 text-accent" aria-label="Your video uses this" />
                )}
              </button>
            ))}
          </div>
        </nav>

        <section className="flex min-w-0 flex-1 flex-col border-r border-line">
          <CodeArea value={draft} onChange={setDraft} onSave={save} label={`${copy.one} CSS`} />
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2 text-xs">
            {problem ? (
              <span className="text-bad">{problem}</span>
            ) : (
              <span className="text-muted">{copy.hooks}</span>
            )}
            <button
              type="button"
              onClick={remove}
              className="flex shrink-0 items-center gap-1 text-muted hover:text-bad"
            >
              <TrashIcon size={12} /> Delete
            </button>
          </div>
        </section>

        <aside className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto bg-panel p-4">
          <Preview kind={kind} id={id} css={preview} player={player} />
          <AskAboutFile kind={kind} id={id} dirty={dirty} />
          <p className="text-[11px] leading-relaxed text-faint">
            {kind === "transition"
              ? "The preview plays it on a cut between two of your shots."
              : kind === "effect"
                ? "The preview plays it on one of your shots, a beat in."
                : "The preview shows your edit with this grade."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function Preview({
  kind,
  id,
  css,
  player,
}: {
  kind: StyleKind;
  id: string;
  css: string;
  player: React.RefObject<PlayerRef | null>;
}) {
  const doc = useProject((s) => s.doc!);
  const p = useMemo(() => stylePreview(doc, kind, { id, css }), [doc, kind, id, css]);
  const fps = doc.meta.format.fps;
  const frames = p.strip.map((t) => ({ frame: Math.round(t * fps), label: `${t.toFixed(2)}s` }));
  return (
    <PreviewPlayer
      doc={p.doc}
      frames={frames}
      player={player}
      inFrame={Math.round(p.start * fps)}
      outFrame={Math.max(Math.round(p.start * fps) + 1, Math.round(p.end * fps) - 1)}
    />
  );
}

/** Describe an effect, transition or grade and Claude writes it: a new one, or a change to this one. */
function AskAboutFile({ kind, id, dirty }: { kind: StyleKind; id: string; dirty: boolean }) {
  const copy = COPY[kind];
  const go = (prompt: string) => {
    void send(prompt, {}, "thorough");
    toast(`${agentName()} is on it. Follow along in the chat.`);
    return true;
  };
  return (
    <AskClaude
      label={`Describe the ${copy.one}`}
      placeholder={copy.placeholder}
      change={(want) => {
        if (dirty) {
          toast(`Save or undo your edits to this ${copy.one} first, so Claude starts from them.`, "warn");
          return false;
        }
        return go(`Change the ${copy.one} ${STYLE_FOLDER[kind]}/${id}.css: ${want}. ${copy.check}`);
      }}
      create={(want) =>
        go(
          `Make a new ${copy.one}: ${want}. Save it as its own file in ${STYLE_FOLDER[kind]}/. ${copy.check} ${
            kind === "grade" ? "Use it for my video." : copy.place
          }`,
        )
      }
    />
  );
}

/** Name a new file and pick what to start from: one of yours, or a starter. */
function NewFile({
  kind,
  files,
  onDone,
}: {
  kind: StyleKind;
  files: readonly StyleFile[];
  onDone: (created: string | null) => void;
}) {
  const [name, setName] = useState("");
  const bases = [...files, ...STARTERS[kind].filter((s) => !files.some((f) => f.id === s.id))];
  const [base, setBase] = useState(bases[0]?.id ?? "");
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const taken = files.some((f) => f.id === id);
  const create = () => {
    if (!ID.test(id) || taken) return;
    const from = bases.find((b) => b.id === base);
    const css = (from?.css ?? `/* ${kind} {"name": ""} */\n`).replace(
      /("name"\s*:\s*")[^"]*(")/,
      `$1${name.trim().replace(/"/g, "")}$2`,
    );
    if (
      edit([{ op: "insert", coll: STYLE_COLL[kind], item: { id, css } }], {
        message: `New ${COPY[kind].one} ${id}`,
      })
    )
      onDone(id);
  };
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border border-line-strong bg-raised p-2.5 animate-rise">
      <input
        // biome-ignore lint/a11y/noAutofocus: the user just asked for a new file
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") create();
          if (e.key === "Escape") onDone(null);
        }}
        placeholder="Name"
        aria-label={`New ${COPY[kind].one} name`}
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
              {styleName(b)}
            </option>
          ))}
        </select>
      </label>
      {id && (
        <span className={clsx("font-mono text-[10px]", taken ? "text-bad" : "text-faint")}>
          {STYLE_FOLDER[kind]}/{id}.css{taken ? " exists" : ""}
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
