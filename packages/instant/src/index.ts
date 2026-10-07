/**
 * Instant edits: requests that name a setting or an item already in the edit ("captions bigger", "mute
 * the music", "remove the second zoom", "undo the music change") done in about a second, without the
 * agent. Jev reads the request against the project and picks; code makes the edit. Anything new,
 * creative, unclear or contradictory goes to the agent as before.
 */
import type { ProjectDoc } from "@vedit/project";
import { ask, type Focus, type RecentChange } from "./ask.ts";
import { decode, type Instant } from "./decode.ts";
import { evaluate, type JevEndpoint, type JevReply } from "./jev.ts";

export { ask, type Focus, type RecentChange, UNCLEAR } from "./ask.ts";
export { type Answer, decode, type Instant, THRESHOLDS } from "./decode.ts";
export { evaluate, JEV_MODEL, type JevEndpoint, JevError, type JevReply, TYPESAFE_URL } from "./jev.ts";
export { numbersIn } from "./numbers.ts";
export { plan } from "./plan.ts";

const UNDO =
  /^\s*(undo|undo (that|it|this|the last (change|one|edit))|take (that|it) back|revert( that| it)?)\s*[.!]*\s*(pls|please)?\s*[.!]*\s*$/i;

/**
 * What plain code can tell before asking anyone: a bare "undo" needs no model; something attached, a
 * link, code or a long brief always needs the agent.
 */
export function precheck(request: string, attachments = 0): Instant | null {
  if (UNDO.test(request)) return { kind: "undo", commit: "last" };
  if (attachments > 0) return { kind: "agent", why: "something attached" };
  if (/https?:\/\/|www\./i.test(request)) return { kind: "agent", why: "a link" };
  if (/```|<\/?[a-z][^>]*>|\{[^}]*:[^}]*\}/i.test(request)) return { kind: "agent", why: "code" };
  if (request.length > 280) return { kind: "agent", why: "a long brief" };
  return null;
}

export interface InstantResult {
  readonly instant: Instant;
  /** Jev's reply, when it was asked (for the log that tunes the thresholds). */
  readonly reply?: JevReply;
}

export async function tryInstant(opts: {
  doc: ProjectDoc;
  request: string;
  endpoint: JevEndpoint;
  attachments?: number;
  focus?: Focus;
  earlier?: readonly string[];
  recent?: readonly RecentChange[];
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<InstantResult> {
  const early = precheck(opts.request, opts.attachments);
  if (early) return { instant: early };
  const { body, asked } = ask(opts.doc, opts.request, {
    ...(opts.focus && { focus: opts.focus }),
    ...(opts.earlier && { earlier: opts.earlier }),
    ...(opts.recent && { recent: opts.recent }),
  });
  const reply = await evaluate(opts.endpoint, body, {
    ...(opts.timeoutMs && { timeoutMs: opts.timeoutMs }),
    ...(opts.signal && { signal: opts.signal }),
  });
  return { instant: decode(opts.doc, opts.request, reply.answers, asked), reply };
}
