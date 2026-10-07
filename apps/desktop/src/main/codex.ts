/**
 * Codex for the agent: where it's installed, Cutroom's own Codex folder, and whether it's signed in.
 *
 * Codex comes from the user's install: the Codex app (which carries the command), the CLI (npm, brew,
 * the install scripts), or a path set in Settings. Cutroom runs it with its own folder (CODEX_HOME), so
 * the user's ~/.codex (their settings, MCP servers, AGENTS.md, hooks) never reaches the editing agent;
 * the user signs in once, inside Cutroom, with ChatGPT, through Codex's own sign-in.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { CodexServer, codexLimits } from "@vedit/agent";
import type { AgentModel, CodexStatus } from "@vedit/bridge";
import { app, shell } from "electron";
import { executable, userPath } from "./claude.ts";
import { getSettings } from "./settings.ts";

const exe = process.platform === "win32" ? "codex.exe" : "codex";

/** Where installers put it, when the shell's PATH doesn't say. */
const KNOWN = () => {
  const home = homedir();
  if (process.platform === "darwin")
    return [
      // The Codex app carries the command.
      "/Applications/Codex.app/Contents/Resources/codex",
      path.join(home, "Applications", "Codex.app", "Contents", "Resources", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      path.join(home, ".local", "bin", "codex"),
    ];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return [
      path.join(home, ".local", "bin", "codex.exe"),
      path.join(local, "Programs", "Codex", "resources", "codex.exe"),
      path.join(local, "Programs", "codex", "codex.exe"),
      // An npm install: the .cmd shim (Codex's own exe is found beside it when it can be).
      path.join(roaming, "npm", "codex.cmd"),
    ];
  }
  return [path.join(home, ".local", "bin", "codex"), "/usr/local/bin/codex", "/usr/bin/codex"];
};

