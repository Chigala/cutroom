/**
 * Settings: a section list on the left, the section's rows on the right (what it does on the left of each
 * row, its control on the right). Every change saves as it's made; keys save as they're typed or pasted.
 */

import { CheckIcon, CopyIcon, EyeIcon, EyeSlashIcon, FolderOpenIcon } from "@phosphor-icons/react";
import type { AgentStatus, Diagnostics, KeyCheck, KeyProvider, Settings } from "@vedit/bridge";
import { clsx } from "clsx";
import { type ReactNode, useEffect, useState } from "react";
import { Dialog } from "../../components/Dialog.tsx";
import { Button, Segmented } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { useClaude } from "../../state/claude.ts";
import { followLibrary, useLibrary } from "../../state/library.ts";
import { saveSettings } from "../../state/settings.ts";
import { toast } from "../../state/toast.ts";
import { setSideOpen, setUi, useUi } from "../../state/ui.ts";
import { EffortSlider } from "../chat/EffortSlider.tsx";
import { PresetGrid, StyleText, useStyleDraft } from "../onboarding/StylePicker.tsx";
import { ClaudeSetup } from "./ClaudeSetup.tsx";

/** Words alone: six short, plain names say it better than icons would. */
const SECTIONS = [
  { id: "claude", label: "Claude" },
  { id: "editing", label: "Editing" },
  { id: "transcription", label: "Transcription" },
  { id: "media", label: "Media sources" },
  { id: "advanced", label: "Advanced" },
  { id: "diagnostics", label: "Diagnostics" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

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
  const groq = settings.transcriber === "groq";
  const englishOnly = !groq && settings.whisperModel.endsWith(".en");

  return (
    <Dialog title="Settings" onClose={close} width={800}>
      <div className="-m-5 flex h-[min(600px,calc(100vh-130px))]">
        <nav className="flex w-[188px] shrink-0 flex-col gap-0.5 border-r border-line bg-sunken/40 p-2">
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? "page" : undefined}
              className={clsx(
                "rounded-lg px-3 py-[7px] text-left text-[13px] transition-colors",
                section === id ? "bg-selected text-fg" : "text-muted hover:bg-button hover:text-fg-2",
              )}
            >
              {label}
            </button>
          ))}
          <SaveNote saved={saved} />
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {section === "claude" && (
            <Page title="Claude" intro="The model that edits with you, on your own Claude plan.">
              <ClaudeSetup />
              <Row title="Model" hint="Opus makes the best edits; Sonnet answers sooner.">
                <Select
                  value={settings.model}
                  onChange={(model) => void update({ model })}
                  options={withCurrent(MODELS, settings.model)}
                />
              </Row>
              <div className="flex flex-col gap-2 border-t border-line pt-5">
                <EffortSlider value={settings.effort} onChange={(effort) => void update({ effort })} />
              </div>
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
                wide
              >
                <Segmented
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
                  wide
                >
                  <Segmented
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
              <p className="text-xs leading-relaxed text-faint">
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
    </Dialog>
  );
}

/** The STYLE.md new projects start with; each project's own is in its Style tab. */
function NewProjectStyle({ saved }: { saved: string }) {
  const { text, setText } = useStyleDraft(saved);
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-fg">Style for new projects</span>
        <span className="text-xs leading-relaxed text-muted">
          The STYLE.md every new project starts with: your taste in words, read before every edit. A project's
          own is in its Style tab.
        </span>
      </div>
      <PresetGrid text={text} onPick={setText} compact />
      <div className="rounded-xl border border-line-strong bg-raised px-4 py-3">
        <StyleText text={text} onChange={setText} className="h-[220px]" />
      </div>
    </div>
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
    <div className="flex flex-col gap-2 border-t border-line pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium">{name}</span>
          <span className="text-xs text-muted">{what}</span>
        </div>
        {source === "saved" ? (
          <span className="flex shrink-0 items-center gap-2 text-xs">
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
            className="shrink-0 text-xs text-accent hover:underline"
          >
            Get a free key
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
            className="h-[34px] w-full rounded-lg border border-line-strong bg-raised pr-9 pl-3 font-mono text-[12px] text-fg outline-none placeholder:font-sans placeholder:text-faint focus:border-edge"
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
        <Button size="sm" disabled={!typed.trim() || checking} onClick={() => void check()}>
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
      <div className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2.5 font-mono text-[12px] text-fg-2">
        <span>Cutroom {d.version}</span>
        <span className="text-muted">
          Electron {d.electron} · {d.os}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void host.app.openLogs()}>
          <FolderOpenIcon size={13} /> Open logs folder
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
          <CopyIcon size={13} /> Copy a report
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
          <CheckIcon size={12} className="text-ok" /> Saved
        </>
      )}
    </div>
  );
}
