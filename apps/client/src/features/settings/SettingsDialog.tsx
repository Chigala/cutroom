/**
 * Settings, as a page over the editor: sections down the left (grouped, each with its icon), the
 * section's rows on the right (what it does on the left of each row, one control on the right). Every
 * change saves as it's made; keys save once their service says they work.
 */

import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckIcon,
  ClosedCaptioningIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderOpenIcon,
  type Icon,
  ImagesIcon,
  PulseIcon,
  ScissorsIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { AgentStatus, Diagnostics, KeyCheck, KeyProvider, Settings } from "@vedit/bridge";
import { clsx } from "clsx";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, Segmented } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { useClaude } from "../../state/claude.ts";
import { followLibrary, useLibrary } from "../../state/library.ts";
import { saveSettings } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";
import { setSideOpen, setUi, useUi } from "../../state/ui.ts";
import { EFFORTS, RECOMMENDED } from "../chat/EffortSlider.tsx";
import { PresetGrid, StyleText, useStyleDraft } from "../onboarding/StylePicker.tsx";
import { ClaudeSetup } from "./ClaudeSetup.tsx";

/** The sections, in two groups: how Cutroom edits, and this computer. */
const GROUPS = [
  {
    label: "Cutroom",
    sections: [
      { id: "claude", label: "Claude", icon: SparkleIcon },
      { id: "editing", label: "Editing", icon: ScissorsIcon },
      { id: "transcription", label: "Transcription", icon: ClosedCaptioningIcon },
      { id: "media", label: "Media sources", icon: ImagesIcon },
    ],
  },
  {
    label: "This computer",
    sections: [
      { id: "advanced", label: "Advanced", icon: SlidersHorizontalIcon },
      { id: "diagnostics", label: "Diagnostics", icon: PulseIcon },
    ],
  },
] as const satisfies readonly {
  label: string;
  sections: readonly { id: string; label: string; icon: Icon }[];
}[];
type Section = (typeof GROUPS)[number]["sections"][number]["id"];

const MODELS = [
  ["claude-opus-5-5", "Opus 5.5 · best edits"],
  ["claude-sonnet-5-5", "Sonnet 5.5 · faster"],
] as const;

const WHISPER = [
  { value: "large-v3-turbo", label: "Best" },
  { value: "large-v3-turbo-light", label: "Light" },
  { value: "small.en", label: "Fast" },
] as const;

/** Languages whisper knows, for Best, Light and Groq (Fast is English only). */
const LANGUAGES = [
  ["auto", "Detect it"],
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["de", "German"],
  ["yo", "Yoruba"],
  ["ha", "Hausa"],
  ["sw", "Swahili"],
  ["ar", "Arabic"],
] as const;

/** What a key check found, as the row says it. */
const KEY_RESULT: Record<KeyCheck, string> = {
  ok: "Works. Saved.",
  invalid: "That key didn't work. Check you copied all of it.",
  limited: "It works, but it's over its limit right now. Saved anyway.",
  offline: "Couldn't reach the service to check it. Saved; it'll be tried when it's used.",
};

const KEYS = [
  {
    key: "klipyKey",
    env: "klipy",
    name: "KLIPY",
    what: "Reaction GIFs, stickers, clips and memes",
    get: "partner.klipy.com",
  },
  {
    key: "pexelsKey",
    env: "pexels",
    name: "Pexels",
    what: "Stock footage and photos",
    get: "pexels.com/api",
  },
  {
    key: "pixabayKey",
    env: "pixabay",
    name: "Pixabay",
    what: "Stock footage and photos",
    get: "pixabay.com/api/docs",
  },
] as const;

/** A value the lists don't have (set by hand, or by the agent) still shows, as itself. */
const withCurrent = (options: readonly (readonly [string, string])[], value: string) =>
  options.some(([v]) => v === value) ? options : [...options, [value, value] as const];

