import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WHISPER_VERSION, whisperProgram } from "./whisper.ts";

describe("whisperProgram", () => {
  it("is the program the whisper library runs, so a missing one is caught before it's spawned", () => {
    // The library's own path, from its install code (not exported from its entry point).
    const lib = path.join(
      path.dirname(createRequire(import.meta.url).resolve("@remotion/install-whisper-cpp")),
      "install-whisper-cpp.js",
    );
    const { getWhisperExecutablePath } = createRequire(import.meta.url)(lib) as {
      getWhisperExecutablePath: (dir: string, version: string) => string;
    };
    expect(whisperProgram("/tools/whisper")).toBe(
      path.normalize(getWhisperExecutablePath("/tools/whisper", WHISPER_VERSION)),
    );
  });
});
