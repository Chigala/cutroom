import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ensureModel } from "./models.ts";
import { STEM_WINDOW } from "./separate.ts";
import { startVoiceWorker } from "./voice-worker.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-voice-worker-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the voice model's own process", () => {
  it("says plainly when the model won't load, and doesn't hang", async () => {
    const broken = path.join(dir, "broken.onnx");
    writeFileSync(broken, "not a model");
    await expect(startVoiceWorker(broken)).rejects.toThrow(/The voice model failed/);
  }, 30_000);

  // The real model (166 MB, downloaded once): VEDIT_MODEL_TESTS=1.
  it.skipIf(!process.env.VEDIT_MODEL_TESTS)(
    "runs the model, and a crash there ends the separation, not this process",
    async () => {
      const worker = await startVoiceWorker(await ensureModel("voices"));
      const mix = new Float32Array(2 * STEM_WINDOW).map((_, i) => Math.sin(i / 20) * 0.2);
      const voice = await worker.run(mix, STEM_WINDOW);
      expect(voice.length).toBe(2 * STEM_WINDOW);
      // A crash in the native library, as the arena's once was inside Electron.
      process.kill(worker.pid!, "SIGKILL");
      await expect(worker.run(mix, STEM_WINDOW)).rejects.toThrow(/The voice model stopped/);
      expect(process.pid).toBeGreaterThan(0);
      worker.close();
    },
    120_000,
  );
});
