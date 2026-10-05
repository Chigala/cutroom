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
import { homedir } from "node:os";
import path from "node:path";
import type { ClaudeStatus, ClaudeTask } from "@vedit/bridge";
import { app } from "electron";
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
 * ~/.local/bin, Homebrew or nvm, where Claude Code is installed. Read once from a login shell.
 */
let shellPath: Promise<string> | null = null;
function userPath(): Promise<string> {
  shellPath ??= new Promise((resolve) => {
    if (process.platform === "win32") return resolve(process.env.PATH ?? "");
    const shellBin = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    execFile(
      shellBin,
      ["-ilc", 'printf "__VEDIT_PATH__%s__VEDIT_PATH__" "$PATH"'],
      { timeout: 5000, encoding: "utf8", env: { ...process.env, DISABLE_AUTO_UPDATE: "true" } },
      (_err, stdout) => {
        const found = /__VEDIT_PATH__(.*?)__VEDIT_PATH__/s.exec(stdout ?? "")?.[1];
        resolve([found, process.env.PATH].filter(Boolean).join(path.delimiter));
      },
    );
  });
  return shellPath;
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

/** Who Claude Code is signed in as (`claude auth status`, which reads its saved login, no request). */
async function signIn(file: string): Promise<Pick<ClaudeStatus, "signedIn" | "method" | "email" | "org">> {
  const out = await run(file, ["auth", "status", "--json"], 15_000);
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

/** Finds Claude Code, chooses one, and points the agent at it. Cached; `refresh` looks again. */
export function claudeStatus(refresh = false): Promise<ClaudeStatus> {
  if (refresh || !cached) cached = look().catch(() => ({ ...missing }));
  return cached;
}

const missing: ClaudeStatus = {
  source: "missing",
  recommended: RECOMMENDED,
  versionState: "ok",
  signedIn: null,
};

async function look(): Promise<ClaudeStatus> {
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
    ...(await signIn(chosen.file)),
  };
}

const opt = async (v: Promise<string | null>) => {
  const s = await v;
  return s ? { v: s } : {};
};

// Install, sign in, update: one at a time, reported as it goes.

/** Terminal colour and cursor codes. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

let task: { child: ChildProcess; kind: ClaudeTask["kind"] } | null = null;

export function claudeTasks(emit: (t: ClaudeTask) => void) {
  const start = async (kind: ClaudeTask["kind"], file: string, args: string[]) => {
    if (task) throw new Error("Claude Code is busy with something else. Wait for it, or cancel it.");
    const child = spawn(file, args, { env: claudeEnv(), stdio: ["pipe", "pipe", "pipe"] });
    task = { child, kind };
    let last = "";
    let url: string | undefined;
    let needsCode = false;
    const onData = (buf: Buffer) => {
      // Without colours and cursor moves: the installer and the CLI draw for a terminal.
      const text = buf.toString("utf8").replace(ANSI, "");
      const lines = text
        .split(/\r|\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length) last = lines.at(-1)!;
      const link = /https:\/\/\S+/.exec(text)?.[0];
      if (kind === "login" && link && !url) url = link;
      // The CLI opens the browser itself; the page then shows a code to paste back.
      if (kind === "login" && /paste code/i.test(text)) needsCode = true;
      emit({
        kind,
        state: "running",
        message: last.slice(0, 300),
        ...(url && { url }),
        ...(needsCode && { needsCode }),
      });
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
    login: async () => {
      const s = await claudeStatus();
      if (!s.path) throw new Error("Install Claude Code first.");
      await start("login", s.path, ["auth", "login"]);
    },
    update: async () => {
      const s = await claudeStatus();
      // The user's own install, even one passed over for being too old; the app's copy updates with the app.
      const file = s.source === "bundled" ? s.skipped?.path : s.path;
      if (!file) throw new Error("Install Claude Code first.");
      await start("update", file, ["update"]);
    },
    code: async (code: string) => {
      if (task?.kind !== "login") throw new Error("Not signing in.");
      task.child.stdin?.write(`${code.trim()}\n`);
    },
    cancel: async () => {
      task?.child.kill("SIGTERM");
    },
  };
}
