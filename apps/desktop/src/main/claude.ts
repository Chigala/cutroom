/**
 * Claude Code, which the subscription backend runs: the user's own install first (signed in with their
 * own `claude auth login`, updated by Claude Code itself), the app's bundled copy only when there's no
 * usable install. Also installs it (Anthropic's installer), signs in and updates, reporting through
 * the `claude` event.
 *
 * The chosen path goes in VEDIT_CLAUDE_BIN, which the agent passes to the SDK (claudeExecutable).
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { type ClaudeAccount, probeClaude } from "@vedit/agent";
import type { ClaudeStatus, ClaudeTask } from "@vedit/bridge";
import { app } from "electron";
import { commandLine, openTerminal } from "./platform.ts";
import { getSettings } from "./settings.ts";

/** Older than this, the SDK's protocol isn't spoken (the oldest the SDK's users report working). */
const MINIMUM = "2.1.111";

/** VEDIT_CLAUDE_BIN given at launch: a developer's override, used as is. */
const override = process.env.VEDIT_CLAUDE_BIN;

const sdkDir = (() => {
  try {
    return path.dirname(createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"));
  } catch {
    return null;
  }
})();

/** The Claude Code version the SDK was built with. */
const RECOMMENDED = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(sdkDir!, "package.json"), "utf8"));
    return String(pkg.claudeCodeVersion ?? MINIMUM);
  } catch {
    return MINIMUM;
  }
})();

/** The app's own copy: beside the archive once packaged, the SDK's platform package in development. */
function bundled(): string | null {
  if (app.isPackaged) {
    const file = path.join(
      process.resourcesPath,
      "native",
      "claude-agent-sdk",
      process.platform === "win32" ? "claude.exe" : "claude",
    );
    return existsSync(file) ? file : null;
  }
  if (!sdkDir) return null;
  try {
    const pkg = createRequire(path.join(sdkDir, "package.json")).resolve(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
    );
    const file = path.join(path.dirname(pkg), process.platform === "win32" ? "claude.exe" : "claude");
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

const executable = (file: string) => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * PATH as the user's terminal has it. An app opened from the Dock gets a bare PATH, without
 * ~/.local/bin, Homebrew or nvm, where Claude Code is installed. Read once from a login shell, with
 * CLAUDE_CONFIG_DIR when the shell sets one: Claude Code signs in, in the terminal, wherever that says,
 * and the app has to look in the same place.
 */
let shellPath: Promise<string> | null = null;
function userPath(): Promise<string> {
  shellPath ??= new Promise((resolve) => {
    if (process.platform === "win32") return resolve(process.env.PATH ?? "");
    const shellBin = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    execFile(
      shellBin,
      [
        "-ilc",
        'printf "__VEDIT_PATH__%s__VEDIT_PATH__" "$PATH"; printf "__VEDIT_CFG__%s__VEDIT_CFG__" "$CLAUDE_CONFIG_DIR"',
      ],
      { timeout: 5000, encoding: "utf8", env: { ...process.env, DISABLE_AUTO_UPDATE: "true" } },
      (_err, stdout) => {
        const found = /__VEDIT_PATH__(.*?)__VEDIT_PATH__/s.exec(stdout ?? "")?.[1];
        const config = /__VEDIT_CFG__(.*?)__VEDIT_CFG__/s.exec(stdout ?? "")?.[1]?.trim();
        if (config && !process.env.CLAUDE_CONFIG_DIR) {
          process.env.CLAUDE_CONFIG_DIR = config;
          console.log(`[claude] Claude Code's settings are in ${config} (from your shell)`);
        }
        resolve([found, process.env.PATH].filter(Boolean).join(path.delimiter));
      },
    );
  });
  return shellPath;
}

/**
 * Who the user is, for Claude Code: it finds its saved sign-in in the keychain under the user's name
 * ($USER), and without it says "not signed in" even when it is. Set when the app was started without.
 */
function ensureUser(): void {
  try {
    const me = userInfo();
    process.env.USER ||= me.username;
    process.env.LOGNAME ||= me.username;
    process.env.HOME ||= me.homedir;
  } catch {
    // No user record (a container): Claude Code makes do.
  }
}

/** Where installers put it, in case the shell didn't say. */
const KNOWN = () =>
  process.platform === "win32"
    ? [
        // The native installer (install.ps1), and the older local install.
        path.join(homedir(), ".local", "bin", "claude.exe"),
        path.join(homedir(), ".claude", "local", "claude.exe"),
      ]
    : [
        path.join(homedir(), ".local", "bin", "claude"),
        path.join(homedir(), ".claude", "local", "claude"),
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
      ];

/** The user's own Claude Code: the first `claude` on their PATH, else one where installers put it. */
async function installed(): Promise<string | null> {
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  const dirs = (await userPath()).split(path.delimiter).filter(Boolean);
  const own = path.dirname(process.execPath);
  for (const file of [...dirs.map((d) => path.join(d, name)), ...KNOWN()]) {
    // Never our own copy, which can't be found on PATH anyway, but be sure.
    if (file.startsWith(own)) continue;
    if (existsSync(file) && executable(file)) return file;
  }
  return null;
}

function run(
  file: string,
  args: string[],
  timeout: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, encoding: "utf8", env: claudeEnv() }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
      resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

/** Claude Code's environment: the app's, with the user's PATH (it shells out to git and the like). */
function claudeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...(resolvedPath && { PATH: resolvedPath }) };
}
let resolvedPath: string | null = null;

