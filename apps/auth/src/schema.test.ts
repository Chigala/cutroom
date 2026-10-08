import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vitest";
import { authOptions } from "./auth.ts";
import { testEnv } from "./testing.ts";

describe("the account database", () => {
  it("has every table and column Better Auth wants, from the migrations alone", async () => {
    const m = await getMigrations(await authOptions(testEnv(), "https://auth.test"));
    const missing = [...m.toBeCreated, ...m.toBeAdded].length + m.toBeAddedIndexes.length;
    // Failing after an upgrade: this is the next migration's SQL.
    expect(missing, await m.compileMigrations()).toBe(0);
  });
});
