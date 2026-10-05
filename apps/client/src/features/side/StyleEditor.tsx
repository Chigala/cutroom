import { CaretRightIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { Thumbnail } from "@remotion/player";
import { compositionMeta, VideoComposition } from "@vedit/composition";
import {
  BUNDLED_FONTS,
  type CaptionLook,
  type CaptionStyle,
  lookDefaults,
  type Singleton,
} from "@vedit/project";
import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { FieldInput, FieldRow } from "../../components/FieldInput.tsx";
import { captionWindow, lookName, lookPreviewDoc } from "../../lib/caption-preview.ts";
import { fieldsForSingleton } from "../../lib/fields.ts";
import { MEDIA_BASE } from "../../lib/host.ts";
import { edit, useDoc, useProject } from "../../state/project.ts";
import { setUi } from "../../state/ui.ts";
import { applyLook } from "../looks/LookEditor.tsx";
import { BrandKits } from "./BrandKits.tsx";
import { MusicPart } from "./MusicPart.tsx";

/**
 * The project's look and sound, plus STYLE.md. Look, captions and music are generated from their schemas
 * (look.json, captions/captions.json, audio/music.json), so every setting in those files is editable here.
 */
export function StyleEditor() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
      <Section title="Brand kit" file="kits">
        <BrandKits />
      </Section>
      <Panel title="Look" file="look.json" setting="look" />
      <CaptionsPanel />
      <MusicPanel />
      <Panel title="Mix" file="audio/mix.json" setting="mix" />
      <Panel title="Cover" file="cover.json" setting="cover" />
      <Panel title="Export" file="export.json" setting="exportSettings" />
      <Panel title="Checks" file="checks.json" setting="checkRules" />
      <StyleMd />
    </div>
  );
}

function Section({
  title,
  file,
  children,
  open: initial = false,
}: {
  title: string;
  file: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-raised"
      >
        <CaretRightIcon size={14} className={clsx("text-muted transition-transform", open && "rotate-90")} />
        <span className="flex-1 text-[13px] font-medium">{title}</span>
        <span className="font-mono text-[10px] text-faint">{file}</span>
      </button>
      {open && <div className="flex flex-col gap-3 border-t border-line p-3">{children}</div>}
    </section>
  );
}

/** Every field of a settings file, saved with a merge op. */
function Panel({
  title,
  file,
  setting,
  skip,
  children,
}: {
  title: string;
  file: string;
  setting: Exclude<Singleton, "style" | "meta">;
  /** Fields shown by the panel's own controls instead. */
  skip?: readonly string[];
  children?: React.ReactNode;
}) {
  const value = useDoc((d) => d[setting]) as Record<string, unknown>;
  return (
    <Section title={title} file={file}>
      {children}
      {fieldsForSingleton(setting)
        .filter((f) => !skip?.includes(f.key))
        .map((f) => (
          <FieldRow key={f.key} field={f}>
            <FieldInput
              field={f}
              value={value[f.key]}
              onCommit={(v) =>
                edit([{ op: "merge", key: setting, patch: { [f.key]: v } }], {
                  message: `${title}: ${f.label.toLowerCase()}`,
                })
              }
            />
          </FieldRow>
        ))}
    </Section>
  );
}

/**
 * Captions: pick a look (each one shown on your own captions, over a moment of you speaking), a font,
 * then the settings in captions/captions.json. Looks are files in captions/looks/; edit one, make one, or
 * describe one to Claude in the look editor.
 */