export function SettingsDialog() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [section, setSection] = useState<Section>(useUi.getState().settingsSection ?? "claude");
  const [saved, setSaved] = useState<{ ok: boolean; at: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Each section opens at its top, not wherever the last one was scrolled to.
  const open = (id: Section) => {
    setSection(id);
    scroller.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    // Opened on a section once (Help → Diagnostics); the next opening starts at the top again.
    setUi({ settingsSection: null });
    void host.settings.get().then(setSettings);
    void host.agent.status().then(setStatus);
  }, []);

  const update = async (patch: Partial<Settings>) => {
    try {
      setSettings(await saveSettings(patch));
      setSaved({ ok: true, at: Date.now() });
      setStatus(await host.agent.status());
    } catch (err) {
      setSaved({ ok: false, at: Date.now() });
      toast(`Couldn't save that setting: ${(err as Error).message.slice(0, 160)}`, "warn");
    }
  };

  const close = () => setUi({ dialog: null });
  if (!settings) return null;
  const groq = settings.transcriber === "groq";
  const englishOnly = !groq && settings.whisperModel.endsWith(".en");

  return (
    <Sheet onClose={close}>
      <nav
        aria-label="Settings sections"
        className="flex w-[232px] shrink-0 flex-col gap-5 bg-sunken/50 px-3 pt-5 pb-3"
      >
        <span className="px-2.5 text-[13px] font-semibold text-fg">Settings</span>
        {GROUPS.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <span className="px-2.5 pb-1 text-[12px] text-faint">{g.label}</span>
            {g.sections.map(({ id, label, icon: SectionIcon }) => (
              <button
                key={id}
                type="button"
                onClick={() => open(id)}
                aria-current={section === id ? "page" : undefined}
                className={clsx(
                  "flex h-9 items-center gap-3 rounded-lg px-2.5 text-left text-[14px] transition-colors duration-150",
                  section === id ? "bg-selected text-fg" : "text-fg-3 hover:bg-button hover:text-fg",
                )}
              >
                <SectionIcon size={17} className={section === id ? "text-fg" : "text-muted"} />
                {label}
              </button>
            ))}
          </div>
        ))}
        <SaveNote saved={saved} />
      </nav>

      <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-10 pt-12 pb-16">
          {section === "claude" && (
            <Page title="Claude" intro="The model that edits with you, on your own Claude plan.">
              <div className="pb-5">
                <ClaudeSetup />
              </div>
              <Row title="Model" hint="Opus makes the best edits; Sonnet answers sooner.">
                <Select
                  value={settings.model}
                  onChange={(model) => void update({ model })}
                  options={withCurrent(MODELS, settings.model)}
                />
              </Row>
              <Row
                title="Effort"
                hint={`How long Claude thinks before it acts. Higher is smarter on big edits, slower, and uses more of your plan. ${EFFORTS.find((e) => e.value === RECOMMENDED)?.label} suits most edits; first cuts think harder on their own.`}
                wide
              >
                <Segmented
                  fit
                  value={settings.effort}
                  options={EFFORTS}
                  onChange={(effort) => void update({ effort })}
                />
              </Row>
              <Row
                title="Show its thinking"
                hint="A summary of its thinking streams into the chat as it works, folded away when it's done."
              >
                <Switch
                  checked={settings.showThinking}
                  onChange={(showThinking) => void update({ showThinking })}
                  label="Show its thinking"
                />
              </Row>
              <Row
                title="Instant edits"
                hint="Quick tweaks like “captions bigger”, “mute the music” or “undo the zooms” happen at once, without waiting for Claude. Anything else still goes to Claude."
              >
                <Switch
                  checked={settings.instantEdits}
                  onChange={(instantEdits) => void update({ instantEdits })}
                  label="Instant edits"
                />
              </Row>
            </Page>
          )}

          {section === "editing" && (
            <Page title="Editing" intro="What the agent does on its own.">
              <Row
                title="Make a first cut automatically"
                hint="When you drop clips into an empty project, the agent edits a draft as soon as they're indexed."
              >
                <Switch
                  checked={settings.autoFirstCut}
                  onChange={(autoFirstCut) => void update({ autoFirstCut })}
                  label="Make a first cut automatically"
                />
              </Row>
              <Row
                title="Describe what's shown"
                hint="At import, Claude watches every clip and notes what each shot shows, so the agent can find b-roll and reactions. Uses your Claude connection."
              >
                <Switch
                  checked={settings.describeShots}
                  onChange={(describeShots) => void update({ describeShots })}
                  label="Describe what's shown"
                />
              </Row>
              <NewProjectStyle saved={settings.style} />
            </Page>
          )}

          {section === "transcription" && (
            <Page
              title="Transcription"
              intro="Every word said becomes captions, cut points and something the agent can read."
            >
              <Row
                title="Where it runs"
                hint={
                  groq
                    ? "On Groq: the same model as Best, in seconds, with nothing to download. The audio is sent to Groq."
                    : "On this computer: nothing leaves it."
                }
              >
                <Segmented
                  fit
                  value={settings.transcriber}
                  options={[
                    { value: "local", label: "This computer" },
                    { value: "groq", label: "Groq (Instant)" },
                  ]}
                  onChange={(transcriber) => void update({ transcriber })}
                />
              </Row>
              {groq ? (
                <KeyRow
                  provider="groq"
                  name="Groq"
                  what="Free key; needed for transcription on Groq"
                  get="console.groq.com/keys"
                  source={status?.keys?.groq ?? null}
                  onSave={(groqKey) => update({ groqKey })}
                />
              ) : (
                <Row
                  title="Quality"
                  hint={
                    settings.whisperModel === "large-v3-turbo-light"
                      ? "Light: a third of the size (574 MB). The same words on clean speech, a few slips on noisy audio."
                      : settings.whisperModel === "small.en"
                        ? "Fast: small and quick, English only, and least accurate."
                        : "Best: the most accurate; holds up on streams, music and slang. Downloads 1.6 GB once."
                  }
                >
                  <Segmented
                    fit
                    value={
                      WHISPER.some((w) => w.value === settings.whisperModel)
                        ? settings.whisperModel
                        : "large-v3-turbo"
                    }
                    options={WHISPER}
                    onChange={(whisperModel) => void update({ whisperModel })}
                  />
                </Row>
              )}
              <Row
                title="Language"
                hint={
                  englishOnly
                    ? "Fast only knows English: choose Best or Light for other languages."
                    : "What's spoken in your footage. Nigerian Pidgin transcribes best as English."
                }
              >
                <Select
                  value={englishOnly ? "en" : settings.language}
                  disabled={englishOnly}
                  onChange={(language) => void update({ language })}
                  options={withCurrent(LANGUAGES, settings.language)}
                />
              </Row>
              <Glossary words={settings.glossary} onSave={(glossary) => void update({ glossary })} />
            </Page>
          )}

          {section === "media" && (
            <Page
              title="Media sources"
              intro="Your own library comes first; free API keys let the agent search the web when it has nothing that fits."
            >
              <LibraryRow />
              {KEYS.map((k) => (
                <KeyRow
                  key={k.key}
                  provider={k.env}
                  name={k.name}
                  what={k.what}
                  get={k.get}
                  source={status?.keys?.[k.env] ?? null}
                  onSave={(v) => update({ [k.key]: v })}
                />
              ))}
              <p className="m-0 pt-5 text-[12.5px] leading-relaxed text-faint">
                Keys are kept encrypted on this computer, never in a settings file, and each is checked with
                its service before it's saved. One stock footage key is enough. KLIPY test keys allow 100
                searches an hour.
              </p>
            </Page>
          )}

          {section === "advanced" && (
            <Page title="Advanced" intro="For when the defaults don't fit.">
              <Row
                title="Claude Code location"
                hint="Leave empty to use the Claude Code installed on this computer, or the app's own copy if there's none."
                wide
              >
                <TextInput
                  value={settings.claudePath}
                  placeholder="Found automatically"
                  mono
                  onSave={(claudePath) => void update({ claudePath })}
                />
              </Row>
              <Row
                title="Setup"
                hint="The welcome screens: Claude, transcription and the optional power-ups, with how to get each key."
              >
                <Button
                  size="sm"
                  onClick={() => {
                    setUi({ dialog: null });
                    void update({ onboarded: false });
                  }}
                >
                  Run setup again
                </Button>
              </Row>
            </Page>
          )}

          {section === "diagnostics" && <DiagnosticsPage />}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The page Settings sits on: most of the window, over the editor dimmed, its close button in the
 * corner. A real <dialog>: focus stays in it, Escape closes it.
 */
