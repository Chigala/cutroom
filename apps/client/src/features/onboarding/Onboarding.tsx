/**
 * The first launch: what Cutroom is, then the few things it needs, each with why. One idea per screen;
 * everything optional can be skipped and done later in Settings, and downloads carry on in the
 * background while you move on. Shown until it's finished or skipped (settings.onboarded), and again
 * from Settings → Advanced.
 */
import type { AgentStatus, KeyCheck, KeyProvider, Settings } from "@vedit/bridge";
import { clsx } from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Clapperboard,
  ExternalLink,
  Laugh,
  Loader2,
  Lock,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { host } from "../../lib/host.ts";
import { checkClaude, followClaude, useClaude } from "../../state/claude.ts";
import { followDownloads, size, useDownloads } from "../../state/downloads.ts";
import { saveSettings, useSettings } from "../../state/settings.ts";

const STEPS = ["welcome", "privacy", "claude", "captions", "extras", "ready"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding() {
  const settings = useSettings((s) => s.settings);
  const [at, setAt] = useState(0);
  const [keys, setKeys] = useState<AgentStatus["keys"]>();
  useEffect(() => {
    followClaude();
    followDownloads();
    void checkClaude(true);
    void host.agent.status().then((s) => setKeys(s.keys));
  }, []);
  if (!settings) return null;
  const step: Step = STEPS[at]!;
  const next = () => {
    // Leaving the captions screen starts its download, so it's ready by the first import.
    if (step === "captions") void host.downloads.prepare("transcription");
    setAt((i) => Math.min(STEPS.length - 1, i + 1));
  };
  const back = () => setAt((i) => Math.max(0, i - 1));
  const finish = () => {
    // Off macOS, the open models (faces, sounds, cutouts) start now too; on a Mac this does nothing.
    void host.downloads.prepare("models");
    void saveSettings({ onboarded: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="drag-region flex h-[52px] shrink-0 items-center justify-center gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={clsx(
              "h-1 rounded-full transition-all duration-500",
              i === at ? "w-6 bg-fg" : i < at ? "w-3 bg-fg-3/60" : "w-3 bg-line-strong",
            )}
          />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto px-10 py-6">
        <div
          key={step}
          // m-auto centres the screen when it fits, and lets it scroll from the top when it doesn't.
          className="ob-rise m-auto grid w-full max-w-[980px] grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-center gap-14"
        >
          {step === "welcome" && <Welcome />}
          {step === "privacy" && <Privacy />}
          {step === "claude" && <ClaudeStep />}
          {step === "captions" && <Captions settings={settings} keys={keys} />}
          {step === "extras" && <Extras keys={keys} />}
          {step === "ready" && <Ready settings={settings} />}
        </div>
      </div>
      <div className="flex h-[72px] shrink-0 items-center justify-between border-t border-line px-10">
        <button
          type="button"
          onClick={finish}
          className="text-[13px] text-faint transition-colors hover:text-fg-2"
        >
          {step === "ready" ? "" : "Skip setup"}
        </button>
        <div className="flex items-center gap-2">
          {at > 0 && (
            <button
              type="button"
              onClick={back}
              className="flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] text-fg-2 transition-colors hover:bg-button"
            >
              <ArrowLeft size={15} /> Back
            </button>
          )}
          <button
            type="button"
            onClick={step === "ready" ? finish : next}
            className="flex h-10 items-center gap-1.5 rounded-full bg-fg px-5 text-[13px] font-medium text-bg transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {step === "welcome" ? "Get started" : step === "ready" ? "Start editing" : "Continue"}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The title side of a screen. */
function Copy({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">{eyebrow}</span>
      <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-fg">{title}</h1>
      {children}
    </div>
  );
}

const Lead = ({ children }: { children: ReactNode }) => (
  <p className="text-[15px] leading-[1.6] text-muted">{children}</p>
);

/** The visual side: a quiet stage the illustration or demo sits on. */
function Stage({ children, tall }: { children: ReactNode; tall?: boolean }) {
  return (
    <div
      className={clsx(
        "relative flex items-center justify-center overflow-hidden rounded-[28px] border border-line bg-panel",
        tall ? "aspect-[4/5]" : "aspect-[5/4]",
      )}
    >
      {children}
    </div>
  );
}

/** The app's mark: two clips on a timeline, the playhead arriving on the cut, then reviewing it. */
function PlayheadMark() {
  return (
    <svg viewBox="0 0 100 100" className="h-[46%] w-[46%]" role="img" aria-label="Cutroom">
      <rect width="100" height="100" rx="22.5" fill="#16161A" />
      <g className="ob-clip-left">
        <rect x="13" y="41" width="31" height="20" rx="4.5" fill="#FFFFFF" />
      </g>
      <g className="ob-clip-right">
        <rect x="56" y="41" width="31" height="20" rx="4.5" fill="#55555E" />
      </g>
      <g className="ob-playhead">
        <g className="ob-sweep" style={{ transformBox: "view-box" }}>
          <rect x="48.25" y="29" width="3.5" height="46" rx="1.75" fill="#FF6A1F" />
          <path
            d="M44 22.5 H56 V28 L50 33.5 L44 28 Z"
            fill="#FF6A1F"
            stroke="#FF6A1F"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}

function Welcome() {
  return (
    <>
      <Copy eyebrow="Welcome to Cutroom" title="You direct. The agent edits.">
        <Lead>
          Drop in your footage and Cutroom understands it: every word said, every shot, every beat. Then just
          say what you want. It makes the cut, the captions, the graphics and the sound, and every change is
          one you can keep or undo.
        </Lead>
        <Lead>Setup takes a minute or two. Anything optional can wait.</Lead>
      </Copy>
      <Stage>
        <PlayheadMark />
      </Stage>
    </>
  );
}

function Privacy() {
  return (
    <>
      <Copy eyebrow="Private by design" title="Your footage stays on your computer.">
        <Lead>
          Cutting, transcribing, tracking and exporting all happen here. Projects are ordinary folders of
          plain files you own.
        </Lead>
        <Lead>
          To edit, Claude reads what it needs to decide: the words that are said and a few frames. Your video
          files themselves never leave this computer.
        </Lead>
      </Copy>
      <Stage>
        <div className="flex flex-col items-center gap-5">
          <div className="flex size-24 items-center justify-center rounded-[26px] bg-raised">
            <Lock size={40} strokeWidth={1.5} className="text-fg-2" />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-[13px] text-muted">
            <span>Footage · on this computer</span>
            <span>Words and a few frames · to Claude</span>
          </div>
        </div>
      </Stage>
    </>
  );
}

function ClaudeStep() {
  const status = useClaude((s) => s.status);
  const task = useClaude((s) => s.task);
  const installed = status ? status.source !== "missing" : null;
  const signedIn = status?.signedIn === true;
  const busy = task?.state === "running";
  const act = (fn: () => Promise<void>) => () => void fn().catch(() => {});
  return (
    <>
      <Copy eyebrow="The editor's brain" title="Cutroom edits with Claude.">
        <Lead>
          Claude watches your footage through the transcript and frames, makes the cuts and the creative
          calls, and checks its own work. It runs on your own Claude plan, through Claude Code.
        </Lead>
        <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
          <StatusRow done={installed === true} label="Claude Code installed" />
          <StatusRow
            done={signedIn}
            label={signedIn && status?.email ? `Signed in as ${status.email}` : "Signed in"}
          />
          {busy && (
            <span className="flex items-center gap-2 text-[13px] text-fg-2">
              <Loader2 size={14} className="animate-spin text-muted" />
              {task?.message ?? "Working on it…"}
            </span>
          )}
          {task?.command && (
            <code className="select-all rounded-lg bg-sunken px-3 py-2 font-mono text-xs text-fg">
              {task.command}
            </code>
          )}
          {!busy && installed === false && (
            <Pill onClick={act(host.claude.install)}>Install Claude Code</Pill>
          )}
          {!busy && installed && !signedIn && <Pill onClick={act(host.claude.login)}>Sign in</Pill>}
          {task?.state === "failed" && !busy && (
            <span className="text-xs text-bad">Didn't finish{task.message ? `: ${task.message}` : "."}</span>
          )}
        </div>
        <span className="text-xs leading-relaxed text-faint">
          Signing in opens a terminal with Claude Code's own sign-in, and finishes in your browser. Cutroom
          never sees your password or tokens. You'll need a paid Claude plan (Pro or Max).
        </span>
      </Copy>
      <Stage>
        <div className="flex w-[78%] flex-col overflow-hidden rounded-2xl border border-line-strong bg-sunken shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <TerminalSquare size={13} className="ml-2 text-faint" />
          </div>
          <div className="flex flex-col gap-2 p-5 font-mono text-[12px] leading-relaxed">
            <span className="text-fg-2">
              <span className="text-faint">$</span> claude auth login
            </span>
            <span className="text-muted">Opening your browser to sign in…</span>
            <span className={clsx("transition-colors", signedIn ? "text-ok" : "text-faint")}>
              {signedIn ? "✓ Signed in. You can close this window." : "Waiting for you to sign in…"}
            </span>
          </div>
        </div>
      </Stage>
    </>
  );
}

function StatusRow({ done, label }: { done: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2.5 text-[13px]">
      <span
        className={clsx(
          "flex size-5 items-center justify-center rounded-full transition-colors duration-300",
          done ? "bg-ok text-bg" : "border border-line-strong",
        )}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </span>
      <span className={done ? "text-fg" : "text-muted"}>{label}</span>
    </span>
  );
}

function Pill({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg transition-transform hover:scale-[1.02] active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

type Transcriber = "best" | "light" | "instant";

const TRANSCRIBERS: readonly {
  id: Transcriber;
  name: string;
  size: string;
  line: string;
  patch: Partial<Settings>;
}[] = [
  {
    id: "best",
    name: "Best",
    size: "1.6 GB, once",
    line: "The most accurate, on this computer. Holds up on streams, music and slang.",
    patch: { transcriber: "local", whisperModel: "large-v3-turbo" },
  },
  {
    id: "light",
    name: "Light",
    size: "574 MB, once",
    line: "A third of the size. The same words on clean speech, a few slips on noisy audio.",
    patch: { transcriber: "local", whisperModel: "large-v3-turbo-light" },
  },
  {
    id: "instant",
    name: "Instant",
    size: "Nothing to download",
    line: "The best model, in Groq's cloud: seconds per clip. Needs a free Groq key; the audio is sent to Groq.",
    patch: { transcriber: "groq" },
  },
];

function Captions({ settings, keys }: { settings: Settings; keys: AgentStatus["keys"] }) {
  const chosen: Transcriber =
    settings.transcriber === "groq"
      ? "instant"
      : settings.whisperModel === "large-v3-turbo-light"
        ? "light"
        : "best";
  return (
    <>
      <Copy eyebrow="Captions you can trust" title="Choose how Cutroom hears your videos.">
        <Lead>
          Every word said becomes captions, cut points and something the agent can read. Pick what suits your
          computer; you can change it any time in Settings.
        </Lead>
        <div className="mt-1 flex flex-col gap-2">
          {TRANSCRIBERS.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => void saveSettings(t.patch)}
              className={clsx(
                "flex flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors",
                chosen === t.id
                  ? "border-fg/70 bg-raised"
                  : "border-line hover:border-line-strong hover:bg-panel",
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium text-fg">
                  {t.name}
                  {t.id === "best" && (
                    <span className="ml-2 text-xs font-normal text-accent">Recommended</span>
                  )}
                </span>
                <span className="text-xs text-faint">{t.size}</span>
              </span>
              <span className="text-[13px] leading-snug text-muted">{t.line}</span>
            </button>
          ))}
        </div>
        {chosen === "instant" && <KeyPanel provider="groq" source={keys?.groq ?? null} />}
      </Copy>
      <Stage tall>
        <CaptionsDemo chosen={chosen} />
      </Stage>
    </>
  );
}

/** The difference, shown: what each heard on the same noisy stream clip, and how fast. */
function CaptionsDemo({ chosen }: { chosen: Transcriber }) {
  const downloads = useDownloads((s) => s.list);
  const speech = downloads.find((d) => d.id.startsWith("whisper:"));
  const lines: Record<Transcriber, { heard: ReactNode; note: string }> = {
    best: { heard: <>…spam W…</>, note: "Got the stream slang right" },
    light: {
      heard: (
        <>
          …<span className="rounded bg-bad/20 px-1 text-bad">SMW</span>…
        </>
      ),
      note: "Slipped on it",
    },
    instant: { heard: <>…spam W…</>, note: "Same model as Best, in seconds" },
  };
  return (
    <div className="flex w-[82%] flex-col gap-5">
      <span className="text-xs uppercase tracking-[0.14em] text-faint">
        The same moment of a noisy livestream
      </span>
      {(["best", "light", "instant"] as const).map((t) => (
        <div
          key={t}
          className={clsx(
            "flex flex-col gap-1.5 rounded-2xl px-5 py-4 transition-all duration-500",
            t === chosen ? "bg-raised opacity-100" : "opacity-40",
          )}
        >
          <span className="text-xs text-muted">{TRANSCRIBERS.find((x) => x.id === t)!.name}</span>
          <span className="text-[17px] font-medium text-fg">“{lines[t].heard}”</span>
          <span className="text-xs text-faint">{lines[t].note}</span>
        </div>
      ))}
      {speech && speech.state !== "done" && (
        <Progress
          label={speech.label}
          fraction={speech.fraction}
          bytes={speech.bytes}
          failed={speech.state === "failed"}
        />
      )}
    </div>
  );
}

function Progress({
  label,
  fraction,
  bytes,
  failed,
}: {
  label: string;
  fraction: number;
  bytes: number;
  failed: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex justify-between text-xs text-muted">
        <span>{failed ? `${label}: download failed` : `Downloading ${label.toLowerCase()}`}</span>
        <span>
          {Math.round(fraction * 100)}% of {size(bytes)}
        </span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-line">
        <span
          className={clsx(
            "block h-full rounded-full transition-[width] duration-500",
            failed ? "bg-bad" : "bg-fg",
          )}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </span>
    </div>
  );
}

/** A free service the agent can use, and how to get its key. */
interface Extra {
  readonly id: "stock" | "memes" | "sounds";
  readonly icon: ReactNode;
  readonly title: string;
  readonly why: string;
  readonly demo: string;
  readonly providers: readonly Provider[];
}

interface Provider {
  readonly id: KeyProvider;
  readonly name: string;
  readonly site: string;
  readonly siteLabel: string;
  readonly note?: string;
  readonly steps: readonly ReactNode[];
  /** Shown folded behind "Already have a … key?" (Pexels: it isn't giving out new keys). */
  readonly folded?: boolean;
}

const EXTRAS: readonly Extra[] = [
  {
    id: "stock",
    icon: <Clapperboard size={18} strokeWidth={1.6} />,
    title: "Stock footage",
    why: "B-roll that shows what you're saying: the city you mention, the product, the moment.",
    demo: "stock",
    providers: [
      {
        id: "pexels",
        name: "Pexels",
        site: "https://www.pexels.com/api/",
        siteLabel: "pexels.com/api",
        note: "Free; the key is issued straight away. If Pexels shows a notice that keys are paused, Pixabay below works just as well.",
        steps: [
          <>
            Open the Pexels API page and click <b>Get Started</b>.
          </>,
          <>Sign up or log in, with Google or your email.</>,
          <>Your API key appears straight away: copy it.</>,
          <>Paste it below.</>,
        ],
      },
      {
        id: "pixabay",
        name: "Pixabay",
        site: "https://pixabay.com/api/docs/",
        siteLabel: "pixabay.com/api/docs",
        note: "Also free and instant. One of the two is enough; both gives the agent more to choose from.",
        steps: [
          <>
            Open the Pixabay API page and click <b>Sign up</b> (or log in).
          </>,
          <>Join with Google, Facebook or your email.</>,
          <>
            Back on the API page, your key is in the <b>key (required)</b> row.
          </>,
          <>Copy it and paste it below.</>,
        ],
      },
    ],
  },
  {
    id: "memes",
    icon: <Laugh size={18} strokeWidth={1.6} />,
    title: "Memes and reactions",
    why: "The reaction GIF, the sticker, the meme that lands the joke, found by the agent at the right beat.",
    demo: "memes",
    providers: [
      {
        id: "klipy",
        name: "KLIPY",
        site: "https://partner.klipy.com/",
        siteLabel: "partner.klipy.com",
        note: "Free; test keys allow 100 searches an hour.",
        steps: [
          <>Open KLIPY's partner page and sign up with Google, Apple or your email.</>,
          <>
            Open <b>API Keys</b>.
          </>,
          <>
            Click <b>Add Platform</b> and name it, e.g. “Cutroom on my computer”.
          </>,
          <>Copy the key and paste it below.</>,
        ],
      },
    ],
  },
  {
    id: "sounds",
    icon: <AudioLines size={18} strokeWidth={1.6} />,
    title: "Sound effects",
    why: "The whoosh on a transition, the boom on a reveal, the ding on a number: sound design that makes it feel finished.",
    demo: "sounds",
    providers: [
      {
        id: "freesound",
        name: "Freesound",
        site: "https://freesound.org/apiv2/apply/",
        siteLabel: "freesound.org/apiv2/apply",
        note: "Free and instant once your account is confirmed.",
        steps: [
          <>Join freesound.org and confirm your email.</>,
          <>
            Open the API page and fill in <b>Create new API credentials</b>: name “Cutroom”, description
            “Sound effects for my own videos”.
          </>,
          <>
            Accept the terms and click <b>Request new access credentials</b>.
          </>,
          <>
            Copy the <b>Client secret/Api key</b> (not the Client id) and paste it below.
          </>,
        ],
      },
    ],
  },
];

function Extras({ keys }: { keys: AgentStatus["keys"] }) {
  const [open, setOpen] = useState<Extra["id"]>("stock");
  const extra = EXTRAS.find((e) => e.id === open)!;
  return (
    <>
      <Copy eyebrow="Optional power-ups" title="Give the agent more to work with.">
        <Lead>
          Three free services let the agent find footage, memes and sound effects on its own. Each takes a
          free key from its website. Skip any of them: your own library always works, and keys can be added
          later in Settings → Media sources.
        </Lead>
        <div className="mt-1 flex flex-col gap-2">
          {EXTRAS.map((e) => {
            const added = e.providers.some((p) => keys?.[p.id]);
            return (
              <div
                key={e.id}
                className={clsx(
                  "flex flex-col rounded-2xl border transition-colors",
                  open === e.id ? "border-line-strong bg-panel" : "border-line",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(e.id)}
                  className="flex items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="text-fg-2">{e.icon}</span>
                  <span className="flex-1 text-[14px] font-medium text-fg">{e.title}</span>
                  {added ? (
                    <span className="flex items-center gap-1 text-xs text-ok">
                      <Check size={12} /> Added
                    </span>
                  ) : (
                    <span className="text-xs text-faint">Optional</span>
                  )}
                  <ChevronDown
                    size={15}
                    className={clsx("text-faint transition-transform", open === e.id && "rotate-180")}
                  />
                </button>
                {open === e.id && (
                  <div className="flex flex-col gap-4 px-4 pb-4 animate-fade-in">
                    <span className="text-[13px] leading-snug text-muted">{e.why}</span>
                    {e.providers.map((p) =>
                      p.folded ? (
                        <Folded key={p.id} provider={p} source={keys?.[p.id] ?? null} />
                      ) : (
                        <ProviderSteps key={p.id} provider={p} source={keys?.[p.id] ?? null} />
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Copy>
      {/* Stays in view while the steps scroll beside it. */}
      <div className="sticky top-0 self-start">
        <Stage tall>
          {/* One per power-up, so switching starts it fresh. */}
          <Demo key={extra.demo} name={extra.demo} title={extra.title} />
        </Stage>
      </div>
    </>
  );
}

/** A provider most people won't need, one line until it's opened (open already when its key is set). */
function Folded({ provider, source }: { provider: Provider; source: "saved" | "env" | null }) {
  const [open, setOpen] = useState(Boolean(source));
  if (open) return <ProviderSteps provider={provider} source={source} />;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="self-start text-xs text-faint transition-colors hover:text-fg-2"
    >
      Already have a {provider.name} key?
    </button>
  );
}

function ProviderSteps({ provider, source }: { provider: Provider; source: "saved" | "env" | null }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-fg-2">{provider.name}</span>
        <a
          href={provider.site}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-accent hover:underline"
        >
          {provider.siteLabel} <ExternalLink size={11} />
        </a>
      </span>
      {provider.note && <span className="text-xs text-faint">{provider.note}</span>}
      <ol className="flex flex-col gap-1.5 text-[13px] leading-snug text-muted [&_b]:font-medium [&_b]:text-fg-2">
        {provider.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-raised text-[11px] text-fg-2">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <KeyPanel provider={provider.id} source={source} />
    </div>
  );
}

const KEY_FIELD: Record<KeyProvider, keyof Settings> = {
  pixabay: "pixabayKey",
  pexels: "pexelsKey",
  klipy: "klipyKey",
  freesound: "freesoundKey",
  groq: "groqKey",
};

const CHECKED: Record<KeyCheck, string> = {
  ok: "Works. Saved.",
  invalid: "That key didn't work. Check you copied all of it.",
  limited: "It works, but it's over its limit right now. Saved anyway.",
  offline: "Couldn't reach the service to check it. Saved; it'll be tried when it's used.",
};

/** A key field that tries the key with its service, and saves it when it works. */
function KeyPanel({ provider, source }: { provider: KeyProvider; source: "saved" | "env" | null }) {
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<KeyCheck | null>(null);
  const check = async () => {
    if (!typed.trim()) return;
    setChecking(true);
    const r = await host.settings.checkKey(provider, typed.trim());
    setChecking(false);
    setResult(r);
    if (r !== "invalid") await saveSettings({ [KEY_FIELD[provider]]: typed.trim() } as Partial<Settings>);
  };
  if (source && result === null)
    return (
      <span className="flex items-center gap-1.5 text-xs text-ok">
        <Check size={12} /> {source === "env" ? "Already set (from .env)" : "Already added"}
      </span>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <input
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void check();
          }}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your key"
          aria-label={`${provider} API key`}
          className="min-w-0 flex-1 rounded-xl border border-line-strong bg-sunken px-3 py-2 font-mono text-xs text-fg outline-none transition-colors focus:border-fg/50"
        />
        <button
          type="button"
          disabled={!typed.trim() || checking}
          onClick={() => void check()}
          className="flex min-w-[72px] items-center justify-center rounded-xl bg-button px-3 text-xs font-medium text-fg-2 transition-colors hover:bg-control disabled:opacity-40"
        >
          {checking ? <Loader2 size={13} className="animate-spin" /> : "Check"}
        </button>
      </div>
      {result && (
        <span
          className={clsx(
            "text-xs",
            result === "invalid" ? "text-bad" : result === "ok" ? "text-ok" : "text-muted",
          )}
        >
          {CHECKED[result]}
        </span>
      )}
    </div>
  );
}

/** The same edit without and with what a power-up adds, side by side as a toggle. */
function Demo({ name, title }: { name: string; title: string }) {
  const [withIt, setWithIt] = useState(true);
  const [missing, setMissing] = useState(false);
  const src = `onboarding/${name}-${withIt ? "with" : "without"}.mp4`;
  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1 bg-sunken">
        {missing ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-faint">
            <Sparkles size={28} strokeWidth={1.4} />
            <span className="text-xs">{title}</span>
          </div>
        ) : (
          <video
            key={src}
            src={src}
            autoPlay
            loop
            // The meme and the sound effects are heard: their sound is the point.
            muted={name === "stock"}
            playsInline
            onError={() => setMissing(true)}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex justify-center gap-1 p-3">
        {(["without", "with"] as const).map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setWithIt(k === "with")}
            className={clsx(
              "rounded-full px-4 py-1.5 text-xs transition-colors",
              (k === "with") === withIt ? "bg-fg text-bg" : "text-muted hover:text-fg-2",
            )}
          >
            {k === "with" ? `With ${title.toLowerCase()}` : "Without"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Ready({ settings }: { settings: Settings }) {
  const status = useClaude((s) => s.status);
  const downloads = useDownloads((s) => s.list);
  const running = downloads.filter((d) => d.state === "running");
  const transcriber =
    settings.transcriber === "groq"
      ? "Instant (Groq)"
      : settings.whisperModel === "large-v3-turbo-light"
        ? "Light"
        : "Best";
  return (
    <>
      <Copy eyebrow="All set" title="Drop in your first clips.">
        <Lead>
          Make a project, drop your footage in, and Cutroom indexes it and makes a first cut on its own. Then
          tell it what you want changed.
        </Lead>
        <div className="mt-1 flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
          <StatusRow
            done={status?.signedIn === true}
            label={status?.signedIn ? "Claude is ready" : "Claude: sign in from Settings"}
          />
          <StatusRow done label={`Transcription: ${transcriber}`} />
          {running.map((d) => (
            <Progress key={d.id} label={d.label} fraction={d.fraction} bytes={d.bytes} failed={false} />
          ))}
        </div>
        {running.length > 0 && (
          <span className="text-xs text-faint">
            Downloads keep going in the background; you can start now.
          </span>
        )}
      </Copy>
      <Stage>
        <PlayheadMark />
      </Stage>
    </>
  );
}
