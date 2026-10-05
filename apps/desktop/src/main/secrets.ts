/**
 * API keys (KLIPY, Pexels, Pixabay, Freesound), kept apart from settings.json: encrypted with the system
 * keychain (Electron's safeStorage) in <app data>/keys.json, readable by this user only. The editor's
 * window never gets them back, only whether each one is set.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import { addSecret } from "./log.ts";

export const SECRET_FIELDS = ["klipyKey", "pexelsKey", "pixabayKey", "freesoundKey", "groqKey"] as const;
export type SecretField = (typeof SECRET_FIELDS)[number];
export type Secrets = Partial<Record<SecretField, string>>;

const file = () => path.join(app.getPath("userData"), "keys.json");

interface KeysFile {
  readonly version: 1;
  /** Encrypted with the keychain (base64), or, where there is no keychain to use, plain. */
  readonly encrypted: boolean;
  readonly keys: Partial<Record<SecretField, string>>;
}

let cache: Secrets | null = null;

const canEncrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

export async function readSecrets(): Promise<Secrets> {
  if (cache) return cache;
  await app.whenReady();
  const out: Secrets = {};
  try {
    const stored = JSON.parse(await readFile(file(), "utf8")) as KeysFile;
    for (const field of SECRET_FIELDS) {
      const value = stored.keys[field];
      if (!value) continue;
      try {
        out[field] = stored.encrypted ? safeStorage.decryptString(Buffer.from(value, "base64")) : value;
        addSecret(out[field]);
      } catch {
        // The keychain item went missing (another Mac, a reset keychain): the key has to be entered again.
        console.warn(`[keys] couldn't decrypt the saved ${field}; it needs entering again`);
      }
    }
  } catch {}
  cache = out;
  return out;
}

/** Sets keys (an empty string removes one). */
export async function writeSecrets(patch: Secrets): Promise<Secrets> {
  const next: Secrets = { ...(await readSecrets()) };
  for (const field of SECRET_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field]?.trim() ?? "";
    if (value) {
      next[field] = value;
      addSecret(value);
    } else delete next[field];
  }
  const encrypted = canEncrypt();
  const keys: KeysFile["keys"] = {};
  for (const field of SECRET_FIELDS) {
    const value = next[field];
    if (value) keys[field] = encrypted ? safeStorage.encryptString(value).toString("base64") : value;
  }
  const body: KeysFile = { version: 1, encrypted, keys };
  const tmp = `${file()}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file());
  cache = next;
  return next;
}