async function version(file: string): Promise<string | null> {
  const out = await run(file, ["--version"], 15_000);
  return /(\d+\.\d+\.\d+)/.exec(out.stdout)?.[1] ?? null;
}

/** -1, 0 or 1, for dotted versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

const versionState = (v: string | undefined): ClaudeStatus["versionState"] =>
  !v
    ? "ok"
    : compareVersions(v, MINIMUM) < 0
      ? "unsupported"
      : compareVersions(v, RECOMMENDED) < 0
        ? "old"
        : "ok";

const PLANS: Record<string, string> = {
  max: "Claude Max",
  pro: "Claude Pro",
  team: "Claude Team",
  enterprise: "Claude Enterprise",
  free: "Claude Free",
};
const PROVIDERS: Record<string, string> = {
  bedrock: "Amazon Bedrock",
  vertex: "Google Vertex AI",
  foundry: "Microsoft Foundry",
  gateway: "your company's gateway",
};

/** The last sign-in check, so the log says when it changes (it runs every few seconds while waiting). */
let lastSeen = "";
function note(seen: string, level: "log" | "warn" = "log"): void {
  if (seen === lastSeen) return;
  lastSeen = seen;
  console[level](`[claude] ${seen}`);
}

/** Who Claude Code is signed in as (`claude auth status`, which reads its saved login, no request). */
async function signIn(file: string): Promise<Pick<ClaudeStatus, "signedIn" | "method" | "email" | "org">> {
  const out = await run(file, ["auth", "status", "--json"], 15_000);
  const result = await read(out);
  note(
    result.signedIn === null
      ? `sign-in check couldn't tell (exit ${out.code}): ${(out.stderr || out.stdout).trim().slice(0, 300) || "no output"}`
      : `sign-in check: ${result.signedIn ? `signed in${result.method ? ` (${result.method})` : ""}` : "not signed in"}`,
    result.signedIn === null ? "warn" : "log",
  );
  return result;
}

async function read(out: {
  stdout: string;
}): Promise<Pick<ClaudeStatus, "signedIn" | "method" | "email" | "org">> {
  try {
    const s = JSON.parse(out.stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      apiProvider?: string;
      subscriptionType?: string;
      email?: string;
      orgName?: string;
    };
    if (typeof s.loggedIn !== "boolean") return { signedIn: null };
    const third = s.apiProvider && PROVIDERS[s.apiProvider];
    const method =
      third ??
      (s.authMethod === "claude.ai"
        ? (PLANS[s.subscriptionType ?? ""] ?? "Claude subscription")
        : s.authMethod && s.authMethod !== "none"
          ? "API key"
          : undefined);
    return {
      signedIn: s.loggedIn || Boolean(third),
      ...(method && { method }),
      ...(s.email && { email: s.email }),
      ...(s.orgName && { org: s.orgName }),
    };
  } catch {
    // An old Claude Code without `auth status`: it can't say.
    return { signedIn: null };
  }
}

let cached: Promise<ClaudeStatus> | null = null;
/** A look under way: asks for a fresh one while it runs share it (each starts Claude Code). */
let looking: Promise<ClaudeStatus> | null = null;

/** Finds Claude Code, chooses one, and points the agent at it. Cached; `refresh` looks again. */
export function claudeStatus(refresh = false): Promise<ClaudeStatus> {
  if (looking) return looking;
  if (refresh || !cached) {
    looking = cached = look()
      .catch(() => ({ ...missing }))
      .finally(() => {
        looking = null;
      });
  }
  return cached;
}

