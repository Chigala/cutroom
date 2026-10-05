/**
 * Whether an API key works, before it's saved: one cheap request to its service (a one-result search, or
 * Groq's model list), as onboarding and Settings show it.
 */
import type { KeyCheck, KeyProvider } from "@vedit/bridge";

/** The request that proves a key, per service, and what a wrong key looks like there. */
function probe(provider: KeyProvider, key: string): { url: string; headers?: Record<string, string> } {
  const k = encodeURIComponent(key);
  switch (provider) {
    case "pixabay":
      return { url: `https://pixabay.com/api/?key=${k}&q=cat&per_page=3` };
    case "pexels":
      return {
        url: "https://api.pexels.com/v1/search?query=nature&per_page=1",
        headers: { Authorization: key },
      };
    case "klipy":
      return {
        url: `https://api.klipy.com/api/v1/${k}/gifs/search?q=cat&per_page=8&customer_id=cutroom-key-check`,
      };
    case "freesound":
      return {
        url: "https://freesound.org/apiv2/search/text/?query=click&page_size=1",
        headers: { Authorization: `Token ${key}` },
      };
    case "groq":
      return { url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${key}` } };
  }
}

export async function checkKey(provider: KeyProvider, key: string): Promise<KeyCheck> {
  const trimmed = key.trim();
  if (!trimmed) return "invalid";
  const { url, headers } = probe(provider, trimmed);
  try {
    const res = await fetch(url, { ...(headers && { headers }), signal: AbortSignal.timeout(10_000) });
    if (res.ok) return "ok";
    if (res.status === 429) return "limited";
    // Wrong keys: 400 (Pixabay), 401 (Pexels, Freesound, Groq), 403, 404 (KLIPY).
    if ([400, 401, 403, 404].includes(res.status)) return "invalid";
    return "offline";
  } catch {
    return "offline";
  }
}
