import { describe, expect, it } from "vitest";
import { took } from "./duration.ts";

describe("how long it took", () => {
  it("says seconds, then minutes and seconds, then hours and minutes", () => {
    expect(took(200)).toBe("1s");
    expect(took(45_000)).toBe("45s");
    expect(took(181_000)).toBe("3m 1s");
    expect(took(3_840_000)).toBe("1h 4m");
  });
});
