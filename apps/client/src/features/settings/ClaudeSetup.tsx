/**
 * Settings → Claude: the Claude Code the agent runs on. Shows whether it's installed, which version and
 * who it's signed in as, with the one button that fixes what's missing: Install, Sign in or Update.
 * The login is the user's own Claude Code login, so signing in here signs in Claude Code too.
 */
import type { ClaudeStatus, ClaudeTask } from "@vedit/bridge";
import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui.tsx";
import { host } from "../../lib/host.ts";
import { checkClaude, followClaude, useClaude } from "../../state/claude.ts";
import { toast } from "../../state/toast.ts";

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

const WHERE: Record<ClaudeStatus["source"], string> = {
  installed: "your install",
  custom: "the path in Settings",
  bundled: "the app's own copy",
  missing: "",
};

const DOING: Record<ClaudeTask["kind"], string> = {
  install: "Installing Claude Code…",
  login: "Signing in…",
  update: "Updating Claude Code…",
};

/** Starts a task; a refusal (busy, nothing installed) shows as a toast. */
const act = (fn: () => Promise<void>) => () =>
  void fn().catch((err: Error) =>
    toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "warn"),
  );

export function ClaudeSetup({ usingApiKey }: { usingApiKey: boolean }) {
  const { status, task, checking } = useClaude();
  useEffect(() => {
    followClaude();
    void checkClaude();
  }, []);
  const running = task?.state === "running";

  if (!status) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-[13px] text-muted">
        <Loader2 size={14} className="animate-spin" /> Looking for Claude Code…
      </div>
    );
  }

  const missing = status.source === "missing";
  const ok = !missing && status.signedIn === true && status.versionState !== "unsupported";
  const headline = missing
    ? status.path
      ? `No Claude Code at ${home(status.path)}`
      : "Claude Code isn't installed"
    : status.signedIn === true
      ? `Signed in${status.email ? ` as ${status.email}` : ""}`
      : status.signedIn === false
        ? "Claude Code isn't signed in"
        : "Couldn't tell if Claude Code is signed in";
  const updatable = !missing && status.source !== "bundled" && status.versionState !== "ok";

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        {ok ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" />
        ) : (
          <AlertTriangle
            size={16}
            className={clsx("mt-0.5 shrink-0", usingApiKey ? "text-muted" : "text-accent")}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] text-fg">
            {headline}
            {status.method && status.signedIn && <span className="text-muted"> · {status.method}</span>}
          </span>
          {!missing && (
            <span className="truncate text-xs text-muted" title={status.path}>
              Claude Code {status.version ?? "(unknown version)"} · {WHERE[status.source]}
              {status.source !== "bundled" && status.path && ` (${home(status.path)})`}
            </span>
          )}
          {missing && (
            <span className="text-xs text-muted">
              The agent runs on Claude Code, with your Claude subscription. Installing it takes a minute.
            </span>
          )}
          {status.versionState === "unsupported" && (
            <span className="text-xs text-bad">
              This version is too old for the editor's agent. Update it.
            </span>
          )}
          {status.versionState === "old" && (
            <span className="text-xs text-muted">
              Version {status.recommended} or newer has the latest models.
            </span>
          )}
          {status.skipped && (
            <span className="text-xs text-muted">
              Your Claude Code {status.skipped.version} ({home(status.skipped.path)}) is too old, so the app's
              own copy is used. Update it to use yours.
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Check again"
          title="Check again"
          disabled={checking || running}
          onClick={() => void checkClaude(true)}
          className="shrink-0 rounded-md p-1 text-faint hover:bg-button hover:text-fg-2 disabled:opacity-40"
        >
          <RotateCw size={13} className={checking ? "animate-spin" : ""} />
        </button>
      </div>

      {running ? (
        <TaskProgress task={task} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {missing && (
            <Button size="sm" variant="accent" onClick={act(host.claude.install)}>
              Install Claude Code
            </Button>
          )}
          {!missing && status.signedIn !== true && (
            <Button size="sm" variant="accent" onClick={act(host.claude.login)}>
              Sign in
            </Button>
          )}
          {(updatable || status.skipped) && (
            <Button size="sm" onClick={act(host.claude.update)}>
              Update Claude Code
            </Button>
          )}
          {!missing && status.signedIn === true && (
            <Button size="sm" variant="ghost" onClick={act(host.claude.login)}>
              Switch account
            </Button>
          )}
        </div>
      )}
      {task?.state === "failed" && !running && (
        <span className="text-xs text-bad">
          {task.kind === "install" ? "Install" : task.kind === "login" ? "Sign-in" : "Update"} didn't finish
          {task.message ? `: ${task.message}` : "."}
        </span>
      )}
    </div>
  );
}

function TaskProgress({ task }: { task: ClaudeTask }) {
  const [code, setCode] = useState("");
  const send = () => {
    if (!code.trim()) return;
    void host.claude.code(code.trim()).catch((err: Error) => toast(err.message, "warn"));
    setCode("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-fg-2">
        <Loader2 size={13} className="shrink-0 animate-spin text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {task.kind === "login" ? "Finish signing in in your browser." : (task.message ?? DOING[task.kind])}
        </span>
        <button
          type="button"
          onClick={() => void host.claude.cancel()}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-faint hover:bg-button hover:text-fg-2"
        >
          Cancel
        </button>
      </div>
      {task.kind === "login" && task.url && (
        <span className="text-xs text-muted">
          Browser didn't open?{" "}
          <a href={task.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Open the sign-in page
          </a>
        </span>
      )}
      {task.kind === "login" && task.needsCode && (
        <div className="flex gap-1.5">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") send();
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the code the page shows"
            aria-label="Sign-in code"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-edge"
          />
          <Button size="sm" variant="accent" disabled={!code.trim()} onClick={send}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
