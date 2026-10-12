import { describe, expect, it } from "vitest";
import { modelName } from "./model-name.ts";

describe("modelName", () => {
  it("says a model the way people do", () => {
    expect(modelName("claude", "claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude", "claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelName("claude", "claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("codex", "")).toBe("Codex");
    expect(modelName("codex", "gpt-5.6-luna")).toBe("gpt-5.6-luna");
  });
});
