/**
 * Cutroom's account server, a Cloudflare Worker: Better Auth under /api/auth, and the desktop app's way
 * in under /desktop (desktop.ts). Each address gets a fair share of sign-ins started and codes traded;
 * the steps in between aren't counted, so a busy office's shared address never breaks one half-way.
 */
import { authFor, type Env } from "./auth.ts";
import { desktop } from "./desktop.ts";

const LIMITED = new Set(["/desktop/start", "/desktop/token"]);

const reply = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return new Response("ok");
  if (!env.BETTER_AUTH_SECRET) return reply(503, "Not configured");

  if (LIMITED.has(url.pathname)) {
    const address = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = (await env.PER_ADDRESS?.limit({ key: address })) ?? { success: true };
    if (!success) return reply(429, "Too many requests");
  }

  const auth = await authFor(env, url.origin);
  if (url.pathname.startsWith("/api/auth/")) return auth.handler(request);
  return (await desktop(request, auth)) ?? reply(404, "Not found");
}
