/**
 * A real code editor for the files you edit like web pages (graphics' HTML, caption looks' and effects'
 * CSS): syntax highlighting, bracket matching, auto-closing tags, search, and undo of its own. CodeMirror,
 * themed with the app's colours. ⌘S saves; keys typed here never reach the editor's shortcuts.
 */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--color-sunken)", color: "var(--color-fg-2)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12.5px", lineHeight: "1.6" },
    ".cm-content": { padding: "12px 0", caretColor: "var(--color-accent)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "2px" },
    ".cm-gutters": {
      backgroundColor: "var(--color-sunken)",
      color: "var(--color-faint)",
      border: "none",
      paddingLeft: "6px",
    },
    ".cm-activeLine": { backgroundColor: "#ffffff06" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-fg-3)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent) !important",
    },
    ".cm-selectionMatch": { backgroundColor: "#ffffff12" },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "#ffffff1a", outline: "none" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--color-chip)",
      border: "none",
      color: "var(--color-muted)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--color-panel)",
      border: "1px solid var(--color-line-strong)",
      borderRadius: "8px",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--color-selected)",
      color: "var(--color-fg)",
    },
    ".cm-panels": { backgroundColor: "var(--color-panel)", color: "var(--color-fg-2)" },
    ".cm-panels input, .cm-panels button": { fontSize: "12px" },
  },
  { dark: true },
);

/** Warm, quiet colours: tags and properties readable at a glance, nothing neon. */
const highlight = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket], color: "#e5a46b" },
  { tag: t.attributeName, color: "#d8b979" },
  { tag: [t.string, t.attributeValue, t.special(t.string)], color: "#9fcf9a" },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "#8cb8e8" },
  { tag: [t.number, t.unit, t.bool, t.atom, t.color], color: "#e8a0bf" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: "#c9a2f0" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--color-fg-2)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7fd1c7" },
  { tag: [t.className, t.labelName, t.typeName], color: "#f0c674" },
  { tag: [t.comment, t.blockComment, t.lineComment], color: "var(--color-faint)", fontStyle: "italic" },
  { tag: [t.punctuation, t.separator, t.bracket], color: "var(--color-muted)" },
  { tag: t.invalid, color: "var(--color-bad)" },
]);

export function CodeEditor({
  value,
  onChange,
  onSave,
  label,
  language,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  label: string;
  /** html also highlights the <style> and <script> inside it. */
  language: "html" | "css";
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The latest callbacks, without rebuilding the editor (and losing its undo and cursor) on each render.
  const latest = useRef({ onChange, onSave });
  latest.current = { onChange, onSave };

  // biome-ignore lint/correctness/useExhaustiveDependencies: built once per language; value syncs below
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorState.tabSize.of(2),
          language === "html" ? html() : css(),
          syntaxHighlighting(highlight),
          theme,
          EditorView.contentAttributes.of({ "aria-label": label }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                latest.current.onSave();
                return true;
              },
            },
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, [language]);

  // A change from outside (an agent's edit, the file changed in another editor, a revert) replaces the
  // text; the editor's own typing already matches and leaves it alone.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return (
    // Keys typed in the code never trigger the app's shortcuts (space to play, delete to remove a clip).
    <div ref={host} onKeyDown={(e) => e.stopPropagation()} className="min-h-0 flex-1 overflow-hidden" />
  );
}
