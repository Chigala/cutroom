import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  app: { isPackaged: true, quit: () => {} },
  shell: { openExternal: async (_url: string) => {} },
}));
vi.mock("electron", () => electron);
vi.mock("./settings.ts", () => ({ getSettings: async () => ({ updates: "stable" }) }));
// The Mac's signature check: a Developer ID, so every system can install (until a download fails).
vi.mock("node:child_process", () => ({
  execFile: (_f: string, _a: string[], _o: object, done: (e: null, out: string, err: string) => void) =>
    done(null, "", "Authority=Developer ID Application: Test (ABCDE12345)"),
}));

/** electron-updater's autoUpdater, as far as updater.ts uses it. */
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = true;
  logger: unknown = null;
  next: "available" | "none" | "offline" = "none";
  download: "ok" | "fail" = "ok";
  installs: [boolean, boolean][] = [];
  async checkForUpdates() {
    this.emit("checking-for-update");
    if (this.next === "offline") {
      const err = new Error("net::ERR_INTERNET_DISCONNECTED");
      this.emit("error", err);
      throw err;
    }
    if (this.next === "available") this.emit("update-available", { version: "0.2.0" });
    else this.emit("update-not-available", { version: "0.1.0" });
  }
  async downloadUpdate() {
    this.emit("download-progress", { percent: 50 });
    if (this.download === "fail") {
      const err = new Error("Could not get code signature for running application");
      this.emit("error", err);
      throw err;
    }
    this.emit("update-downloaded", { version: "0.2.0" });
  }
  quitAndInstall(silent: boolean, runAfter: boolean) {
    this.installs.push([silent, runAfter]);
  }
}

let fake: FakeUpdater;
vi.mock("electron-updater", () => ({
  default: {
    get autoUpdater() {
      return fake;
    },
  },
}));

let mod: typeof import("./updater.ts");
let busy: string | null;
let saved: number;
const sent: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  fake = new FakeUpdater();
  busy = null;
  saved = 0;
  sent.length = 0;
  mod = await import("./updater.ts");
  await mod.startUpdates({
    notify: (s) => sent.push(s.status),
    whyBusy: () => busy,
    saveAll: async () => {
      saved++;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("updates", () => {
  it("never downloads or installs by itself", async () => {
    expect(fake.autoDownload).toBe(false);
    fake.next = "available";
    await mod.checkForUpdates();
    expect(mod.updateState()).toMatchObject({ status: "available", version: "0.2.0", manual: false });
    expect(fake.installs).toEqual([]);
  });

  it("downloads on a click, then restarts into it once nothing is running", async () => {
    fake.next = "available";
    await mod.checkForUpdates();
    await mod.downloadUpdate();
    expect(sent).toContain("downloading");
    expect(mod.updateState()).toMatchObject({ status: "ready", version: "0.2.0" });

    busy = "The agent is still working.";
    await expect(mod.installUpdate()).rejects.toThrow(/agent is still working/);
    expect(saved).toBe(0);

    busy = null;
    await mod.installUpdate();
    expect(saved).toBe(1);
    expect(fake.installs).toEqual([[process.platform === "win32", true]]);
  });

  it("keeps a failed periodic check quiet, and answers one the user asked for", async () => {
    fake.next = "offline";
    await mod.checkForUpdates();
    expect(mod.updateState()).toEqual({ status: "idle" });

    await mod.checkForUpdates(true);
    expect(mod.updateState()).toMatchObject({ status: "error", asked: true });

    fake.next = "none";
    await mod.checkForUpdates(true);
    expect(mod.updateState()).toMatchObject({ status: "current", asked: true });
  });

  it("keeps offering a found version when a later check fails", async () => {
    fake.next = "available";
    await mod.checkForUpdates();
    fake.next = "offline";
    await mod.checkForUpdates(true);
    expect(mod.updateState()).toEqual({ status: "available", version: "0.2.0", manual: false });
  });

  it("falls back to the download page once a download fails, and stays there", async () => {
    fake.next = "available";
    fake.download = "fail";
    await mod.checkForUpdates();
    await mod.downloadUpdate();
    expect(mod.updateState()).toMatchObject({ status: "error", version: "0.2.0", manual: true });

    // The next check offers it again, still from its page.
    await mod.checkForUpdates();
    expect(mod.updateState()).toMatchObject({ status: "available", manual: true });
    const open = vi.spyOn(electron.shell, "openExternal");
    await mod.downloadUpdate();
    expect(open).toHaveBeenCalledWith("https://github.com/Chigala/cutroom/releases/tag/v0.2.0");
  });
});

describe("developerIdSigned", () => {
  it("tells a Developer ID signature from an ad-hoc one", () => {
    expect(
      mod.developerIdSigned(
        "Executable=/Applications/Cutroom.app/Contents/MacOS/Cutroom\nAuthority=Developer ID Application: Jane Doe (ABCDE12345)\nAuthority=Developer ID Certification Authority",
      ),
    ).toBe(true);
    expect(mod.developerIdSigned("Executable=/x\nSignature=adhoc\nTeamIdentifier=not set")).toBe(false);
  });
});