function CaptionsPanel() {
  const looks = useDoc((d) => d.captionLooks);
  const current = useDoc((d) => d.captionStyle.look);
  const font = useDoc((d) => d.captionStyle.font);
  // Fonts dropped into the project's fonts/ folder, one entry per family.
  const fontFiles = useDoc((d) => d.fonts);
  const projectFamilies = useMemo(
    () =>
      [...new Set(fontFiles.map((f) => f.family))]
        .filter((f) => !BUNDLED_FONTS.some((b) => b.family === f))
        .sort(),
    [fontFiles],
  );
  return (
    <Panel title="Captions" file="captions/captions.json" setting="captionStyle" skip={["look", "font"]}>
      <FieldRow
        field={{ label: "Look", hint: "Click one to use it. Each look is a file in captions/looks/." }}
      >
        <div className="grid grid-cols-2 gap-2">
          {looks.map((l) => (
            <LookCard key={l.id} look={l} active={l.id === current} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setUi({ editingLook: current || looks[0]?.id || null })}
          className="mt-1 flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-button hover:text-fg"
        >
          <PencilSimpleIcon size={12} /> Edit, make, or describe a look to Claude
        </button>
      </FieldRow>
      <FieldRow
        field={{
          label: "Font",
          hint: "Overrides the look's own font. Drop .woff2, .ttf or .otf files into the project's fonts/ folder to add your own.",
        }}
      >
        <select
          value={font}
          onChange={(e) =>
            edit([{ op: "merge", key: "captionStyle", patch: { font: e.target.value } }], {
              message: e.target.value ? `Captions: ${e.target.value}` : "Captions: the look's own font",
            })
          }
          className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge"
        >
          <option value="">The look's own font</option>
          {projectFamilies.length > 0 && (
            <optgroup label="Your fonts (fonts/)">
              {projectFamilies.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Built in">
            {BUNDLED_FONTS.map((f) => (
              <option key={f.family} value={f.family} title={f.note}>
                {f.family}
              </option>
            ))}
          </optgroup>
          {font && !BUNDLED_FONTS.some((f) => f.family === font) && !projectFamilies.includes(font) && (
            <option value={font}>{font} (missing)</option>
          )}
        </select>
      </FieldRow>
    </Panel>
  );
}

/** How much of the frame's height a look card shows: the band around the caption, so looks read apart. */
const BAND = 0.36;

/** One look, rendered on your own captions, mid-sentence, cropped to the band the captions sit in. */
function LookCard({ look, active }: { look: CaptionLook; active: boolean }) {
  const doc = useProject((s) => s.doc!);
  const previewDoc = useMemo(
    () => lookPreviewDoc(doc, look, lookDefaults(look.css) as Partial<CaptionStyle>),
    [doc, look],
  );
  const props = useMemo(() => ({ doc: previewDoc, mediaBase: MEDIA_BASE }), [previewDoc]);
  const meta = compositionMeta(previewDoc);
  const win = useMemo(() => captionWindow(doc), [doc]);
  // The whole page said, so every look shows its full line, however it reveals words.
  const frame = Math.min(meta.durationInFrames - 1, Math.round(win.said * meta.fps));
  // Where the captions sit: above the speaker's head when a face was found and placement is auto (the
  // engine's rule), else at the style's own height.
  const style = previewDoc.captionStyle;
  const y = style.place === "auto" && doc.analyses.some((a) => a.face) ? 0.4 : style.y;
  // The card is 4:3. Showing BAND of the frame's height makes the frame (h / BAND) tall; widths and
  // offsets below are in percent of the card's width, which is what CSS margins measure against.
  const tall = 0.75 / BAND;
  const wide = (tall * meta.width) / meta.height;
  const top = Math.min(tall - 0.75, Math.max(0, y * tall - 0.375));
  return (
    <button
      type="button"
      onClick={() => !active && applyLook(look)}
      aria-pressed={active}
      title={active ? `${lookName(look)} (in use)` : `Use ${lookName(look)}`}
      className="flex min-w-0 flex-col gap-1 text-left"
    >
      <span
        className={clsx(
          "block overflow-hidden rounded-md bg-black",
          active
            ? "shadow-[0_0_0_2px_var(--color-accent)]"
            : "shadow-[0_0_0_1px_#2a2a30] hover:shadow-[0_0_0_1px_var(--color-fg-3)]",
        )}
        style={{ aspectRatio: "4 / 3" }}
      >
        <span
          className="block"
          style={{
            width: `${wide * 100}%`,
            aspectRatio: `${meta.width}/${meta.height}`,
            marginLeft: `${((1 - wide) / 2) * 100}%`,
            marginTop: `${-top * 100}%`,
          }}
        >
          <Thumbnail
            component={VideoComposition}
            inputProps={props}
            frameToDisplay={frame}
            durationInFrames={meta.durationInFrames}
            compositionWidth={meta.width}
            compositionHeight={meta.height}
            fps={meta.fps}
            style={{ width: "100%", height: "100%" }}
          />
        </span>
      </span>
      <span className={clsx("truncate text-[11px]", active ? "text-fg" : "text-muted")}>
        {lookName(look)}
      </span>
    </button>
  );
}

/** Music: which track (any imported audio clip), then its settings. */
function MusicPanel() {
  const music = useDoc((d) => d.music) as Record<string, unknown>;
  // Select the stable array, then derive: a selector that builds a new array re-renders forever.
  const sources = useDoc((d) => d.sources);
  const tracks = useMemo(() => sources.filter((s) => s.kind === "audio"), [sources]);
  const commit = (patch: Record<string, unknown>, label: string) =>
    edit([{ op: "merge", key: "music", patch }], { message: label });
  return (
    <Section title="Music" file="audio/music.json">
      <FieldRow
        field={{
          label: "Track",
          hint: "Drop an audio file on the window to add one, or ask the agent to find music",
        }}
      >
        <select
          value={(music.source as string | null) ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            const track = tracks.find((t) => t.id === id);
            commit(
              { source: id, ...(track && { label: track.label }) },
              id ? `Music: ${track?.label}` : "Removed music",
            );
          }}
          className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge"
        >
          <option value="">No music</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <MusicPart />
      {fieldsForSingleton("music")
        .filter((f) => f.key !== "section" && f.key !== "loop")
        .map((f) => (
          <FieldRow key={f.key} field={f}>
            <FieldInput
              field={f}
              value={music[f.key]}
              onCommit={(v) => commit({ [f.key]: v }, `Music: ${f.label.toLowerCase()}`)}
            />
          </FieldRow>
        ))}
    </Section>
  );
}

/** STYLE.md: your taste, in plain words, loaded into every agent request. */
function StyleMd() {
  const style = useDoc((d) => d.style);
  const [text, setText] = useState(style);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Take outside changes (agent, file edits) unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setText(style);
  }, [style]);

  const save = (value: string) => {
    clearTimeout(timer.current);
    if (value !== useProject.getState().doc?.style)
      edit([{ op: "set", key: "style", value }], { message: "Updated STYLE.md" });
  };

  return (
    <div className="flex min-h-[220px] flex-1 flex-col gap-2 pt-1">
      <div className="flex items-baseline justify-between px-1">
        <span className="font-mono text-xs text-fg">STYLE.md</span>
        <span className="text-[11px] text-muted">the agent follows this</span>
      </div>
      <textarea
        value={text}
        aria-label="STYLE.md"
        spellCheck={false}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={(e) => {
          focused.current = false;
          save(e.currentTarget.value);
        }}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(value), 800);
        }}
        className="min-h-0 flex-1 resize-none rounded-lg border border-line bg-raised p-3 font-mono text-xs leading-relaxed text-fg-2 outline-none focus:border-edge"
      />
    </div>
  );
}
