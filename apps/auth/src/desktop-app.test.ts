/**
 * The desktop app's half of signing in (apps/desktop/src/main/account-flow.ts) against this Worker, over
 * real HTTP: the app listens on 127.0.0.1, "the browser" follows the redirects, and Google is stood in for
 * by signing the browser in directly.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { browserSignIn } from "../../desktop/src/main/account-flow.ts";
import { authFor, type Env } from "./auth.ts";
import { handle } from "./handle.ts";
import { freshDb, testEnv } from "./testing.ts";

let worker: Server | undefined;

afterEach(() => {
  worker?.close();
  worker = undefined;
});

/** The Worker, served over HTTP on this computer. */
async function serve(env: Env): Promise<string> {
  worker = createServer(async (req, res) => {
    const url = `http://127.0.0.1:${(worker!.address() as AddressInfo).port}${req.url}`;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const out = await handle(
      new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(chunks.length && { body: Buffer.concat(chunks) }),
      }),
      env,
    );
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise<void>((r) => worker!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
}

/** A browser that signs in at Google (stood in for) and follows the Worker back to the app. */
function browser(env: Env, db: DatabaseSync, server: string, google: "ok" | "cancel") {
  return async (start: string) => {
    const toGoogle = await fetch(start, { redirect: "manual" });
    expect(new URL(toGoogle.headers.get("location")!).origin).toBe("https://accounts.google.com");
    const { identifier } = db
      .prepare(`select identifier from verification where identifier like 'desktop-start:%'`)
      .get() as { identifier: string };
    const n = identifier.slice("desktop-start:".length);
    let back: Response;
    if (google === "cancel")
      back = await fetch(`${server}/desktop/done?n=${n}&error=access_denied`, { redirect: "manual" });
    else {
      const ctx = await (await authFor(env, server)).$context;
      const user = await ctx.internalAdapter.createUser(
        { email: "grace@example.com", name: "Grace", emailVerified: true },
        { method: "admin" },
      );
      const { token } = await ctx.internalAdapter.createSession(user.id, false);
      back = await fetch(`${server}/desktop/done?n=${n}`, {
        redirect: "manual",
        headers: { authorization: `Bearer ${token}` },
      });
    }
    // Not awaited: the app answers the tab once it has its session.
    void fetch(back.headers.get("location")!);
  };
}

describe("the desktop app signing in", () => {
  it("ends with a session of its own, through 127.0.0.1", async () => {
    const db = freshDb();
    const env = testEnv(db);
    const server = await serve(env);
    const { token, user } = await browserSignIn({
      server,
      provider: "google",
      open: browser(env, db, server, "ok"),
    });
    expect(user).toEqual({ name: "Grace", email: "grace@example.com" });
    const me = await fetch(`${server}/desktop/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
  });

  it("says so when it's cancelled at Google", async () => {
    const db = freshDb();
    const env = testEnv(db);
    const server = await serve(env);
    await expect(
      browserSignIn({ server, provider: "google", open: browser(env, db, server, "cancel") }),
    ).rejects.toThrow("Signing in was cancelled.");
  });

  it("stops waiting when the app gives up", async () => {
    const abort = new AbortController();
    const waiting = browserSignIn({
      server: "http://127.0.0.1:9",
      provider: "google",
      open: async () => abort.abort(),
      signal: abort.signal,
    });
    await expect(waiting).rejects.toThrow("Signing in was cancelled.");
  });
});
