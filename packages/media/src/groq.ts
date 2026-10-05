/**
 * Transcription on Groq: the same whisper model the app runs locally (large-v3-turbo), on Groq's
 * servers, in seconds instead of minutes, with nothing to download. Only the speech audio is sent,
 * compressed (FLAC), in ten-minute pieces to stay under Groq's 25 MB limit. Words come back with their
 * timings, and go through the same clean-up as local transcription.
 */
import { readFile, rm } from "node:fs/promises";
import type { TimedWord } from "@vedit/project";
import { CancelledError, run } from "./exec.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";
/** Seconds per request, and how much neighbouring pieces overlap (no word is cut in two). */
const PIECE = 600;
const OVERLAP = 2;

interface GroqWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

/** Whether a Groq key works: a free call that lists its models (no audio sent). */
export async function checkGroqKey(key: string): Promise<boolean> {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.ok;
}

async function duration(wav: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    wav,
  ]);
  return Number(stdout.trim()) || 0;
}

/** One piece of the audio, transcribed: its words in the recording's time. */
async function piece(
  wav: string,
  from: number,
  length: number,
  key: string,
  o: { language: string; prompt?: string; signal?: AbortSignal },
): Promise<{ words: TimedWord[]; language: string }> {
  const flac = `${wav}.${Math.round(from)}.groq.flac`;
  try {
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-ss",
        String(from),
        "-t",
        String(length),
        "-i",
        wav,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "flac",
        flac,
      ],
      o.signal ? { signal: o.signal } : {},
    );
    const form = new FormData();
    form.append("file", new Blob([await readFile(flac)], { type: "audio/flac" }), "speech.flac");
    form.append("model", MODEL);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.append("temperature", "0");
    if (o.language && o.language !== "auto") form.append("language", o.language);
    // Groq takes up to 224 tokens of prompt: a short hint, never a whole script.
    if (o.prompt) form.append("prompt", o.prompt.slice(0, 600));
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      ...(o.signal && { signal: o.signal }),
    });
    if (res.status === 401)
      throw new Error("Groq didn't accept the API key. Check it in Settings → Transcription.");
    if (res.status === 429)
      throw new Error(
        "Groq's free limit is used up for now. Try again later, or transcribe on this computer.",
      );
    if (!res.ok)
      throw new Error(`Groq couldn't transcribe it (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { words?: GroqWord[]; language?: string };
    return {
      words: (body.words ?? [])
        .filter((w) => w.word.trim())
        .map((w) => ({
          text: w.word.trim(),
          start: Math.round((from + w.start) * 1000) / 1000,
          end: Math.round((from + Math.max(w.end, w.start + 0.04)) * 1000) / 1000,
        })),
      language: body.language ?? o.language,
    };
  } finally {
    await rm(flac, { force: true });
  }
}

/**
 * Words and timings for a speech wav, from Groq. Long recordings go in ten-minute pieces that overlap by
 * two seconds; each keeps the words that start in its own half of the overlap.
 */
export async function transcribeGroq(
  wav: string,
  key: string,
  o: { language: string; prompt?: string; signal?: AbortSignal; onProgress?: (fraction: number) => void },
): Promise<{ words: TimedWord[]; language: string }> {
  const total = await duration(wav);
  const words: TimedWord[] = [];
  let language = o.language;
  for (let from = 0; from < Math.max(total, 0.1); from += PIECE) {
    if (o.signal?.aborted) throw new CancelledError();
    const start = Math.max(0, from - OVERLAP);
    const got = await piece(wav, start, PIECE + OVERLAP * 2, key, o);
    language = got.language;
    // This piece's words: from the middle of the overlap before it to the middle of the one after.
    const lo = from === 0 ? -1 : from;
    const hi = from + PIECE;
    words.push(...got.words.filter((w) => w.start >= lo && w.start < hi));
    o.onProgress?.(Math.min(1, (from + PIECE) / Math.max(total, 1)));
  }
  return { words, language };
}
