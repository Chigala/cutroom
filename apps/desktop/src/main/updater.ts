/**
 * Cutroom's own updates, from the GitHub releases electron-builder.yml publishes to. Nothing downloads or
 * installs by itself: the header's pill says a new version is out, a click downloads it, and another
 * restarts into it (else it installs at the next quit). The `updates` setting says whether to look, and
 * whether pre-releases count ("beta").
 *
 * A Mac app can only replace itself when it's signed with a Developer ID: until the builds are, a Mac
 * finds the new version the same way and the pill opens its download page instead.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { UpdateState } from "@vedit/bridge";
import { app, shell } from "electron";
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { getSettings } from "./settings.ts";

/** The first look waits until the app has settled; then one every few hours while it stays open. */
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 4 * 60 * 60_000;

let state: UpdateState = { status: "off" };
let updater: AppUpdater | null = null;
let send: (s: UpdateState) => void = () => {};
let busy: () => string | null = () => null;
let beforeInstall: () => Promise<void> = async () => {};
/** The last check was asked for by the user (the menu, Settings): they hear about "up to date" too. */
let asked = false;
/** A download the user started: its failure is shown, not kept quiet like a failed check. */
let downloading = false;
/**
 * This copy can't install updates itself: a Mac build without a Developer ID, or one whose download or
 * install failed (run from the disk image, say). The pill then opens the version's download page.
 */
let manual = false;

function set(next: UpdateState): void {
  state = next;
  send(state);
}

export const updateState = (): UpdateState => state;

/**
 * What a restart would cut short, in the user's words, or null when nothing is: the agent, an export,
 * indexing, a download, a Claude Code install. Not the background passes (reading pictures, describing
 * shots): they pick up again by themselves after a restart.
 */
export function busyReason(now: {
  agentRuns: number;
  exporting: boolean;
  indexing: number;
  downloading: readonly string[];
  claudeTask: "install" | "login" | "update" | null;
}): string | null {
  if (now.agentRuns) return "The agent is still working.";
  if (now.exporting) return "An export is still running.";
  if (now.indexing)
    return `${now.indexing === 1 ? "A clip is" : `${now.indexing} clips are`} still being indexed.`;
  const [one, ...more] = now.downloading;
  if (one)
    return `${more.length ? `${now.downloading.length} downloads are` : `${one} is`} still downloading.`;
  if (now.claudeTask)
    return `Claude Code is still ${{ install: "installing", login: "signing in", update: "updating" }[now.claudeTask]}.`;
  return null;
}

/**
 * Where people download a version by hand: the releases the updater reads, as electron-builder wrote them
 * into the app (app-update.yml, from electron-builder.yml's `publish`).
 */
function releasesPage(): string {
  try {
    const yml = readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const owner = /^owner: *(\S+)/m.exec(yml)?.[1];
    const repo = /^repo: *(\S+)/m.exec(yml)?.[1];
    if (owner && repo) return `https://github.com/${owner}/${repo}/releases`;
  } catch {}
  return "https://github.com/Chigala/cutroom/releases";
}

/**
 * Whether this Mac app carries a Developer ID signature (what Squirrel.Mac checks before it swaps the app).
 * A build signed only ad hoc can find updates but not install them.
 */
export function developerIdSigned(codesignOutput: string): boolean {
  return /^Authority=Developer ID Application:/m.test(codesignOutput);
}

function macCanInstall(): Promise<boolean> {
  // …/Cutroom.app/Contents/MacOS/Cutroom → …/Cutroom.app
  const bundle = path.resolve(process.execPath, "../../..");
  return new Promise((ok) =>
    // codesign writes what it found to stderr.
    execFile("codesign", ["-dv", "--verbose=2", bundle], { timeout: 10_000 }, (_err, stdout, stderr) =>
      ok(developerIdSigned(`${stdout}\n${stderr}`)),
    ),
  );
}

/**
 * Starts looking for updates (installed copies only: one run from the repo has nothing to update).
 * `notify` passes each new state to the window; `whyBusy` says what a restart would cut short, if anything;
 * `saveAll` saves and stops everything before the installer takes over.
 */
