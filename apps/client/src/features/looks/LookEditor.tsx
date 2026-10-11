/**
 * The caption look editor: a look is a stylesheet (captions/looks/<id>.css) for the captions the engine
 * places and times, so you edit its CSS and watch your own captions change as you type, over a moment of
 * you speaking. Or describe the look you want and Claude writes it. Saving is one undoable update to the
 * captionLooks collection, written to the file like any other edit.
 */

import { ArrowLeftIcon, CheckIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { PlayerRef } from "@remotion/player";
import { type CaptionLook, type CaptionStyle, lookDefaults, STARTER_CAPTION_LOOKS } from "@vedit/project";
import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { captionWindow, lookName, lookPreviewDoc } from "../../lib/caption-preview.ts";
import { send } from "../../state/chat.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { agentName } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";
import { setUi, useUi } from "../../state/ui.ts";
import { AskClaude, CodeArea, PreviewPlayer } from "../code/parts.tsx";

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const HEADER = /\/\*\s*look\s+(\{[\s\S]*?\})\s*\*\//;

/** What's wrong with a look's header, if anything. The CSS itself is the browser's to judge. */
function headerProblem(css: string): string | null {
  const m = HEADER.exec(css);
  if (!m) return 'Start the file with a header comment: /* look {"name": "…"} */';
  try {
    JSON.parse(m[1]!);
    return null;
  } catch (err) {
    return `The look header isn't valid JSON: ${(err as Error).message}`;
  }
}

/** Switches the project's captions to a look, with the settings its header asks for, as one edit. */
function applyLook(look: CaptionLook): boolean {
  return edit(
    [
      {
        op: "merge",
        key: "captionStyle",
        patch: { ...(lookDefaults(look.css) as Partial<CaptionStyle>), look: look.id },
      },
    ],
    {
      message: `Captions: ${lookName(look)} look`,
    },
  );
}

export function LookEditor() {
  const id = useUi((s) => s.editingLook)!;
  const looks = useDoc((d) => d.captionLooks);
  const current = useDoc((d) => d.captionStyle.look);
  const saved = looks.find((l) => l.id === id);
  const [draft, setDraft] = useState(saved?.css ?? "");
  const [preview, setPreview] = useState(draft);
  const [creating, setCreating] = useState(false);
  const player = useRef<PlayerRef>(null);
  const dirty = saved !== undefined && draft !== saved.css;

  // Switching looks, or an outside edit (the agent, another editor) to this one while it's clean,
  // resets the draft.
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

  const problem = useMemo(() => headerProblem(draft), [draft]);

  const save = () => {
    if (!saved || !dirty) return;
    if (
      edit([{ op: "update", coll: "captionLooks", id, patch: { css: draft } }], {
        message: `Edited captions/looks/${id}.css`,
      })
    ) {
      lastSaved.current = draft;
      toast("Saved");
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Leave without saving your changes to this look?")) return;
    setUi({ editingLook: null });
  };

  const switchTo = (next: string) => {
    if (next === id) return;
    if (dirty && !window.confirm("Switch without saving your changes?")) return;
    const l = looks.find((x) => x.id === next);
    setDraft(l?.css ?? "");
    setPreview(l?.css ?? "");
    lastSaved.current = l?.css;
    setUi({ editingLook: next });
  };

  const remove = () => {
    if (id === current) return toast("Your captions use this look. Switch to another one first.", "warn");
    if (!window.confirm(`Delete captions/looks/${id}.css?`)) return;
    if (edit([{ op: "remove", coll: "captionLooks", id }], { message: `Deleted captions/looks/${id}.css` })) {
      setUi({ editingLook: looks.find((l) => l.id !== id)?.id ?? null });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg animate-fade-in">
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line pr-5 pl-[84px]">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <span className="shrink-0 font-semibold">Caption looks</span>
          <span className="text-faint">/</span>
          <span className="truncate font-mono text-[13px] text-fg-3">captions/looks/{id}.css</span>
          {dirty && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">unsaved</span>
          )}
        </div>
        <div className="no-drag flex shrink-0 gap-2">
          <Button onClick={close}>
            <ArrowLeftIcon size={14} /> Back to editor
          </Button>
          {saved && id !== current && (
            <Button
              disabled={dirty}
              title={dirty ? "Save first" : undefined}
              onClick={() => applyLook(saved) && toast(`Captions now use ${lookName(saved)}`)}
            >
              Use for my captions
            </Button>
          )}
          <Button variant="accent" disabled={!dirty} onClick={save}>
            Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[220px] shrink-0 flex-col max-xl:w-[176px] gap-1 border-r border-line bg-panel p-3">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="font-mono text-[11px] tracking-wide text-muted uppercase">captions/looks/</span>
            <button
              type="button"
              aria-label="New look"
              title="New look"
              onClick={() => setCreating(true)}
              className="rounded p-1 text-muted hover:bg-button hover:text-fg"
            >
              <PlusIcon size={14} />
            </button>
          </div>
          {creating && (
            <NewLook
              looks={looks}
              onDone={(created) => {
                setCreating(false);
                if (created) switchTo(created);
              }}
            />
          )}
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {looks.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => switchTo(l.id)}
                className={clsx(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  l.id === id ? "bg-selected text-fg" : "text-fg-2 hover:bg-raised",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px]">{lookName(l)}</span>
                  <span className="truncate font-mono text-[10px] text-faint">{l.id}.css</span>
                </span>
                {l.id === current && (
                  <CheckIcon size={13} className="shrink-0 text-accent" aria-label="Your captions use this" />
                )}
              </button>
            ))}
          </div>
        </nav>

        <section className="flex min-w-0 flex-1 flex-col border-r border-line">
          <CodeArea value={draft} onChange={setDraft} onSave={save} label="Caption look CSS" />
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2 text-xs">
            {problem ? (
              <span className="text-bad">{problem}</span>
            ) : (
              <span className="text-muted">
                CSS for .caption and each .word (.said, .now, .next, .hl for highlighted). Vars: --size,
                --color, --accent, --font, --page-t, --word-t. Animations on .word play as each word is said.
              </span>
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

        <aside className="flex w-[380px] shrink-0 flex-col max-xl:w-[320px] gap-3 overflow-y-auto bg-panel p-4">
          <Preview id={id} css={preview} player={player} />
          <AskAboutLook id={id} dirty={dirty} />
          <p className="text-[11px] leading-relaxed text-faint">
            The preview shows this look on your own captions, over a moment of you speaking. Size, colors and
            the font you pick in the Style tab apply on top.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Points through a caption page worth seeing: the page arriving, words being said, the hold. */
const STRIP = [0, 0.12, 0.3, 0.5, 0.75, 1];

function Preview({
  id,
  css,
  player,
}: {
  id: string;
  css: string;
  player: React.RefObject<PlayerRef | null>;
}) {
  const doc = useProject((s) => s.doc!);
  // A look you're trying out shows with the settings its header asks for, as "Use" would apply them; the
  // look your captions already use shows with your own settings.
  const inUse = doc.captionStyle.look === id;
  const previewDoc = useMemo(
    () => lookPreviewDoc(doc, { id, css }, inUse ? {} : (lookDefaults(css) as Partial<CaptionStyle>)),
    [doc, id, css, inUse],
  );
  const win = useMemo(() => captionWindow(doc), [doc]);
  const fps = doc.meta.format.fps;
  const span = Math.max(0.5, win.end - win.page - 0.2);
  const frames = STRIP.map((p) => {
    const t = win.page + 0.05 + p * span;
    return { frame: Math.round(t * fps), label: `${t.toFixed(2)}s` };
  });
  return (
    <PreviewPlayer
      doc={previewDoc}
      frames={frames}
      player={player}
      initialFrame={Math.round(win.start * fps)}
      inFrame={Math.round(win.start * fps)}
      outFrame={Math.round(win.end * fps)}
    />
  );
}

/** Describe a caption look and Claude writes it: a new one, or a change to the one that's open. */
function AskAboutLook({ id, dirty }: { id: string; dirty: boolean }) {
  const go = (prompt: string) => {
    void send(prompt, {}, "thorough");
    toast(`${agentName()} is on it. Follow along in the chat.`);
    return true;
  };
  return (
    <AskClaude
      label="Describe the caption look"
      placeholder="e.g. big tight sentence-case text with a silver gradient and a soft glow, no outline"
      change={(want) => {
        if (dirty) {
          toast("Save or undo your edits to this look first, so Claude starts from them.", "warn");
          return false;
        }
        return go(
          `Change the caption look captions/looks/${id}.css: ${want}. Check it on frames where I'm speaking before you finish.`,
        );
      }}
      create={(want) =>
        go(
          `Make a new caption look: ${want}. Save it as its own file in captions/looks/ and use it for my captions. Check it on frames where I'm speaking before you finish.`,
        )
      }
    />
  );
}

/** Name a new look and pick what to start from: one of yours, or a starter. */
function NewLook({
  looks,
  onDone,
}: {
  looks: readonly CaptionLook[];
  onDone: (created: string | null) => void;
}) {
  const [name, setName] = useState("");
  const bases = [...looks, ...STARTER_CAPTION_LOOKS.filter((s) => !looks.some((l) => l.id === s.id))];
  const [base, setBase] = useState(bases[0]?.id ?? "");
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const taken = looks.some((l) => l.id === id);
  const create = () => {
    if (!ID.test(id) || taken) return;
    const from = bases.find((b) => b.id === base);
    // Give the copy its own name in the header.
    const css = (from?.css ?? '/* look {"name": ""} */\n').replace(
      /("name"\s*:\s*")[^"]*(")/,
      `$1${name.trim().replace(/"/g, "")}$2`,
    );
    if (edit([{ op: "insert", coll: "captionLooks", item: { id, css } }], { message: `New look ${id}` }))
      onDone(id);
  };
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border border-line-strong bg-raised p-2.5 animate-rise">
      <input
        // biome-ignore lint/a11y/noAutofocus: the user just asked for a new look
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") create();
          if (e.key === "Escape") onDone(null);
        }}
        placeholder="Name, e.g. Brand bold"
        aria-label="New look name"
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
              {lookName(b)}
            </option>
          ))}
        </select>
      </label>
      {id && (
        <span className={clsx("font-mono text-[10px]", taken ? "text-bad" : "text-faint")}>
          captions/looks/{id}.css{taken ? " exists" : ""}
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
