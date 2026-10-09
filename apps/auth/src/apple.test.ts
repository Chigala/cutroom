import { decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { appleSecret, hasApple } from "./apple.ts";

describe("Sign in with Apple's client secret", () => {
  it("is a JWT signed with the team's key, for the Services ID, and made once while it's good", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const env = {
      APPLE_SERVICES_ID: "dev.cutroom.signin",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      // As a one-line secret: the newlines written out.
      APPLE_PRIVATE_KEY: (await exportPKCS8(privateKey)).replace(/\n/g, "\\n"),
    };
    expect(hasApple(env)).toBe(true);
    expect(hasApple({ ...env, APPLE_KEY_ID: "" })).toBe(false);

    const now = Date.UTC(2026, 9, 8);
    const secret = await appleSecret(env, now);
    expect(decodeProtectedHeader(secret)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const { payload } = await jwtVerify(secret, publicKey, {
      audience: "https://appleid.apple.com",
      currentDate: new Date(now),
    });
    expect(payload).toMatchObject({ iss: "TEAM123456", sub: "dev.cutroom.signin" });
    expect(payload.exp! - payload.iat!).toBe(30 * 24 * 3600);

    expect(await appleSecret(env, now + 3600_000)).toBe(secret);
    // A day before it runs out, a new one.
    expect(await appleSecret(env, now + 29.5 * 24 * 3600_000)).not.toBe(secret);
  });
});