function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Settings"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto h-[min(820px,calc(100vh-56px))] w-[min(1080px,calc(100vw-56px))] max-w-none overflow-hidden rounded-2xl border border-line-strong bg-panel p-0 text-fg shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop:bg-black/55 backdrop:backdrop-blur-[3px] open:flex open:animate-rise"
    >
      {children}
      <button
        type="button"
        aria-label="Close settings"
        title="Close (Esc)"
        onClick={onClose}
        className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-button hover:text-fg"
      >
        <XIcon size={17} />
      </button>
    </dialog>
  );
}

/** The STYLE.md new projects start with. A project's own is STYLE.md in its folder: ask in chat. */
function NewProjectStyle({ saved }: { saved: string }) {
  const { text, setText } = useStyleDraft(saved);
  return (
    <Row
      title="Style for new projects"
      hint="The STYLE.md every new project starts with: your taste in words, read before every edit. Pick a starting point, then make it yours. To change one project's style, ask in its chat."
      wide
    >
      <div className="flex w-full flex-col gap-3">
        <PresetGrid text={text} onPick={setText} compact />
        <div className="rounded-xl bg-sunken/70 px-4 py-3 ring-1 ring-line ring-inset focus-within:ring-edge">
          <StyleText text={text} onChange={setText} className="h-[240px]" />
        </div>
      </div>
    </Row>
  );
}

