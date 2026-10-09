/**
 * Signing in to a Cutroom account in the browser, the app's half of apps/auth/src/desktop.ts. Make a
 * verifier, listen on 127.0.0.1, open the browser at the account server's /desktop/start with the
 * verifier's hash and the port; the browser signs in with its provider and comes back here with a
 * one-time code, which, with the verifier, buys this computer a session of its own.
 *
 * No Electron here (account.ts has that): the account server's tests run it against the real thing.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AccountProvider } from "@vedit/bridge";

export interface SignedIn {
  readonly token: string;
  readonly user: { readonly name: string; readonly email: string };
}

export interface BrowserSignIn {
  /** The account server, e.g. https://auth.example.com. */
  readonly server: string;
  readonly provider: AccountProvider;
  /** Opens the system browser. */
  readonly open: (url: string) => Promise<void>;
  readonly signal?: AbortSignal;
  /** How long to wait for the browser; 10 minutes. */
  readonly timeout?: number;
  readonly userAgent?: string;
  /** Electron's net.fetch in the app: the system's proxy and certificates, as the browser had. */
  readonly fetch?: typeof fetch;
}

/** What the browser tab says once it's handed back. */
const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px/1.5 system-ui;display:grid;place-items:center;min-height:90vh;margin:0 16px;color:#222">` +
  `<div style="max-width:420px"><h1 style="font-size:20px">${title}</h1><p>${text}</p></div>`;

const REASONS: Record<string, string> = {
  access_denied: "Signing in was cancelled.",
  not_signed_in: "The browser didn't finish signing in. Try again.",
};

export async function browserSignIn(o: BrowserSignIn): Promise<SignedIn> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const server = createServer();
  let answered = false;
  // The browser's one visit back: later ones (a reload, a second tab) find nothing.
  const callback = new Promise<{ code?: string; error?: string; res: ServerResponse }>((resolve) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback" || answered) {
        res.writeHead(404).end();
        return;
      }
      answered = true;
      resolve({
        code: url.searchParams.get("code") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
        res,
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // This computer only: nothing elsewhere can reach it (and Windows has no firewall to ask about).
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const given = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Signing in timed out.")), o.timeout ?? 10 * 60_000);
    o.signal?.addEventListener("abort", () => reject(new Error("Signing in was cancelled.")), { once: true });
  });
  given.catch(() => {});

  try {
    const start = new URL("/desktop/start", o.server);
    start.search = new URLSearchParams({ provider: o.provider, challenge, port: String(port) }).toString();
    await o.open(start.toString());
    const { code, error, res } = await Promise.race([callback, given]);
    const reply = (ok: boolean, text: string) =>
      res
        .writeHead(ok ? 200 : 400, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        })
        .end(page(ok ? "You're signed in" : "Couldn't sign in", text));
    if (!code) {
      const why = REASONS[error ?? ""] ?? "Something went wrong signing in. Try again.";
      reply(false, `${why} You can close this tab.`);
      throw new Error(why);
    }
    const answer = await (o.fetch ?? fetch)(new URL("/desktop/token", o.server).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", ...(o.userAgent && { "user-agent": o.userAgent }) },
      body: JSON.stringify({ code, verifier }),
      signal: o.signal
        ? AbortSignal.any([o.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (o.signal?.aborted) {
      reply(false, "Signing in was cancelled. You can close this tab.");
      throw new Error("Signing in was cancelled.");
    }
    const body = (await answer?.json().catch(() => null)) as (SignedIn & { error?: string }) | null;
    if (!answer?.ok || !body?.token) {
      const why = body?.error ?? "Couldn't reach Cutroom's account server. Try again.";
      reply(false, `${why} You can close this tab.`);
      throw new Error(why);
    }
    reply(true, "Go back to Cutroom. You can close this tab.");
    return { token: body.token, user: { name: body.user.name, email: body.user.email } };
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}
