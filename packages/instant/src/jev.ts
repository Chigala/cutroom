/**
 * The call to Jev: through Cutroom's proxy (which holds the key), or straight to TypeSafe with a key
 * for development. A pinned model, so the thresholds stay tuned to the answers it gives.
 */
import type { JevRequest } from "./ask.ts";
import type { Answer } from "./decode.ts";

export const JEV_MODEL = "jev-1.13.0";
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

export interface JevEndpoint {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface JevReply {
  readonly answers: Record<string, Answer>;
  readonly model: string;
  readonly inputTokens?: number;
  readonly ms: number;
}

export class JevError extends Error {}

export async function evaluate(
  endpoint: JevEndpoint,
  body: JevRequest,
  opts: { timeoutMs?: number; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<JevReply> {
  const started = Date.now();
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 3000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...endpoint.headers },
      body: JSON.stringify({ ...body, model: JEV_MODEL }),
      signal,
    });
  } catch (err) {
    throw new JevError(timeout.aborted ? "Jev took too long" : `Jev unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new JevError(`Jev ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    answers?: Record<string, Answer>;
    model?: string;
    usage?: { input_tokens?: number };
  };
  if (!json.answers) throw new JevError("Jev sent no answers");
  return {
    answers: json.answers,
    model: json.model ?? JEV_MODEL,
    ...(json.usage?.input_tokens !== undefined && { inputTokens: json.usage.input_tokens }),
    ms: Date.now() - started,
  };
}
