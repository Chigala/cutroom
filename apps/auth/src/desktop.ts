/**
 * Signing the desktop app in. The app can't hold the sign-in itself (Google and Apple want the person's own
 * browser, with its saved accounts and passkeys), so:
 *
 *   1. The app makes a secret (the verifier), listens on 127.0.0.1, and opens the browser at
 *      /desktop/start with the verifier's hash (the challenge) and its port.
 *   2. The browser signs in with Google or Apple through Better Auth, which comes back to /desktop/done.
 *   3. /desktop/done swaps the browser's session for a one-time code, good for a minute and tied to the
 *      challenge, signs the browser out again, and sends the code to the app on 127.0.0.1.
 *   4. The app trades the code and its verifier at /desktop/token for a session of its own.
 *
 * A code that's seen on the way (in the browser's history, say) is no use without the verifier, which
 * never leaves the app. 127.0.0.1 rather than a cutroom:// link: it works the same on every system,
 * with nothing to register.
 */
import { type Auth, type Provider, providersOf } from "./auth.ts";

const START_FOR = 15 * 60;
const CODE_FOR = 60;
/** A SHA-256 in base64url (the challenge), and what the app makes its verifier and codes from. */
const HASH = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const sha256 = async (text: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));

const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A short page in the browser, for when there's nowhere to send it. */
const page = (title: string, text: string, status = 400) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
      `<body style="font:15px/1.5 system-ui;display:grid;place-items:center;min-height:90vh;margin:0 16px;color:#222">` +
      `<div style="max-width:420px"><h1 style="font-size:20px">${title}</h1><p>${text}</p></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );

/** A redirect that keeps the cookies Better Auth set (or cleared) on the way. */
function redirect(to: string, from?: Response): Response {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  for (const cookie of from?.headers.getSetCookie() ?? []) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

const back = (port: number, query: Record<string, string>) =>
  `http://127.0.0.1:${port}/callback?${new URLSearchParams(query)}`;

interface Started {
  readonly challenge: string;
  readonly port: number;
}

interface Handoff {
  readonly userId: string;
  readonly challenge: string;
}

/** What the app shows of the person: never the session or anything about other sign-ins. */
const who = (u: { id: string; name: string; email: string; image?: string | null }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  ...(u.image && { image: u.image }),
});

/** 1. From the app, in the browser: start signing in with the provider it picked. */
async function start(request: Request, auth: Auth): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const provider = q.get("provider") as Provider;
  const challenge = q.get("challenge") ?? "";
  const port = Number(q.get("port"));
  if (!providersOf(auth).includes(provider))
    return page("Can't sign in that way", "Go back to Cutroom and pick another way to sign in.");
  if (!HASH.test(challenge) || !Number.isInteger(port) || port < 1024 || port > 65535)
    return page("This link isn't from Cutroom", "Open Cutroom and sign in from there.");

  const nonce = random();
  const ctx = await auth.$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `desktop-start:${nonce}`,
    value: JSON.stringify({ challenge, port } satisfies Started),
    expiresAt: new Date(Date.now() + START_FOR * 1000),
  });
  const done = `/desktop/done?n=${nonce}`;
  const res = await auth.api.signInSocial({
    body: { provider, callbackURL: done, errorCallbackURL: done },
    headers: request.headers,
    asResponse: true,
  });
  const { url } = (await res.json()) as { url?: string };
  if (!url) return page("Couldn't start signing in", "Go back to Cutroom and try again.", 502);
  return redirect(url, res);
}

/** 3. Back from Google or Apple: hand the sign-in to the app, and sign the browser out again. */
async function done(request: Request, auth: Auth): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const ctx = await auth.$context;
  const row = await ctx.internalAdapter.consumeVerificationValue(`desktop-start:${q.get("n") ?? ""}`);
  if (!row) return page("This sign-in has expired", "Go back to Cutroom and sign in again.");
  const { challenge, port } = JSON.parse(row.value) as Started;

  const error = q.get("error");
  if (error) return redirect(back(port, { error }));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirect(back(port, { error: "not_signed_in" }));

  const code = random();
  await ctx.internalAdapter.createVerificationValue({
    identifier: `desktop-code:${await sha256(code)}`,
    value: JSON.stringify({ userId: session.user.id, challenge } satisfies Handoff),
    expiresAt: new Date(Date.now() + CODE_FOR * 1000),
  });
  // The browser was only the way in: nothing stays signed in there.
  const out = await auth.api.signOut({ headers: request.headers, asResponse: true });
  return redirect(back(port, { code }), out);
}

/** 4. The app trades the code and its verifier for a session of its own. */
async function token(request: Request, auth: Auth): Promise<Response> {
  let body: { code?: unknown; verifier?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Not JSON" }, 400);
  }
  const code = typeof body.code === "string" ? body.code : "";
  const verifier = typeof body.verifier === "string" ? body.verifier : "";
  if (!HASH.test(code) || !VERIFIER.test(verifier)) return json({ error: "Bad request" }, 400);

  const ctx = await auth.$context;
  // Used up whatever happens next: a code is good for one try.
  const row = await ctx.internalAdapter.consumeVerificationValue(`desktop-code:${await sha256(code)}`);
  if (!row) return json({ error: "This sign-in has expired. Try again." }, 400);
  const { userId, challenge } = JSON.parse(row.value) as Handoff;
  if ((await sha256(verifier)) !== challenge)
    return json({ error: "This sign-in wasn't started here." }, 400);

  const user = await ctx.internalAdapter.findUserById(userId);
  if (!user) return json({ error: "This account no longer exists." }, 400);
  const session = await ctx.internalAdapter.createSession(userId, false, {
    userAgent: request.headers.get("user-agent") ?? "",
    ipAddress: request.headers.get("cf-connecting-ip") ?? "",
  });
  return json({ token: session.token, user: who(user) });
}

/** Who the app's token belongs to (401: signed out, or the session ran out). */
async function me(request: Request, auth: Auth): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session ? json({ user: who(session.user) }) : json({ error: "Signed out" }, 401);
}

async function signOut(request: Request, auth: Auth): Promise<Response> {
  try {
    await auth.api.signOut({ headers: request.headers });
  } catch {
    // Already gone.
  }
  return json({ ok: true });
}

/** The desktop routes, or null for anything else. */
export function desktop(request: Request, auth: Auth): Promise<Response> | null {
  const { pathname } = new URL(request.url);
  const get = request.method === "GET";
  const post = request.method === "POST";
  if (get && pathname === "/desktop/providers")
    return Promise.resolve(json({ providers: providersOf(auth) }));
  if (get && pathname === "/desktop/start") return start(request, auth);
  if (get && pathname === "/desktop/done") return done(request, auth);
  if (post && pathname === "/desktop/token") return token(request, auth);
  if (get && pathname === "/desktop/me") return me(request, auth);
  if (post && pathname === "/desktop/sign-out") return signOut(request, auth);
  return null;
}
