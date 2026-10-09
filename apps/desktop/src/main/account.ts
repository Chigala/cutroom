/**
 * The Cutroom account this computer is signed in to (apps/auth). Signing in happens in the browser
 * (account-flow.ts); the session it gives is kept encrypted with the keychain in <app data>/account.json,
 * and the editor's window only ever learns who's signed in, never the session.
 *
 * The account server is baked in at build time from VEDIT_AUTH_URL (or set in the environment); a build
 * without one has no accounts, and everything else works the same.
 */
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AccountProvider, AccountStatus } from "@vedit/bridge";
import { app, type BrowserWindow, net, shell } from "electron";
import { browserSignIn, type SignedIn } from "./account-flow.ts";
import { addSecret } from "./log.ts";
import { seal, unseal } from "./secrets.ts";

declare const __AUTH_URL__: string;

const PROVIDERS: readonly AccountProvider[] = ["google", "apple", "github"];
/** How long a check with the server holds before the next status asks again. */
const CHECK_EVERY = 5 * 60_000;

const server = () =>
  (process.env.VEDIT_AUTH_URL || (typeof __AUTH_URL__ === "string" ? __AUTH_URL__ : ""))
    .trim()
    .replace(/\/+$/, "");

const file = () => path.join(app.getPath("userData"), "account.json");
const userAgent = () => `Cutroom/${app.getVersion()} (${process.platform})`;

interface AccountFile {
  readonly version: 1;
  readonly encrypted: boolean;
  readonly token: string;
  readonly user: SignedIn["user"];
}

/** Undefined until read; null when signed out. */
let saved: SignedIn | null | undefined;
let checked: { at: number; offline: boolean } | null = null;
let providers: AccountProvider[] | null = null;
let signingIn: { abort: AbortController; done: Promise<AccountStatus> } | null = null;
let editor: () => BrowserWindow | null = () => null;

/** The editor's window, brought back to the front when the browser hands the sign-in back. */
export function setAccountWindow(window: () => BrowserWindow | null): void {
  editor = window;
}

async function load(): Promise<SignedIn | null> {
  if (saved !== undefined) return saved;
  try {
    const f = JSON.parse(await readFile(file(), "utf8")) as AccountFile;
    saved = { token: unseal(f.encrypted, f.token), user: f.user };
    addSecret(saved.token);
  } catch {
    // None yet, or the keychain item is gone (another computer): signed out.
    saved = null;
  }
  return saved;
}

async function save(next: SignedIn | null): Promise<void> {
  saved = next;
  checked = next ? { at: Date.now(), offline: false } : null;
  if (!next) {
    await rm(file(), { force: true });
    return;
  }
  addSecret(next.token);
  const { encrypted, value } = seal(next.token);
  const body: AccountFile = { version: 1, encrypted, token: value, user: next.user };
  const tmp = `${file()}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file());
}

/** Through Electron's net: the system's proxy and certificates, as the browser has. */
const ask = (url: string, init: RequestInit = {}, timeout = 8000) =>
  net.fetch(`${server()}${url}`, {
    ...init,
    headers: { "user-agent": userAgent(), ...init.headers },
    signal: AbortSignal.timeout(timeout),
  });

/** Still signed in? Signed out on the server (expired, or ended elsewhere) signs out here too. */
async function check(account: SignedIn): Promise<void> {
  if (checked && !checked.offline && Date.now() - checked.at < CHECK_EVERY) return;
  try {
    const res = await ask("/desktop/me", { headers: { authorization: `Bearer ${account.token}` } });
    // Signed out or in again while this was asking: what it found is about the old session.
    if (saved?.token !== account.token) return;
    if (res.status === 401) return void (await save(null));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { user } = (await res.json()) as { user: SignedIn["user"] };
    if (saved?.token !== account.token) return;
    if (user.name !== account.user.name || user.email !== account.user.email)
      await save({ token: account.token, user: { name: user.name, email: user.email } });
    checked = { at: Date.now(), offline: false };
  } catch {
    checked = { at: Date.now(), offline: true };
  }
}

async function offered(): Promise<AccountProvider[]> {
  if (providers) return providers;
  try {
    const res = await ask("/desktop/providers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { providers?: unknown[] };
    const ways = PROVIDERS.filter((p) => body.providers?.includes(p));
    // Kept only once there's a way in: an empty answer is asked again next time.
    if (ways.length) providers = ways;
    return ways;
  } catch {
    return [];
  }
}

export async function accountStatus(): Promise<AccountStatus> {
  if (!server()) return { available: false, providers: [] };
  const account = await load();
  const [ways] = await Promise.all([offered(), account && check(account)]);
  return {
    available: true,
    providers: ways,
    ...(saved && { user: saved.user, ...(checked?.offline && { offline: true }) }),
  };
}

/** Sign in in the browser; resolves when it's done, failed or cancelled (an error says why). */
export function accountSignIn(provider: unknown): Promise<AccountStatus> {
  if (signingIn) return signingIn.done;
  if (!server() || !PROVIDERS.includes(provider as AccountProvider)) return accountStatus();
  const abort = new AbortController();
  const done = (async (): Promise<AccountStatus> => {
    try {
      await save(
        await browserSignIn({
          server: server(),
          provider: provider as AccountProvider,
          open: (url) => shell.openExternal(url),
          signal: abort.signal,
          userAgent: userAgent(),
          fetch: (url, init) => net.fetch(String(url), init),
        }),
      );
      // Back to the editor from the browser.
      const win = editor();
      if (win?.isMinimized()) win.restore();
      win?.show();
      win?.focus();
      app.focus({ steal: true });
      return accountStatus();
    } catch (err) {
      const status = await accountStatus();
      return abort.signal.aborted ? status : { ...status, error: (err as Error).message };
    } finally {
      signingIn = null;
    }
  })();
  signingIn = { abort, done };
  return done;
}

export function accountCancelSignIn(): void {
  signingIn?.abort.abort();
}

/** Ends this computer's session on the server too (when it can be reached). */
export async function accountSignOut(): Promise<AccountStatus> {
  const account = await load();
  if (account)
    await ask("/desktop/sign-out", {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}` },
    }).catch(() => {});
  await save(null);
  return accountStatus();
}
