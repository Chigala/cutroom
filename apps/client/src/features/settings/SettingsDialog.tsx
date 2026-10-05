/**
 * Settings: a section list on the left, the section's rows on the right (what it does on the left of each
 * row, its control on the right). Every change saves as it's made; keys save as they're typed or pasted.
 */
import type { AgentStatus, Diagnostics, Settings } from "@vedit/bridge";
import { clsx } from "clsx";
import {
  AudioLines,
  Bot,
  Check,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  ImagePlay,
  Scissors,
  SlidersHorizontal,
  Stethoscope,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { Button, Segmented } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { useClaude } from "../../state/claude.ts";
import { followLibrary, useLibrary } from "../../state/library.ts";
import { saveSettings } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";
import { setUi, useUi } from "../../state/ui.ts";
import { ClaudeSetup } from "./ClaudeSetup.tsx";

const SECTIONS = [
  { id: "claude", label: "Claude", icon: Bot },
  { id: "editing", label: "Editing", icon: Scissors },
  { id: "transcription", label: "Transcription", icon: AudioLines },
  { id: "media", label: "Media sources", icon: ImagePlay },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

const MODELS = [
  ["claude-opus-5-5", "Opus 5.5 · best edits"],
  ["claude-sonnet-5-5", "Sonnet 5.5 · faster"],
] as const;

const EFFORT = [
  { value: "low", label: "Quick" },
  { value: "medium", label: "Balanced" },
  { value: "high", label: "Careful" },
  { value: "max", label: "Max" },
] as const;

const WHISPER = [
  { value: "small.en", label: "Fast" },
  { value: "medium.en", label: "Better" },
  { value: "large-v3-turbo", label: "Best" },
] as const;

/** Languages whisper knows, for the Best model (Fast and Better are English only). */
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
  {
    key: "freesoundKey",
    env: "freesound",
    name: "Freesound",
    what: "Sound effects (optional: they work without it, through Openverse)",
    get: "freesound.org/apiv2/apply",
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

  if (!settings) return null;
  const close = () => setUi({ dialog: null });
  const usingApi = status?.backend === "api";
  const best = settings.whisperModel === "large-v3-turbo";

  return (
    <Dialog title="Settings" onClose={close} width={800}>
      <div className="-m-5 flex h-[min(600px,calc(100vh-130px))]">
        <nav className="flex w-[188px] shrink-0 flex-col gap-0.5 border-r border-line bg-sunken/40 p-2">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? "page" : undefined}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors",
                section === id ? "bg-selected text-fg" : "text-muted hover:bg-button hover:text-fg-2",
              )}
            >
              <Icon size={15} strokeWidth={1.8} className="shrink-0" />
              {label}
            </button>
          ))}
          <SaveNote saved={saved} />
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {section === "claude" && (
            <Page title="Claude" intro="The model that edits with you, and how it connects.">
              <ClaudeSetup usingApiKey={usingApi} />
              <Row
                title="Connect with"
                hint={
                  usingApi
                    ? "Using your API key (ANTHROPIC_API_KEY), billed per request."
                    : "Using your Claude subscription through Claude Code. Automatic switches to an API key when ANTHROPIC_API_KEY is set."
                }
                wide
              >
                <Segmented
                  value={settings.backend}
                  options={[
                    { value: "auto", label: "Automatic" },
                    { value: "subscription", label: "Subscription" },
                    { value: "api", label: "API key" },
                  ]}
                  onChange={(backend) => void update({ backend })}
                />
              </Row>
              <Row title="Model" hint="Opus makes the best edits; Sonnet answers sooner.">
                <Select
                  value={settings.model}
                  onChange={(model) => void update({ model })}
                  options={withCurrent(MODELS, settings.model)}
                />
              </Row>
              <Row
                title="How hard it thinks"
                hint="Careful and Max are slower and better for big edits. First cuts always think carefully."
                wide
              >
                <Segmented
                  value={EFFORT.some((e) => e.value === settings.effort) ? settings.effort : "high"}
                  options={EFFORT}
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
            </Page>
          )}

          {section === "transcription" && (
            <Page title="Transcription" intro="Speech to text runs on this Mac; nothing is uploaded.">
              <Row
                title="Quality"
                hint="Best is the most accurate and knows other languages. It downloads 1.6 GB once."
                wide
              >
                <Segmented
                  value={settings.whisperModel}
                  options={WHISPER}
                  onChange={(whisperModel) => void update({ whisperModel })}
                />
              </Row>
              <Row
                title="Language"
                hint={
                  best
                    ? "What's spoken in your footage. Nigerian Pidgin transcribes best as English."
                    : "Fast and Better only know English: choose Best for other languages."
                }
              >
                <Select
                  value={best ? settings.language : "en"}
                  disabled={!best}
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
                  name={k.name}
                  what={k.what}
                  get={k.get}
                  source={status?.keys?.[k.env] ?? null}
                  onChange={(v) => void update({ [k.key]: v })}
                />
              ))}
              <p className="text-xs leading-relaxed text-faint">
                Keys are kept in your Mac's keychain, never in a settings file. Without one here, the key is
                read from the environment or a .env file (KLIPY_API_KEY, PEXELS_API_KEY, PIXABAY_API_KEY,
                FREESOUND_API_KEY). KLIPY test keys allow 100 searches an hour.
              </p>
            </Page>
          )}

          {section === "advanced" && (
            <Page title="Advanced" intro="For when the defaults don't fit.">
              <Row
                title="Claude Code location"
                hint="Leave empty to use the Claude Code installed on this Mac, or the app's own copy if there's none."
                wide
              >
                <TextInput
                  value={settings.claudePath}
                  placeholder="Found automatically"
                  mono
                  onSave={(claudePath) => void update({ claudePath })}
                />
              </Row>
            </Page>
          )}

          {section === "diagnostics" && <DiagnosticsPage />}
        </div>
      </div>
    </Dialog>
  );
}

