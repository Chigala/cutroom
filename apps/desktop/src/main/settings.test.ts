import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-settings-"));
vi.mock("electron", () => ({
  app: { getPath: () => dir, whenReady: async () => {}, isPackaged: false },
  // A stand-in keychain: reversible, and visibly not the plain key.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`sealed:${[...s].reverse().join("")}`),
    decryptString: (b: Buffer) => [...b.toString().replace(/^sealed:/, "")].reverse().join(""),
  },
}));

const { getSettings, publicSettings, setSettings } = await import("./settings.ts");
const { scrub } = await import("./log.ts");
const settingsFile = path.join(dir, "settings.json");
const KEY = "klipy-test-key-0123456789";

describe("settings", () => {
  it("moves keys out of settings.json into the keychain file, and never hands them to the window", async () => {
    writeFileSync(settingsFile, JSON.stringify({ effort: "high", klipyKey: KEY }));
    const s = await getSettings();
    expect(s.klipyKey).toBe(KEY);
    expect(s.effort).toBe("high");
    expect(readFileSync(settingsFile, "utf8")).not.toContain(KEY);
    const stored = readFileSync(path.join(dir, "keys.json"), "utf8");
    expect(stored).not.toContain(KEY);
    expect(JSON.parse(stored).encrypted).toBe(true);
    expect(publicSettings(s).klipyKey).toBe("");
  });

  it("writes only what differs from the defaults, and keys go to the keychain file", async () => {
    await setSettings({ model: "claude-sonnet-5-5", pexelsKey: "pexels-test-key-123" });
    const file = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(file).toEqual({ effort: "high", model: "claude-sonnet-5-5" });
    expect((await getSettings()).pexelsKey).toBe("pexels-test-key-123");
    await setSettings({ pexelsKey: "" });
    expect((await getSettings()).pexelsKey).toBe("");
  });

  it("changes only what a save names: the model, the backend and the keys stay", async () => {
    await setSettings({ backend: "subscription", model: "claude-sonnet-5-5", klipyKey: KEY });
    await setSettings({ effort: "max" });
    const s = await getSettings();
    expect([s.backend, s.model, s.effort, s.klipyKey]).toEqual([
      "subscription",
      "claude-sonnet-5-5",
      "max",
      KEY,
    ]);
    await setSettings({ backend: "auto", effort: "high", model: "claude-sonnet-5-5" });
  });

  it("keeps an unreadable settings.json aside instead of writing over it", async () => {
    writeFileSync(settingsFile, "{ not json");
    // Read again after the change (the file's time moved on).
    await new Promise((r) => setTimeout(r, 20));
    const s = await getSettings();
    expect(s.effort).toBe("high");
    await setSettings({ effort: "low" });
    const aside = readdirSync(dir).find((f) => f.startsWith("settings.unreadable-"));
    expect(aside).toBeDefined();
    expect(readFileSync(path.join(dir, aside!), "utf8")).toBe("{ not json");
    expect(JSON.parse(readFileSync(settingsFile, "utf8")).effort).toBe("low");
    expect(existsSync(settingsFile)).toBe(true);
  });

  it("takes keys out of log lines", () => {
    expect(scrub(`GET https://api.klipy.com/api/v1/${KEY}/gifs/search`)).toBe(
      "GET https://api.klipy.com/api/v1/‹key›/gifs/search",
    );
    expect(scrub("token sk-ant-api03-abcdefghijklmnop rejected")).toBe("token ‹key› rejected");
  });
});
