import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./exec.ts";
import { transcribeGroq } from "./groq.ts";

const dir = mkdtempSync(path.join(tmpdir(), "vedit-groq-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Silent 16 kHz mono speech audio this long. */
async function silence(seconds: number): Promise<string> {
  const file = path.join(dir, `speech-${seconds}s.wav`);
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=16000:cl=mono",
    "-t",
    String(seconds),
    file,
  ]);
  return file;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribing on Groq", () => {
  it("sends long audio in overlapping pieces and keeps every word once, in the recording's time", async () => {
    const wav = await silence(25 * 60);
    const calls: string[] = [];
    // The recording's words, at these times; pieces overlap, so some are heard twice.
    const said = [1, 599, 601, 1199, 1201, 1499];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const form = init.body as FormData;
        calls.push(String(form.get("model")));
        // Pieces start every ten minutes, two seconds early after the first, and run 604 s.
        const start = Math.max(0, (calls.length - 1) * 600 - 2);
        const heard = said.filter((t) => t >= start && t < start + 604);
        return new Response(
          JSON.stringify({
            language: "en",
            words: heard.map((t) => ({ word: ` at${t}`, start: t - start, end: t - start + 0.4 })),
          }),
        );
      }),
    );
    const { words, language } = await transcribeGroq(wav, "gsk_test", { language: "en" });
    expect(calls).toEqual(["whisper-large-v3-turbo", "whisper-large-v3-turbo", "whisper-large-v3-turbo"]);
    expect(language).toBe("en");
    // Every word once, in the recording's time.
    expect(words.map((w) => [w.text, w.start])).toEqual(said.map((t) => [`at${t}`, t]));
  }, 60_000);

  it("says plainly when the key is wrong or the free limit is used up", async () => {
    const wav = await silence(3);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(transcribeGroq(wav, "bad", { language: "en" })).rejects.toThrow(/didn't accept the API key/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429 })),
    );
    await expect(transcribeGroq(wav, "gsk_test", { language: "en" })).rejects.toThrow(/free limit/);
  });
});