export async function startUpdates(opts: {
  notify: (s: UpdateState) => void;
  whyBusy: () => string | null;
  saveAll: () => Promise<void>;
}): Promise<void> {
  send = opts.notify;
  busy = opts.whyBusy;
  beforeInstall = opts.saveAll;
  if (!app.isPackaged) return;
  manual = process.platform === "darwin" && !(await macCanInstall());
  const u = electronUpdater.autoUpdater;
  updater = u;
  // A release tried out before it's published: a folder of its files served at this address.
  const feed = process.env.VEDIT_UPDATE_FEED;
  if (feed) u.setFeedURL({ provider: "generic", url: feed });
  u.autoDownload = false;
  u.autoInstallOnAppQuit = true;
  u.logger = {
    info: (m: unknown) => console.log("[update]", String(m)),
    warn: (m: unknown) => console.warn("[update]", String(m)),
    error: (m: unknown) => console.warn("[update]", String(m)),
    debug: () => {},
  };
  // Shown only while nothing's found yet: a version already offered stays offered.
  u.on("checking-for-update", () => {
    if (!state.version) set({ status: "checking" });
  });
  u.on("update-available", (info: UpdateInfo) =>
    set({ status: "available", version: info.version, manual, checkedAt: Date.now() }),
  );
  u.on("update-not-available", () =>
    set({ status: "current", checkedAt: Date.now(), ...(asked && { asked: true }) }),
  );
  u.on("download-progress", (p: ProgressInfo) =>
    set({ status: "downloading", version: state.version, fraction: p.percent / 100 }),
  );
  u.on("update-downloaded", (info: UpdateInfo) => {
    downloading = false;
    set({ status: "ready", version: info.version });
  });
  u.on("error", (err: Error) => {
    const message = err.message.split("\n")[0]!.slice(0, 300);
    if (downloading && state.version) {
      // From now on the pill opens the version's download page instead.
      downloading = false;
      manual = true;
      set({ status: "error", version: state.version, manual, error: message });
      return;
    }
    downloading = false;
    if (asked && !state.version) {
      set({ status: "error", asked: true, error: message });
      return;
    }
    // Offline, or GitHub didn't answer: say nothing (it looks again later); what was found stays offered.
    set(state.version ? { status: "available", version: state.version, manual } : { status: "idle" });
  });
  // Errors also arrive as rejections: the "error" event above has them.
  u.on("update-cancelled", () => {
    downloading = false;
  });
  set({ status: "idle" });
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(), EVERY_MS).unref();
}

/** Looks for a newer version now. `user`: asked from the menu or Settings, so "up to date" is shown too. */
export async function checkForUpdates(user = false): Promise<UpdateState> {
  const u = updater;
  if (!u) return state;
  // Already found, downloading or ready: nothing new to learn.
  if (state.status === "downloading" || state.status === "ready") return state;
  const { updates } = await getSettings();
  if (updates === "off" && !user) return state;
  // Beta also takes pre-releases (tagged v0.3.0-beta.1, marked pre-release on GitHub); neither goes back
  // to an older version. No channel files: on GitHub the release's tag says what it is.
  u.allowPrerelease = updates === "beta";
  u.allowDowngrade = false;
  asked = user;
  try {
    await u.checkForUpdates();
  } catch {
    // Reported through the "error" event.
  } finally {
    asked = false;
  }
  return state;
}

/** Downloads the version found; where this copy can't install it, opens its download page instead. */
export async function downloadUpdate(): Promise<void> {
  const u = updater;
  if (!u || !state.version) return;
  if (state.manual) {
    await shell.openExternal(`${releasesPage()}/tag/v${encodeURIComponent(state.version)}`);
    return;
  }
  if (state.status !== "available") return;
  downloading = true;
  set({ status: "downloading", version: state.version, fraction: 0 });
  try {
    await u.downloadUpdate();
  } catch {
    // Reported through the "error" event.
  }
}

/** Restarts into the downloaded version, unless that would cut short something running. */
export async function installUpdate(): Promise<void> {
  const u = updater;
  if (!u || state.status !== "ready") return;
  const why = busy();
  if (why) throw new Error(`${why} Restart once it's done, or quit Cutroom later to update.`);
  // Everything saved first: Windows' installer closes the app if it's still running when it starts.
  await beforeInstall();
  // Quietly on Windows (the installer's own pages are for a first install), and reopened after.
  try {
    u.quitAndInstall(process.platform === "win32", true);
  } catch (err) {
    // Everything's already saved and stopped: quit anyway, and it installs on the way out.
    console.warn("[update] couldn't restart into the update:", (err as Error).message);
    app.quit();
  }
}
