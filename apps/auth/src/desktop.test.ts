import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authFor, type Env } from "./auth.ts";
import { handle } from "./handle.ts";
import { freshDb, testEnv } from "./testing.ts";

const ORIGIN = "https://auth.test";
const PORT = 51234;

const get = (env: Env, path: string, token?: string) =>
  handle(
    new Request(`${ORIGIN}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
    env,
  );

const post = (env: Env, path: string, body: unknown, token?: string) =>
  handle(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    }),
    env,
  );

/** The app's side: a verifier, and its challenge. */
function pair() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Someone who's just signed in with Google in their browser: that browser's session. */
async function signedInBrowser(env: Env) {
  const ctx = await (await authFor(env, ORIGIN)).$context;
  const user =
    (await ctx.internalAdapter.findUserByEmail("ada@example.com"))?.user ??
    (await ctx.internalAdapter.createUser(
      { email: "ada@example.com", name: "Ada", emailVerified: true },
      { method: "admin" },
    ));
  const session = await ctx.internalAdapter.createSession(user.id, false);
  return { user, browser: session.token };
}

/** The start the browser is in the middle of (its id only travels through Google, in the callback URL). */
const startId = (db: DatabaseSync) =>
  String(
    (
      db.prepare(`select identifier from verification where identifier like 'desktop-start:%'`).get() as {
        identifier: string;
      }
    ).identifier,
  ).slice("desktop-start:".length);

/** Starts signing in from the app, and comes back from Google signed in: where the browser is sent. */
async function signIn(env: Env, db: DatabaseSync, challenge: string) {
  const started = await get(env, `/desktop/start?provider=google&challenge=${challenge}&port=${PORT}`);
  expect(started.status).toBe(302);
  const { browser } = await signedInBrowser(env);
  const done = await get(env, `/desktop/done?n=${startId(db)}`, browser);
  expect(done.status).toBe(302);
  return { done: new URL(done.headers.get("location")!), browser, started };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("signing the desktop app in", () => {
  it("sends the browser to Google, back to Better Auth, with the app's own page to come back to", async () => {
    const env = testEnv();
    const { challenge } = pair();
    const res = await get(env, `/desktop/start?provider=google&challenge=${challenge}&port=${PORT}`);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://accounts.google.com");
    expect(to.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/google`);
    expect(to.searchParams.get("prompt")).toBe("select_account");
    expect(to.searchParams.get("state")).toBeTruthy();
  });

  it("hands the browser's sign-in to the app through 127.0.0.1, then a session of its own for the code and verifier", async () => {
    const db = freshDb();
    const env = testEnv(db);
    const { verifier, challenge } = pair();
    const { done, browser } = await signIn(env, db, challenge);

    expect(done.origin).toBe(`http://127.0.0.1:${PORT}`);
    expect(done.pathname).toBe("/callback");
    const code = done.searchParams.get("code")!;
    // The browser was only the way in: it's signed out again.
    expect((await get(env, "/desktop/me", browser)).status).toBe(401);

    const res = await post(env, "/desktop/token", { code, verifier });
    expect(res.status).toBe(200);
    const { token, user } = (await res.json()) as { token: string; user: unknown };
    expect(user).toEqual({ id: expect.any(String), name: "Ada", email: "ada@example.com" });
    expect(token).not.toBe(browser);

    const me = await get(env, "/desktop/me", token);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe("ada@example.com");

    // Signing out ends the app's session.
    expect((await post(env, "/desktop/sign-out", {}, token)).status).toBe(200);
    expect((await get(env, "/desktop/me", token)).status).toBe(401);
  });

  it("takes a code once, only with the verifier it was made for, and only for a minute", async () => {
    const db = freshDb();
    const env = testEnv(db);
    const ours = pair();
    const theirs = pair();

    const first = (await signIn(env, db, ours.challenge)).done.searchParams.get("code")!;
    // Someone who saw the code but hasn't the verifier: no session, and the code is gone.
    expect((await post(env, "/desktop/token", { code: first, verifier: theirs.verifier })).status).toBe(400);
    expect((await post(env, "/desktop/token", { code: first, verifier: ours.verifier })).status).toBe(400);

    const second = (await signIn(env, db, ours.challenge)).done.searchParams.get("code")!;
    expect((await post(env, "/desktop/token", { code: second, verifier: ours.verifier })).status).toBe(200);
    expect((await post(env, "/desktop/token", { code: second, verifier: ours.verifier })).status).toBe(400);

    const third = (await signIn(env, db, ours.challenge)).done.searchParams.get("code")!;
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    expect((await post(env, "/desktop/token", { code: third, verifier: ours.verifier })).status).toBe(400);
  });

  it("comes back once per start, and passes on a sign-in that failed", async () => {
    const db = freshDb();
    const env = testEnv(db);
    const { challenge } = pair();
    await get(env, `/desktop/start?provider=google&challenge=${challenge}&port=${PORT}`);
    const id = startId(db);
    const failed = await get(env, `/desktop/done?n=${id}&error=access_denied`);
    expect(new URL(failed.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    // Used up.
    expect((await get(env, `/desktop/done?n=${id}`)).status).toBe(400);
  });

  it("turns away links the app didn't make, and ways in it hasn't the keys for", async () => {
    const env = testEnv();
    const { challenge } = pair();
    expect((await get(env, `/desktop/start?provider=google&challenge=short&port=${PORT}`)).status).toBe(400);
    expect((await get(env, `/desktop/start?provider=google&challenge=${challenge}&port=80`)).status).toBe(
      400,
    );
    expect((await get(env, `/desktop/start?provider=apple&challenge=${challenge}&port=${PORT}`)).status).toBe(
      400,
    );
    expect(await (await get(env, "/desktop/providers")).json()).toEqual({ providers: ["google"] });
    expect((await post(env, "/desktop/token", { code: "x", verifier: "y" })).status).toBe(400);
  });

  it("gives each address a fair share of sign-ins started and codes traded, and doesn't count the steps between", async () => {
    const env = testEnv(freshDb(), { PER_ADDRESS: { limit: async () => ({ success: false }) } });
    const { challenge } = pair();
    expect(
      (await get(env, `/desktop/start?provider=google&challenge=${challenge}&port=${PORT}`)).status,
    ).toBe(429);
    expect((await post(env, "/desktop/token", { code: challenge, verifier: challenge })).status).toBe(429);
    expect((await get(env, "/desktop/providers")).status).toBe(200);
    expect((await get(env, "/desktop/done?n=x")).status).toBe(400);
  });

  it("offers GitHub once it has keys, and sends the browser there", async () => {
    const env = testEnv(freshDb(), { GITHUB_CLIENT_ID: "gh-client", GITHUB_CLIENT_SECRET: "gh-secret" });
    expect(await (await get(env, "/desktop/providers")).json()).toEqual({ providers: ["google", "github"] });
    const { challenge } = pair();
    const res = await get(env, `/desktop/start?provider=github&challenge=${challenge}&port=${PORT}`);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://github.com");
    expect(to.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/github`);
  });

  it("leaves Apple out when its key won't load, and Google still works", async () => {
    const env = testEnv(freshDb(), {
      APPLE_SERVICES_ID: "dev.cutroom.signin",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      APPLE_PRIVATE_KEY: "not a key",
    });
    expect(await (await get(env, "/desktop/providers")).json()).toEqual({ providers: ["google"] });
    const { challenge } = pair();
    expect(
      (await get(env, `/desktop/start?provider=google&challenge=${challenge}&port=${PORT}`)).status,
    ).toBe(302);
  });

  it("doesn't link a sign-in to someone's account on an email the provider hasn't verified", async () => {
    const env = testEnv();
    const options = (await authFor(env, ORIGIN)).options;
    // Better Auth's default: only verified emails link, and no provider is trusted to skip that.
    expect(options.account).toEqual({ encryptOAuthTokens: true });
  });
});