function Page({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-1.5 pb-6">
        <h2 className="m-0 text-[22px] font-semibold tracking-[-0.015em] text-fg">{title}</h2>
        <p className="m-0 text-[14px] leading-relaxed text-muted">{intro}</p>
      </header>
      <div className="flex flex-col divide-y divide-line">{children}</div>
    </div>
  );
}

/** One setting: what it is on the left, its control on the right (under it when `wide`). */
function Row({
  title,
  hint,
  wide,
  children,
}: {
  title: string;
  hint: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={clsx("flex gap-x-8 gap-y-3.5 py-5", wide ? "flex-col" : "items-center")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[14px] font-medium text-fg">{title}</span>
        <span className="text-[13px] leading-relaxed text-muted">{hint}</span>
      </div>
      <div className={clsx("shrink-0", wide ? "w-full" : "flex max-w-[260px] justify-end")}>{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      // On in the accent (what's switched on reads at a glance), off a quiet grey.
      className={clsx(
        "relative h-6 w-[42px] shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-control ring-1 ring-line-strong ring-inset",
      )}
    >
      <span
        className={clsx(
          "absolute top-[3px] left-[3px] size-[18px] rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out",
          checked ? "translate-x-[18px] bg-white" : "bg-muted",
        )}
      />
    </button>
  );
}

function Select({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative min-w-[200px]">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg bg-control pr-9 pl-3 text-[13.5px] text-fg outline-none transition-colors hover:bg-selected focus-visible:ring-2 focus-visible:ring-edge disabled:opacity-50"
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <CaretDownIcon
        size={13}
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

/** A text field that saves when it's left (or on Enter), not on every keystroke. */
function TextInput({
  value,
  onSave,
  placeholder,
  mono,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [text, setText] = useState(value);
  const save = () => {
    if (text.trim() !== value) onSave(text.trim());
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && save()}
      placeholder={placeholder}
      spellCheck={false}
      className={clsx(
        "h-9 w-full rounded-lg bg-sunken/70 px-3 text-[13.5px] text-fg ring-1 ring-line ring-inset outline-none placeholder:text-faint focus:ring-edge",
        mono && "font-mono text-[12.5px]",
      )}
    />
  );
}

/** Words to spell right, as removable chips: type one and press Enter or a comma to add it. */
function Glossary({ words, onSave }: { words: readonly string[]; onSave: (w: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const fresh = draft
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w && !words.includes(w));
    setDraft("");
    if (fresh.length) onSave([...words, ...fresh]);
  };
  return (
    <Row
      title="Words to spell right"
      hint="Names, brands and jargon the transcript should get right, and the captions with it."
      wide
    >
      <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg bg-sunken/70 px-2 py-1.5 ring-1 ring-line ring-inset focus-within:ring-edge">
        {words.map((w) => (
          <span
            key={w}
            className="flex items-center gap-0.5 rounded-md bg-control py-0.5 pr-0.5 pl-2 text-[12.5px] text-fg-2"
          >
            {w}
            <button
              type="button"
              aria-label={`Remove ${w}`}
              onClick={() => onSave(words.filter((x) => x !== w))}
              className="rounded px-1 text-faint hover:bg-button hover:text-fg"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && words.length) onSave(words.slice(0, -1));
          }}
          onBlur={add}
          placeholder={words.length ? "Add another" : "Lagos, Hugging Face, Ugo"}
          className="min-w-[120px] flex-1 bg-transparent px-1 text-[13px] text-fg outline-none placeholder:text-faint"
        />
      </div>
    </Row>
  );
}

function KeyRow({
  provider,
  name,
  what,
  get,
  source,
  onSave,
}: {
  provider: KeyProvider;
  name: string;
  what: string;
  get: string;
  /** Whether a key is saved; its value never reaches the window. */
  source: "saved" | null;
  onSave: (v: string) => Promise<void>;
}) {
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<KeyCheck | null>(null);
  // Tried with its service first, and saved unless it's plainly wrong.
  const check = async () => {
    const key = typed.trim();
    if (!key) return;
    setChecking(true);
    const r = await host.settings.checkKey(provider, key);
    setChecking(false);
    setResult(r);
    if (r !== "invalid") {
      await onSave(key);
      setTyped("");
    }
  };
  return (
    <div className="flex flex-col gap-3.5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[14px] font-medium">{name}</span>
          <span className="text-[13px] text-muted">{what}</span>
        </div>
        {source === "saved" ? (
          <span className="flex shrink-0 items-center gap-2 text-[12.5px]">
            <span className="flex items-center gap-1 text-ok">
              <CheckIcon size={12} /> Saved
            </span>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                void onSave("");
              }}
              className="rounded px-1 text-faint hover:bg-button hover:text-fg-2"
            >
              Remove
            </button>
          </span>
        ) : (
          <a
            href={`https://${get}`}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-fg-3 hover:bg-button hover:text-fg"
          >
            Get a free key <ArrowSquareOutIcon size={12} />
          </a>
        )}
      </div>
      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            type={shown ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setResult(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void check();
            }}
            placeholder={source === "saved" ? "Paste a new key to replace it" : `Paste your ${name} key`}
            className="h-9 w-full rounded-lg bg-sunken/70 pr-9 pl-3 font-mono text-[12.5px] text-fg ring-1 ring-line ring-inset outline-none placeholder:font-sans placeholder:text-faint focus:ring-edge"
          />
          <button
            type="button"
            aria-label={shown ? "Hide key" : "Show key"}
            onClick={() => setShown(!shown)}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-faint hover:bg-button hover:text-fg-2"
          >
            {shown ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />}
          </button>
        </div>
        <Button disabled={!typed.trim() || checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check"}
        </Button>
      </div>
      {result && (
        <span
          className={clsx(
            "text-xs",
            result === "invalid" ? "text-bad" : result === "ok" ? "text-ok" : "text-muted",
          )}
        >
          {KEY_RESULT[result]}
        </span>
      )}
    </div>
  );
}

function LibraryRow() {
  const state = useLibrary((s) => s.state);
  useEffect(() => followLibrary(), []);
  const n = (state?.assets ?? []).filter((a) => a.scope === "library").length;
  return (
    <div className="flex flex-col gap-3.5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[14px] font-medium">Your library</span>
          <span className="text-[13px] leading-relaxed text-muted">
            The sounds, music and memes you keep for every project. Claude uses them before searching the web;
            each project can also have its own assets/ folder.
          </span>
        </div>
        <span className="shrink-0 text-[12.5px] text-faint tabular-nums">
          {n} {n === 1 ? "asset" : "assets"}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg-3" title={state?.dir}>
          {state?.dir.replace(/^\/Users\/[^/]+/, "~") ?? "…"}
        </span>
        <Button size="sm" onClick={() => void host.library.reveal("library")}>
          <FolderOpenIcon size={13} /> Show in Finder
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void host.library.pickDir()}>
          Change…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setUi({ dialog: null, sideTab: "library", selection: null });
            setSideOpen(true);
          }}
        >
          Open the tab
        </Button>
      </div>
    </div>
  );
}

