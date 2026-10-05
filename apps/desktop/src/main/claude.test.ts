import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const settings = { claudePath: "" };
vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("./settings.ts", () => ({ getSettings: async () => settings }));

const { claudeStatus, compareVersions } = await import("./claude.ts");
// Finding Claude Code reads PATH from a login shell, which can take seconds while other tests run.
vi.setConfig({ testTimeout: 30_000 });

/** A stand-in for Claude Code that answers `--version` and `auth status`. */
function fakeClaude(version: string, auth: object): string {
  const dir = mkdtempSync(path.join(tmpdir(), "vedit-claude-"));
  const file = path.join(dir, "claude");
  writeFileSync(
    file,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ]; then echo '${JSON.stringify(auth)}'; exit ${"loggedIn" in auth && auth.loggedIn ? 0 : 1}; fi
exit 2
`,
  );
  chmodSync(file, 0o755);
  return file;
}

describe("claude", () => {
  it("compares versions", () => {
    expect(compareVersions("2.1.283", "2.1.286")).toBe(-1);
    expect(compareVersions("2.2.0", "2.1.286")).toBe(1);
    expect(compareVersions("2.1.111", "2.1.111")).toBe(0);
  });

  it("reads the version and sign-in of the Claude Code in Settings, and points the agent at it", async () => {
    settings.claudePath = fakeClaude("9.0.0", {
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      subscriptionType: "max",
      email: "a@example.com",
    });
    const s = await claudeStatus(true);
    expect(s).toMatchObject({
      source: "custom",
      version: "9.0.0",
      versionState: "ok",
      signedIn: true,
      method: "Claude Max",
      email: "a@example.com",
    });
    expect(process.env.VEDIT_CLAUDE_BIN).toBe(settings.claudePath);
  });

  it("says when it's signed out or too old", async () => {
    settings.claudePath = fakeClaude("2.0.1", { loggedIn: false, authMethod: "none" });
    expect(await claudeStatus(true)).toMatchObject({ signedIn: false, versionState: "unsupported" });
  });

  it("reports a missing path as missing, and stops pointing the agent at anything", async () => {
    settings.claudePath = "/nowhere/claude";
    expect(await claudeStatus(true)).toMatchObject({ source: "missing", path: "/nowhere/claude" });
    expect(process.env.VEDIT_CLAUDE_BIN).toBeUndefined();
  });
});
