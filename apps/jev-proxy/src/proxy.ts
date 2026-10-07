/**
 * Cutroom's Jev proxy, a Cloudflare Worker. The app can't carry the TypeSafe key (anything in an
 * installer can be read out of it), so it sends its questions here and the Worker adds the key. It
 * forwards only Jev evaluations, of a bounded size, at the pinned model, rate-limited per install and
 * per address. Requests hold people's words: nothing here logs a body.
 */
import { JEV_MODEL, TYPESAFE_URL } from "@vedit/instant/jev";

interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  readonly TYPESAFE_API_KEY: string;
  readonly PER_INSTALL?: RateLimit;
  readonly PER_ADDRESS?: RateLimit;
}

/** A request well over what the app sends (a big project is ~100 KB) is someone else's. */
export const MAX_BODY = 400_000;
const MAX_QUESTIONS = 400;
const INSTALL = /^[a-zA-Z0-9-]{16,64}$/;

const reply = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

export async function handle(request: Request, env: Env, upstream: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return new Response("ok");
  if (request.method !== "POST" || url.pathname !== "/v1/instant") return reply(404, "Not found");
  if (!env.TYPESAFE_API_KEY) return reply(503, "Not configured");

  const install = request.headers.get("x-cutroom-install") ?? "";
  if (!INSTALL.test(install)) return reply(400, "Missing install id");
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const [mine, theirs] = await Promise.all([
    env.PER_INSTALL?.limit({ key: install }) ?? { success: true },
    env.PER_ADDRESS?.limit({ key: address }) ?? { success: true },
  ]);
  if (!mine.success || !theirs.success) return reply(429, "Too many requests");

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return reply(413, "Too large");
  const text = await request.text();
  if (text.length > MAX_BODY) return reply(413, "Too large");
  let body: { state?: unknown; questions?: Record<string, { type?: unknown }> };
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, "Not JSON");
  }
  const questions = body.questions;
  if (
    body.state === undefined ||
    !questions ||
    typeof questions !== "object" ||
    Object.keys(questions).length > MAX_QUESTIONS ||
    Object.values(questions).some((q) => !["noul", "choice", "score"].includes(String(q?.type)))
  )
    return reply(400, "Not a Jev evaluation");

  let res: Response;
  try {
    res = await upstream(TYPESAFE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      // Only what Jev needs, at the pinned model, whatever the request said.
      body: JSON.stringify({ state: body.state, questions, model: JEV_MODEL }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return reply(504, "Jev didn't answer");
  }
  // Jev's own status and body (its errors say what was wrong with the questions), without its headers.
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}