/** Versions, the logs folder and this session's problems: what a bug report needs. */
function DiagnosticsPage() {
  const [d, setD] = useState<Diagnostics | null>(null);
  const claude = useClaude((s) => s.status);
  useEffect(() => {
    void host.app.diagnostics().then(setD);
  }, []);
  if (!d) return null;
  const report = () =>
    [
      `Cutroom ${d.version} · Electron ${d.electron} · ${d.os}`,
      claude
        ? `Claude Code: ${claude.source}${claude.version ? ` ${claude.version}` : ""}${claude.signedIn === true ? `, signed in (${claude.method ?? "?"})` : claude.signedIn === false ? ", not signed in" : ""}`
        : "",
      "",
      d.problems.length ? "Recent problems:" : "No problems this session.",
      ...d.problems
        .slice(0, 20)
        .map((p) => `${new Date(p.at).toISOString()} ${p.level} [${p.from}] ${p.text}`),
    ]
      .filter((l, i) => l || i === 2)
      .join("\n");
  return (
    <Page
      title="Diagnostics"
      intro="What to send along when something goes wrong. API keys are never included."
    >
      <Row title={`Cutroom ${d.version}`} hint={`Electron ${d.electron} · ${d.os}`}>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => void host.app.openLogs()}>
            <FolderOpenIcon size={13} /> Logs
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void navigator.clipboard.writeText(report()).then(
                () => toast("Copied. Paste it into your bug report, with the log file if you can."),
                () => toast("Couldn't copy it.", "warn"),
              )
            }
          >
            <CopyIcon size={13} /> Copy a report
          </Button>
        </div>
      </Row>
      <Row
        title="Problems this session"
        hint={d.problems.length ? "Newest first. The full story is in the logs." : "None so far."}
        wide
      >
        {d.problems.length > 0 && (
          <ol className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto">
            {d.problems.map((p, i) => (
              <li key={i} className="flex gap-3 rounded-lg bg-sunken/70 px-3 py-2 text-[12.5px]">
                <span
                  className={clsx("shrink-0 tabular-nums", p.level === "error" ? "text-bad" : "text-muted")}
                >
                  {new Date(p.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="line-clamp-3 min-w-0 break-words text-fg-2" title={p.text}>
                  {p.from === "window" && <span className="text-faint">window · </span>}
                  {p.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Row>
    </Page>
  );
}

/** "Saved" for a moment after each change, at the foot of the section list. */
function SaveNote({ saved }: { saved: { ok: boolean; at: number } | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!saved) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(t);
  }, [saved]);
  return (
    <div
      aria-live="polite"
      className={clsx(
        "mt-auto flex items-center gap-1.5 px-2.5 py-2 text-xs transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
        saved?.ok === false ? "text-bad" : "text-muted",
      )}
    >
      {saved?.ok === false ? (
        "Not saved"
      ) : (
        <>
          <CheckIcon size={12} className="text-ok" /> Saved
        </>
      )}
    </div>
  );
}