function Page({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
        <p className="text-[13px] text-muted">{intro}</p>
      </header>
      {children}
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
    <div
      className={clsx("flex gap-x-6 gap-y-2.5 border-t border-line pt-5", wide ? "flex-col" : "items-center")}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] font-medium text-fg">{title}</span>
        <span className="text-xs leading-relaxed text-muted">{hint}</span>
      </div>
      <div className={clsx("shrink-0", wide ? "w-full" : "flex w-[210px] justify-end")}>{children}</div>
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
      className={clsx(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-150",
        checked ? "bg-accent" : "bg-control",
      )}
    >
      <span
        className={clsx(
          "absolute top-[3px] left-[3px] size-4 rounded-full bg-white shadow transition-transform duration-150",
          checked && "translate-x-4",
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
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-[32px] w-full rounded-lg border border-line-strong bg-raised px-2.5 text-[13px] text-fg outline-none focus:border-edge disabled:opacity-50"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
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
        "h-[32px] w-full rounded-lg border border-line-strong bg-raised px-3 text-[13px] text-fg outline-none placeholder:text-faint focus:border-edge",
        mono && "font-mono text-[12px]",
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
      <div className="flex min-h-[38px] w-full flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2 py-1.5 focus-within:border-edge">
        {words.map((w) => (
          <span
            key={w}
            className="flex items-center gap-0.5 rounded-md bg-chip py-0.5 pr-0.5 pl-2 text-xs text-fg-2"
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
  name,
  what,
  get,
  source,
  onChange,
}: {
  name: string;
  what: string;
  get: string;
  /** Where the key in use comes from; its value never reaches the window. */
  source: "saved" | "env" | null;
  onChange: (v: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState("");
  const state = typed || source === "saved" ? "Saved" : source === "env" ? "From .env" : null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium">{name}</span>
          <span className="text-xs text-muted">{what}</span>
        </div>
        {state ? (
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-ok">
              <Check size={12} /> {state}
            </span>
            {state === "Saved" && (
              <button
                type="button"
                onClick={() => {
                  setTyped("");
                  onChange("");
                }}
                className="rounded px-1 text-faint hover:bg-button hover:text-fg-2"
              >
                Remove
              </button>
            )}
          </span>
        ) : (
          <a
            href={`https://${get}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs text-accent hover:underline"
          >
            Get a free key
          </a>
        )}
      </div>
      <div className="relative">
        <input
          type={shown ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          // Saved as it's pasted or typed: closing right after can't lose it.
          onChange={(e) => {
            const v = e.target.value.trim();
            setTyped(v);
            if (v) onChange(v);
          }}
          placeholder={
            source === "saved"
              ? "Saved in the keychain · paste a new key to replace it"
              : source === "env"
                ? "Using the key from .env · paste one to use it instead"
                : `${name} API key`
          }
          className="h-[34px] w-full rounded-lg border border-line-strong bg-raised pr-9 pl-3 font-mono text-[12px] text-fg outline-none placeholder:font-sans placeholder:text-faint focus:border-edge"
        />
        <button
          type="button"
          aria-label={shown ? "Hide key" : "Show key"}
          onClick={() => setShown(!shown)}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-faint hover:bg-button hover:text-fg-2"
        >
          {shown ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

/** Where the shared asset library lives, with the way to it and the way to move it. */
function LibraryRow() {
  const state = useLibrary((s) => s.state);
  useEffect(() => followLibrary(), []);
  const n = (state?.assets ?? []).filter((a) => a.scope === "library").length;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium">Your library</span>
        <span className="text-xs text-muted">
          {n} {n === 1 ? "asset" : "assets"}
        </span>
      </div>
      <span className="text-xs leading-relaxed text-muted">
        The sounds, music and memes you keep for every project. The agent uses them before searching the web.
        Each project can also have its own assets/ folder.
      </span>
      <span className="truncate font-mono text-[11.5px] text-fg-2" title={state?.dir}>
        {state?.dir.replace(/^\/Users\/[^/]+/, "~") ?? "…"}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => void host.library.reveal("library")}>
          <FolderOpen size={13} /> Show in Finder
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void host.library.pickDir()}>
          Change…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setUi({ dialog: null, sideTab: "library", selection: null })}
        >
          Open the Library tab
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
      `Video Editor ${d.version} · Electron ${d.electron} · ${d.os}`,
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
      <div className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2.5 font-mono text-[12px] text-fg-2">
        <span>Video Editor {d.version}</span>
        <span className="text-muted">
          Electron {d.electron} · {d.os}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void host.app.openLogs()}>
          <FolderOpen size={13} /> Open logs folder
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void navigator.clipboard.writeText(report()).then(
              () => toast("Copied. Paste it into your bug report, with the log file if you can."),
              () => toast("Couldn't copy it.", "warn"),
            )
          }
        >
          <Copy size={13} /> Copy a report
        </Button>
      </div>
      <Row
        title="Problems this session"
        hint={d.problems.length ? "Newest first. The full story is in the logs." : "None so far."}
        wide
      >
        {d.problems.length > 0 && (
          <ol className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto">
            {d.problems.map((p, i) => (
              <li key={i} className="flex gap-2 rounded-md bg-raised/60 px-2.5 py-1.5 text-xs">
                <span
                  className={clsx("shrink-0 font-mono", p.level === "error" ? "text-bad" : "text-accent")}
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
          <Check size={12} className="text-ok" /> Saved
        </>
      )}
    </div>
  );
}
