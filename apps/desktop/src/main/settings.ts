import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Settings } from "@vedit/bridge";
import { app } from "electron";
import { readSecrets, SECRET_FIELDS, type SecretField, type Secrets, writeSecrets } from "./secrets.ts";

/** App-level folders. Projects keep their own caches; these are shared across projects. */
export const paths = {
  settings: () => path.join(app.getPath("userData"), "settings.json"),
  recent: () => path.join(app.getPath("userData"), "recent.json"),
  /** The designs of recent videos, so a new one's can be held apart from them (designs.ts). */
  designs: () => path.join(app.getPath("userData"), "designs.json"),
  /** The projects (folders of videos) in the sidebar. */
  folders: () => path.join(app.getPath("userData"), "folders.json"),
  demo: () => path.join(app.getPath("userData"), "Demo Project"),
  cache: () => path.join(app.getPath("userData"), "cache"),
  remotionBundle: () => path.join(app.getPath("userData"), "cache", "remotion-bundle"),
  /** whisper.cpp and its models. VEDIT_WHISPER_DIR points at an existing install (development). */
  whisper: () => process.env.VEDIT_WHISPER_DIR ?? path.join(app.getPath("userData"), "tools", "whisper.cpp"),
  cleaner: () => path.join(app.getPath("userData"), "tools", "deep-filter"),
  /** The on-device sound classifier (hear.ts in @vedit/media), compiled on first use. */
  hear: () => path.join(app.getPath("userData"), "tools", "hear"),
};

let current: Settings | null = null;
/** The file's modification time when `current` was read or written. */
let readAt = "";
/** settings.json is there but couldn't be read: it's set aside, not overwritten, at the next save. */
let unreadable = false;

/**
 * What settings.json looks like on disk, to tell when it changed: its time and its size. The time alone
 * misses quick edits on Windows, where it can lag behind the write.
 */
const mtime = () =>
  stat(paths.settings())
    .then((s) => `${s.mtimeMs}:${s.size}`)
    .catch(() => "");

const DEFAULTS = Settings.parse({});
const NO_SECRETS = Object.fromEntries(SECRET_FIELDS.map((f) => [f, ""])) as Record<SecretField, string>;

/**
 * Written aside and moved in (a crash mid-save can't leave half a file), and only what differs from the
 * defaults, so a default that improves in a later version reaches everyone who never changed it.
 */
async function writeSettingsFile(s: Settings): Promise<void> {
  const changed = Object.fromEntries(
    Object.entries(s).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULTS[k as keyof Settings])),
  );
  const tmp = `${paths.settings()}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(changed, null, 2)}\n`);
  await rename(tmp, paths.settings());
  readAt = await mtime();
}

/**
 * The settings with the API keys (main process only: the window gets `publicSettings`). Read again
 * whenever settings.json changed on disk (edited by hand, or by another copy of the app), so it's
 * never overwritten by a stale copy. Keys found in it (an older version kept them there, or they were
 * pasted in by hand) move to the keychain.
 */
export async function getSettings(): Promise<Settings> {
  const at = await mtime();
  if (!current || at !== readAt) {
    let text: string | null = null;
    try {
      text = await readFile(paths.settings(), "utf8");
    } catch {}
    readAt = at;
    if (text === null) current ??= DEFAULTS;
    else {
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        const found: Secrets = {};
        for (const f of SECRET_FIELDS)
          if (typeof json[f] === "string" && json[f]) found[f] = json[f] as string;
        current = Settings.parse({ ...json, ...NO_SECRETS });
        unreadable = false;
        if (Object.keys(found).length) {
          await writeSecrets(found);
          await writeSettingsFile(current);
          console.log(`[settings] moved ${Object.keys(found).join(", ")} from settings.json to the keychain`);
        }
      } catch (err) {
        // Half-written or broken by hand: keep what we had (or the defaults) until it's fixed.
        unreadable = true;
        current ??= DEFAULTS;
        console.warn("[settings] settings.json couldn't be read:", (err as Error).message.slice(0, 200));
      }
    }
  }
  return { ...current, ...(await readSecrets()) };
}

/** Settings as the editor's window sees them: the API keys left out (it learns whether each is set). */
export const publicSettings = (s: Settings): Settings => ({ ...s, ...NO_SECRETS });

export async function setSettings(patch: unknown): Promise<Settings> {
  // Only the fields the patch names: zod fills every other field with its default, and those would
  // overwrite what's saved (a change of effort used to reset the model, the backend and the keys).
  const input = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const checked = Settings.partial().parse(input);
  const parsed = Object.fromEntries(
    Object.keys(input)
      .filter((k) => k in checked)
      .map((k) => [k, checked[k as keyof Settings]]),
  ) as Partial<Settings>;
  const keys: Secrets = {};
  for (const f of SECRET_FIELDS) if (f in parsed) keys[f] = parsed[f] ?? "";
  if (Object.keys(keys).length) await writeSecrets(keys);
  // Merged onto the file as it is now (getSettings re-reads it when it changed).
  await getSettings();
  const next = Settings.parse({ ...current, ...parsed, ...NO_SECRETS });
  if (unreadable) {
    const aside = paths.settings().replace(/\.json$/, `.unreadable-${Date.now()}.json`);
    await rename(paths.settings(), aside).catch(() => {});
    console.warn(`[settings] the unreadable settings.json was kept as ${path.basename(aside)}`);
    unreadable = false;
  }
  current = next;
  await writeSettingsFile(next);
  return getSettings();
}

/**
 * How speech gets transcribed with these settings: whisper on this computer, or on Groq when that's
 * chosen and there's a key in Settings.
 */
export function whisperSetup(s: Settings) {
  const groqKey = s.transcriber === "groq" ? s.groqKey : "";
  return {
    dir: paths.whisper(),
    model: s.whisperModel,
    language: s.language,
    ...(groqKey && { groqKey }),
  };
}