/** The native codex.exe an npm .cmd shim runs, so it starts without cmd.exe; the shim if not found. */
async function native(shim: string): Promise<string> {
  if (!/\.cmd$/i.test(shim)) return shim;
  const root = path.join(path.dirname(shim), "node_modules", "@openai");
  const search = async (dir: string, depth: number): Promise<string | null> => {
    if (depth > 7) return null;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries)
      if (e.isFile() && e.name.toLowerCase() === "codex.exe") return path.join(dir, e.name);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const found = await search(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  return (await search(root, 0)) ?? shim;
}

/** The codex to run: Settings' path, else the first on the user's PATH, else where installers put it. */
async function find(): Promise<string | null> {
  const custom = (await getSettings()).codexPath.trim() || process.env.VEDIT_CODEX_PATH;
  if (custom) return existsSync(custom) ? native(custom) : null;
  const dirs = (await userPath()).split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? [exe, "codex.cmd"] : [exe];
  for (const file of [...dirs.flatMap((d) => names.map((n) => path.join(d, n))), ...KNOWN()])
    if (existsSync(file) && (process.platform === "win32" || executable(file))) return native(file);
  return null;
}

/** Cutroom's Codex folder: its sign-in and settings, apart from the user's own ~/.codex. */
export async function codexHome(): Promise<string> {
  const home = path.join(app.getPath("userData"), "codex");
  await mkdir(home, { recursive: true });
  // Signed-in tokens in a file there, the same on every system (Linux often has no keyring).
  const config = path.join(home, "config.toml");
  if (!existsSync(config)) await writeFile(config, 'cli_auth_credentials_store = "file"\n');
  return home;
}

/** A Codex app server just for asking it things (account, models): signed out of nothing, no thread. */
async function ask<T>(bin: string, use: (server: CodexServer, userAgent: string) => Promise<T>): Promise<T> {
  const home = await codexHome();
  const server = new CodexServer({ bin, home, cwd: app.getPath("temp") });
  try {
    const { userAgent } = await server.start(app.getVersion());
    return await use(server, userAgent);
  } finally {
    server.close();
  }
}

interface ModelInfo {
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  defaultReasoningEffort: string;
}

let cached: Promise<CodexStatus> | null = null;

/** Codex's state: installed where, signed in as whom, its models and the plan's limits. Cached. */
export function codexStatus(refresh = false): Promise<CodexStatus> {
  if (refresh || !cached) cached = look();
  return cached;
}

async function look(): Promise<CodexStatus> {
  const bin = await find();
  if (!bin) {
    delete process.env.VEDIT_CODEX_BIN;
    return { installed: false, signedIn: null, models: [] };
  }
  process.env.VEDIT_CODEX_BIN = bin;
  process.env.VEDIT_CODEX_HOME = await codexHome();
  process.env.VEDIT_VERSION = app.getVersion();
  try {
    return await ask(bin, async (server, userAgent) => {
      // "cutroom/0.155.0 (Mac OS…)": Codex's version follows the first slash.
      const version = /\/([\d.]+[\w.-]*)/.exec(userAgent)?.[1];
      const [{ account }, { data }] = await Promise.all([
        server.request<{
          account: { type: string; email?: string | null; planType?: string } | null;
          requiresOpenaiAuth: boolean;
        }>("account/read", { refreshToken: true }),
        server.request<{ data: ModelInfo[] }>("model/list", {}),
      ]);
      const models: AgentModel[] = data
        .filter((m) => !m.hidden)
        .map((m) => ({
          id: m.model,
          name: m.displayName,
          description: m.description,
          efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
          defaultEffort: m.defaultReasoningEffort,
          ...(m.isDefault && { isDefault: true }),
        }));
      const limits = account
        ? await server
            .request<{ rateLimits: Parameters<typeof codexLimits>[0] }>("account/rateLimits/read")
            .then((r) => codexLimits(r.rateLimits))
            .catch(() => undefined)
        : undefined;
      return {
        installed: true,
        path: bin,
        ...(version && { version }),
        signedIn: !!account,
        ...(account?.type === "chatgpt" && account.email && { email: account.email }),
        ...(account?.type === "chatgpt" && account.planType && { plan: account.planType }),
        ...(account?.type === "apiKey" && { method: "API key" }),
        models,
        ...(limits && { limits }),
      };
    });
  } catch (err) {
    console.warn(`[codex] couldn't ask Codex for its state: ${(err as Error).message}`);
    return {
      installed: true,
      path: bin,
      signedIn: null,
      models: [],
      error: (err as Error).message.slice(0, 300),
    };
  }
}

let signingIn: { server: CodexServer; done: Promise<CodexStatus> } | null = null;

/**
 * Sign in with ChatGPT: Codex's own sign-in, in the browser (it listens on localhost for the answer).
 * Resolves with the new status when it's done, failed or cancelled.
 */
export async function codexLogin(): Promise<CodexStatus> {
  if (signingIn) return signingIn.done;
  const bin = await find();
  if (!bin) return codexStatus(true);
  const server = new CodexServer({ bin, home: await codexHome(), cwd: app.getPath("temp") });
  const done = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Done when Codex says so, when it's gone (cancelled, crashed), or after 15 minutes.
    const finished = new Promise<void>((resolve, reject) => {
      server.on((method, params) => {
        if (method !== "account/login/completed") return;
        const p = params as { success: boolean; error: string | null };
        if (p.success) resolve();
        else reject(new Error(p.error ?? "Sign-in didn't finish."));
      });
      void server.exited.then(reject);
      timer = setTimeout(() => reject(new Error("Sign-in timed out.")), 15 * 60_000);
    });
    // Nothing waits on it if starting fails first.
    finished.catch(() => {});
    try {
      await server.start(app.getVersion());
      const started = await server.request<{ type: string; authUrl?: string }>("account/login/start", {
        type: "chatgpt",
      });
      if (started.authUrl) await shell.openExternal(started.authUrl);
      await finished;
    } catch (err) {
      console.warn(`[codex] sign-in: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
      server.close();
      signingIn = null;
    }
    return codexStatus(true);
  })();
  signingIn = { server, done };
  return done;
}

/** Stops a sign-in waiting in the browser. */
export function codexCancelLogin(): void {
  signingIn?.server.close();
}

export async function codexLogout(): Promise<CodexStatus> {
  const bin = await find();
  if (bin) await ask(bin, (server) => server.request("account/logout")).catch(() => {});
  return codexStatus(true);
}
