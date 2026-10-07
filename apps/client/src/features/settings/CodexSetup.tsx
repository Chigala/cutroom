/**
 * Settings → Agent, for Codex: whether it's installed (the Codex app, or its CLI), who it's signed in as,
 * with the one button that fixes what's missing. Cutroom keeps its own Codex sign-in: signing in here
 * doesn't change the Codex app's, or the CLI's.
 */
import { ArrowClockwiseIcon, CheckCircleIcon, CircleNotchIcon, WarningIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { useEffect } from "react";
import { Button } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { checkCodex, signInCodex, signOutCodex, useCodex } from "../../state/codex.ts";

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^C:\\Users\\[^\\]+/i, "~");

export function CodexSetup() {
  const { status, checking, signingIn } = useCodex();
  useEffect(() => {
    void checkCodex();
  }, []);

  if (!status)
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-sunken/70 px-4 py-3.5 text-[13.5px] text-muted">
        <CircleNotchIcon size={14} className="animate-spin" /> Looking for Codex…
      </div>
    );

  const ok = status.installed && status.signedIn === true;
  const headline = !status.installed
    ? "Codex isn't installed"
    : status.signedIn === true
      ? `Signed in${status.email ? ` as ${status.email}` : ""}`
      : status.signedIn === false
        ? "Codex isn't signed in"
        : "Couldn't tell if Codex is signed in";

  return (
    <div className="flex flex-col gap-3.5 rounded-xl bg-sunken/70 px-4 py-4">
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            ok ? "bg-ok/12 text-ok" : "bg-accent/12 text-accent",
          )}
        >
          {ok ? <CheckCircleIcon size={17} weight="fill" /> : <WarningIcon size={17} weight="fill" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-px">
          <span className="truncate text-[14px] font-medium text-fg">
            {headline}
            {status.plan && status.signedIn && <span className="text-muted"> · ChatGPT {status.plan}</span>}
            {status.method && status.signedIn && <span className="text-muted"> · {status.method}</span>}
          </span>
          {status.installed ? (
            <span className="truncate text-[13px] text-muted" title={status.path}>
              Codex {status.version ?? "(unknown version)"}
              {status.path && ` (${home(status.path)})`}
            </span>
          ) : (
            <span className="text-[13px] leading-relaxed text-muted">
              The agent can run on Codex, with your ChatGPT plan. Install the Codex app (or the Codex CLI),
              then check again.
            </span>
          )}
          {status.installed && status.signedIn !== true && (
            <span className="text-xs leading-relaxed text-muted">
              Cutroom keeps its own Codex sign-in, apart from the Codex app's: your Codex settings and tools
              stay out of the editor.
            </span>
          )}
          {status.error && <span className="text-xs text-bad">{status.error}</span>}
        </div>
        <button
          type="button"
          aria-label="Check again"
          title="Check again"
          disabled={checking || signingIn}
          onClick={() => void checkCodex(true)}
          className="shrink-0 rounded-md p-1 text-faint hover:bg-button hover:text-fg-2 disabled:opacity-40"
        >
          <ArrowClockwiseIcon size={13} className={checking ? "animate-spin" : ""} />
        </button>
      </div>
      {signingIn ? (
        <div className="flex items-center gap-2.5 text-[13px] text-muted">
          <CircleNotchIcon size={14} className="animate-spin" /> Finish signing in in your browser…
          <Button size="sm" onClick={() => void host.codex.cancelLogin()}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {!status.installed && (
            <Button
              size="sm"
              variant="accent"
              onClick={() => window.open("https://chatgpt.com/codex", "_blank")}
            >
              Get Codex
            </Button>
          )}
          {status.installed && status.signedIn !== true && (
            <Button size="sm" variant="accent" onClick={() => void signInCodex()}>
              Sign in with ChatGPT
            </Button>
          )}
          {status.installed && status.signedIn === true && (
            <Button size="sm" onClick={() => void signOutCodex()}>
              Sign out
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
