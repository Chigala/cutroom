/**
 * Where instant edits ask Jev, and the log that tunes them. Builds call Cutroom's proxy (its address is
 * baked in at build time from VEDIT_JEV_URL, or set in the environment), which holds the TypeSafe key;
 * development can call TypeSafe directly with TYPESAFE_API_KEY. Neither set: no instant edits, the agent
 * does everything as before.
 */
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Instant, JevEndpoint, JevReply } from "@vedit/instant";
import { TYPESAFE_URL } from "@vedit/instant";
import { app } from "electron";
import { addSecret, logsDir } from "./log.ts";

declare const __JEV_URL__: string;

let install: string | undefined;

/** An anonymous id for this install: the proxy's fair share is per install. Nothing else is in it. */
async function installId(): Promise<string> {
  if (install) return install;
  const file = path.join(app.getPath("userData"), "install-id");
  try {
    install = (await readFile(file, "utf8")).trim();
  } catch {}
  if (!install || !/^[a-zA-Z0-9-]{16,64}$/.test(install)) {
    install = randomUUID();
    await writeFile(file, install).catch(() => {});
  }
  return install;
}

export async function jevEndpoint(): Promise<JevEndpoint | null> {
  const proxy = (process.env.VEDIT_JEV_URL || (typeof __JEV_URL__ === "string" ? __JEV_URL__ : "")).trim();
  if (proxy)
    return {
      url: `${proxy.replace(/\/+$/, "")}/v1/instant`,
      headers: { "x-cutroom-install": await installId() },
    };
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (key) {
    addSecret(key);
    return { url: TYPESAFE_URL, headers: { authorization: `Bearer ${key}` } };
  }
  return null;
}

/** Past this, the log starts again: it's for tuning, not keeping. */
const MAX_LOG = 5_000_000;

/**
 * One line per request Jev saw: what it picked, how sure it was, and what happened. Stays on this
 * computer (logs/instant.jsonl); comparing it with what the agent then did is how the thresholds move.
 */
export async function logInstant(entry: {
  project: string;
  request: string;
  instant: Instant;
  reply?: JevReply;
  error?: string;
  ms: number;
}): Promise<void> {
  try {
    const dir = logsDir();
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "instant.jsonl");
    const size = await stat(file).then(
      (s) => s.size,
      () => 0,
    );
    const picks = entry.reply
      ? Object.fromEntries(
          Object.entries(entry.reply.answers).map(([k, a]) => [
            k,
            a.type === "noul"
              ? Math.round(a.noul * 100) / 100
              : [a.choice, Math.round((a.probabilities[a.choice] ?? 0) * 100) / 100],
          ]),
        )
      : undefined;
    const line = JSON.stringify({
      at: new Date().toISOString(),
      project: entry.project,
      request: entry.request,
      result: entry.instant,
      ms: entry.ms,
      ...(entry.reply && {
        jevMs: entry.reply.ms,
        model: entry.reply.model,
        tokens: entry.reply.inputTokens,
        picks,
      }),
      ...(entry.error && { error: entry.error }),
    });
    await (size > MAX_LOG ? writeFile(file, `${line}\n`) : appendFile(file, `${line}\n`));
  } catch {}
}
