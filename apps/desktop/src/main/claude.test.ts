import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const settings = { claudePath: "" };
vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("./settings.ts", () => ({ getSettings: async () => settings }));

const { claudeStatus, compareVersions, fromAccount } = await import("./claude.ts");
// Finding Claude Code reads PATH from a login shell, which can take seconds while other tests run.
vi.setConfig({ testTimeout: 30_000 });
// The stand-in below is a shell script, and finding Claude Code reads PATH from a Unix login shell.
const unix = process.platform !== "win32";

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
  it("is ready on a Claude plan, and not on an API key, which Claude Code uses ahead of the plan", () => {
    expect(
      fromAccount({ subscriptionType: "Claude Max", email: "a@example.com", apiProvider: "firstParty" }),
    ).toMatchObject({
      signedIn: true,
      method: "Claude Max",
      email: "a@example.com",
    });
    // Signed in with a plan, and a key from a Console sign-in: the key is what would be billed.
    const key = fromAccount({
      subscriptionType: "Claude Max",
      apiKeySource: "/login managed key",
      apiProvider: "firstParty",
    });
    expect(key).toMatchObject({ signedIn: false, method: "API key" });
    expect(key.apiKey).toMatch(/Console/);
    expect(fromAccount({ apiKeySource: "ANTHROPIC_API_KEY" }).apiKey).toMatch(/^ANTHROPIC_API_KEY/);
    // A company's cloud provider runs the agent too.
    expect(fromAccount({ apiProvider: "bedrock" })).toMatchObject({
      signedIn: true,
      method: "Amazon Bedrock",
    });
    expect(fromAccount({ apiProvider: "firstParty" })).toEqual({ signedIn: false });
  });

  it("compares versions", () => {
    expect(compareVersions("2.1.283", "2.1.286")).toBe(-1);
    expect(compareVersions("2.2.0", "2.1.286")).toBe(1);
    expect(compareVersions("2.1.111", "2.1.111")).toBe(0);
  });

  it.skipIf(!unix)(
    "reads the version and sign-in of the Claude Code in Settings, and points the agent at it",
    async () => {
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
    },
  );

  it.skipIf(!unix)("says when it's signed out or too old", async () => {
    settings.claudePath = fakeClaude("2.0.1", { loggedIn: false, authMethod: "none" });
    expect(await claudeStatus(true)).toMatchObject({ signedIn: false, versionState: "unsupported" });
  });

  it.skipIf(!unix)(
    "reports a missing path as missing, and stops pointing the agent at anything",
    async () => {
      settings.claudePath = "/nowhere/claude";
      expect(await claudeStatus(true)).toMatchObject({ source: "missing", path: "/nowhere/claude" });
      expect(process.env.VEDIT_CLAUDE_BIN).toBeUndefined();
    },
  );
});