const missing: ClaudeStatus = {
  source: "missing",
  recommended: RECOMMENDED,
  versionState: "ok",
  signedIn: null,
};

async function look(): Promise<ClaudeStatus> {
  ensureUser();
  resolvedPath = await userPath();
  const custom = override || (await getSettings()).claudePath.trim();
  const pick = async (): Promise<{
    source: ClaudeStatus["source"];
    file: string;
    v?: string;
    skipped?: ClaudeStatus["skipped"];
  } | null> => {
    if (custom) {
      const file = custom.replace(/^~(?=$|\/)/, homedir());
      return existsSync(file) ? { source: "custom", file, ...(await opt(version(file))) } : null;
    }
    const own = await installed();
    const ownVersion = own ? await version(own) : null;
    const copy = bundled();
    // The user's install, unless it's too old to run the agent and there's a copy that isn't.
    if (own && (!copy || !ownVersion || versionState(ownVersion) !== "unsupported"))
      return { source: "installed", file: own, ...(ownVersion && { v: ownVersion }) };
    if (copy)
      return {
        source: "bundled",
        file: copy,
        ...(await opt(version(copy))),
        ...(own && ownVersion && { skipped: { path: own, version: ownVersion } }),
      };
    return null;
  };
  const chosen = await pick();
  if (!chosen) {
    delete process.env.VEDIT_CLAUDE_BIN;
    return { ...missing, ...(custom && { path: custom }) };
  }
  process.env.VEDIT_CLAUDE_BIN = chosen.file;
  console.log(`[claude] using ${chosen.source} Claude Code ${chosen.v ?? "?"} at ${chosen.file}`);
  return {
    source: chosen.source,
    path: chosen.file,
    ...(chosen.v && { version: chosen.v }),
    recommended: RECOMMENDED,
    versionState: versionState(chosen.v),
    ...(chosen.skipped && { skipped: chosen.skipped }),
    ...(await account(chosen.file)),
  };
}

/** Where Claude Code's API key comes from, in words. */
function keySource(source: string): string {
  if (/^ANTHROPIC_/.test(source)) return `${source} (set on this computer)`;
  if (/login managed key|console/i.test(source)) return "an Anthropic Console sign-in (API billing)";
  if (/helper/i.test(source)) return "an API key helper in Claude Code's settings";
  return source;
}

/**
 * Who the agent will run as: Claude Code started the way the agent starts it reports its account
 * (probeClaude). A Claude plan is ready; an API key, which Claude Code uses ahead of any plan, isn't:
 * Cutroom runs on the plan. When Claude Code can't be started that way, `claude auth status` says.
 */
async function account(file: string): Promise<AccountStatus> {
  const a = await probeClaude();
  return a ? fromAccount(a) : signIn(file);
}

type AccountStatus = Pick<ClaudeStatus, "signedIn" | "method" | "email" | "org" | "apiKey" | "limits">;

/** What Claude Code's account means for the agent: a plan (ready), an API key (not, for Cutroom), or none. */
export function fromAccount(a: ClaudeAccount): AccountStatus {
  const provider =
    a.apiProvider && a.apiProvider !== "firstParty" ? (PROVIDERS[a.apiProvider] ?? a.apiProvider) : null;
  const who = { ...(a.email && { email: a.email }), ...(a.organization && { org: a.organization }) };
  if (a.apiKeySource && !provider) {
    note(
      `account: an API key, from ${a.apiKeySource}${a.subscriptionType ? ` (ahead of ${a.subscriptionType})` : ""}`,
      "warn",
    );
    return { signedIn: false, method: "API key", apiKey: keySource(a.apiKeySource), ...who };
  }
  if (provider) {
    note(`account: ${provider}`);
    return { signedIn: true, method: provider, ...who };
  }
  if (a.subscriptionType) {
    note(`account: ${a.subscriptionType}`);
    return { signedIn: true, method: a.subscriptionType, ...who, ...(a.limits && { limits: a.limits }) };
  }
  note("account: not signed in");
  return { signedIn: false };
}

const opt = async (v: Promise<string | null>) => {
  const s = await v;
  return s ? { v: s } : {};
};

// Install, sign in, update: one at a time, reported as it goes.

