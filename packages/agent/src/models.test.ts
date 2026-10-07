import { describe, expect, it } from "vitest";
import { claudeModels } from "./sdk.ts";

const effort = ["low", "medium", "high"] as ("low" | "medium" | "high")[];

describe("Claude's models, as the account offers them", () => {
  it("lists each model once, by the model it runs, with Claude Code's pick marked", () => {
    expect(
      claudeModels([
        {
          value: "default",
          resolvedModel: "claude-opus-5-5",
          displayName: "Default (recommended)",
          description: "Opus 5.5 · Best for everyday, complex tasks",
          supportedEffortLevels: effort,
        },
        {
          value: "opus",
          resolvedModel: "claude-opus-5-5",
          displayName: "Opus 5.5",
          description: "Best for everyday, complex tasks",
          supportedEffortLevels: effort,
        },
        {
          value: "haiku",
          resolvedModel: "claude-haiku-4-5",
          displayName: "Haiku 4.5",
          description: "Fastest",
        },
      ]),
    ).toEqual([
      {
        id: "claude-opus-5-5",
        name: "Opus 5.5",
        description: "Best for everyday, complex tasks",
        efforts: effort,
        isDefault: true,
      },
      { id: "claude-haiku-4-5", name: "Haiku 4.5", description: "Fastest", efforts: [] },
    ]);
  });

  it("names Claude Code's pick from its description when no other row has it", () => {
    expect(
      claudeModels([
        {
          value: "default",
          resolvedModel: "claude-sonnet-5-5",
          displayName: "Default (recommended)",
          description: "Sonnet 5.5 · Efficient for routine tasks",
        },
      ]),
    ).toEqual([
      {
        id: "claude-sonnet-5-5",
        name: "Sonnet 5.5",
        description: "Efficient for routine tasks",
        efforts: [],
        isDefault: true,
      },
    ]);
  });
});
