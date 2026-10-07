import { JEV_MODEL, TYPESAFE_URL } from "@vedit/instant/jev";
import { describe, expect, it } from "vitest";
import { type Env, handle, MAX_BODY } from "./proxy.ts";

const INSTALL = "3f2b8c1e-7a4d-4c55-9e0f-1b2c3d4e5f60";
const evaluation = { state: { request: "mute the music" }, questions: { verb: { type: "choice" } } };

function post(body: unknown, headers: Record<string, string> = { "x-cutroom-install": INSTALL }) {
  return new Request("https://jev.example/v1/instant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function upstream() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ model: JEV_MODEL, answers: {} }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const env: Env = { TYPESAFE_API_KEY: "test-key" };

describe("the Jev proxy", () => {
  it("adds the key, pins the model and forwards only the evaluation", async () => {
    const up = upstream();
    const res = await handle(post({ ...evaluation, model: "jev-preview", extra: "dropped" }), env, up.fetch);
    expect(res.status).toBe(200);
    expect(up.calls).toHaveLength(1);
    expect(up.calls[0]!.url).toBe(TYPESAFE_URL);
    expect((up.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(up.calls[0]!.init.body))).toEqual({ ...evaluation, model: JEV_MODEL });
  });

  it("turns away anything that isn't the app asking Jev", async () => {
    const up = upstream();
    expect((await handle(post(evaluation, {}), env, up.fetch)).status).toBe(400);
    expect((await handle(post("not json"), env, up.fetch)).status).toBe(400);
    expect(
      (await handle(post({ state: "x", questions: { a: { type: "shell" } } }), env, up.fetch)).status,
    ).toBe(400);
    expect((await handle(post({ state: "x".repeat(MAX_BODY), questions: {} }), env, up.fetch)).status).toBe(
      413,
    );
    expect((await handle(new Request("https://jev.example/v1/instant"), env, up.fetch)).status).toBe(404);
    expect((await handle(post(evaluation), { TYPESAFE_API_KEY: "" }, up.fetch)).status).toBe(503);
    expect(up.calls).toHaveLength(0);
  });

  it("stops an install that asks too often", async () => {
    const up = upstream();
    const limited: Env = { ...env, PER_INSTALL: { limit: async () => ({ success: false }) } };
    expect((await handle(post(evaluation), limited, up.fetch)).status).toBe(429);
    expect(up.calls).toHaveLength(0);
  });
});