/** Terminal colour and cursor codes. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

let task: { child: ChildProcess; kind: ClaudeTask["kind"] } | null = null;
/** A sign-in being finished in a terminal, watched until Claude Code reports it. */
let watching: { stopped: boolean } | null = null;

export function claudeTasks(emit: (t: ClaudeTask) => void) {
  const start = async (kind: ClaudeTask["kind"], file: string, args: string[]) => {
    if (task) throw new Error("Claude Code is busy with something else. Wait for it, or cancel it.");
    const child = spawn(file, args, { env: claudeEnv(), stdio: ["pipe", "pipe", "pipe"] });
    task = { child, kind };
    let last = "";
    const onData = (buf: Buffer) => {
      // Without colours and cursor moves: the installer and the CLI draw for a terminal.
      const text = buf.toString("utf8").replace(ANSI, "");
      const lines = text
        .split(/\r|\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length) last = lines.at(-1)!;
      emit({ kind, state: "running", message: last.slice(0, 300) });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    emit({ kind, state: "running" });
    const finish = (ok: boolean, message?: string) => {
      if (task?.child !== child) return;
      task = null;
      void claudeStatus(true).then(() =>
        emit({ kind, state: ok ? "done" : "failed", ...(message && { message: message.slice(0, 300) }) }),
      );
    };
    child.on("error", (err) => finish(false, err.message));
    child.on("exit", (code, signal) => {
      if (code === 0) finish(true);
      else finish(false, signal ? "Cancelled." : last || `It stopped with code ${code}.`);
    });
  };

  return {
    install: () =>
      process.platform === "win32"
        ? start("install", "powershell.exe", [
            "-NoProfile",
            "-Command",
            "irm https://claude.ai/install.ps1 | iex",
          ])
        : // Anthropic's installer: Claude Code into ~/.local/bin, updated by itself from then on.
          start("install", "/bin/bash", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"]),
    /**
     * Signing in happens in a terminal the user sees, with Claude Code's own sign-in: the app never
     * handles the sign-in page, its code or the account's tokens. It only watches Claude Code's record of
     * who is signed in, and says so when that changes.
     */
    login: async () => {
      const s = await claudeStatus();
      if (!s.path) throw new Error("Install Claude Code first.");
      if (task || watching)
        throw new Error("Claude Code is busy with something else. Wait for it, or cancel it.");
      // Signing in to switch accounts waits for a different one; otherwise for a Claude plan to be ready.
      const before = s.signedIn === true ? (s.email ?? "signed in") : null;
      // The Claude plan, not the Console's API billing.
      const args = ["auth", "login", "--claudeai"];
      const opened = await openTerminal(s.path, args);
      emit({
        kind: "login",
        state: "running",
        message: opened
          ? "Finish signing in in the terminal window that opened."
          : "Open a terminal and run this to sign in:",
        ...(!opened && { command: commandLine(s.path, args) }),
      });
      const started = Date.now();
      const watch = { stopped: false };
      watching = watch;
      const tick = async () => {
        if (watch.stopped) return;
        const now = await claudeStatus(true).catch(() => null);
        if (watch.stopped) return;
        // Signed in now, or (switching account) as someone else.
        const done = now?.signedIn === true && (before === null || (now.email ?? "signed in") !== before);
        if (done || Date.now() - started > 15 * 60_000) {
          watching = null;
          if (!done) console.warn("[claude] stopped waiting for the sign-in after 15 minutes");
          emit(
            done
              ? { kind: "login", state: "done" }
              : { kind: "login", state: "failed", message: "Signing in didn't finish. Try again." },
          );
          return;
        }
        setTimeout(() => void tick(), 2000);
      };
      setTimeout(() => void tick(), 2000);
    },
    update: async () => {
      const s = await claudeStatus();
      // The user's own install, even one passed over for being too old; the app's copy updates with the app.
      const file = s.source === "bundled" ? s.skipped?.path : s.path;
      if (!file) throw new Error("Install Claude Code first.");
      await start("update", file, ["update"]);
    },
    cancel: async () => {
      // Stops watching a sign-in (the terminal is the user's to close); whatever it reached stands.
      if (watching) {
        watching.stopped = true;
        watching = null;
        const now = await claudeStatus(true);
        emit(
          now.signedIn === true
            ? { kind: "login", state: "done" }
            : { kind: "login", state: "failed", message: "Cancelled." },
        );
      }
      task?.child.kill("SIGTERM");
    },
  };
}
