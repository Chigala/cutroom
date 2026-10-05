/**
 * Local transcription with whisper.cpp: word timings, and nothing leaves the machine. The binary ships
 * with the app (built from source on first use where it doesn't); the model downloads once into the
 * app's tools folder (the big download, so it reports progress).
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  downloadWhisperModel,
  installWhisperCpp,
  type Language,
  toCaptions,
  transcribe as whisper,
} from "@remotion/install-whisper-cpp";
import type { TimedWord } from "@vedit/project";
import { downloadReporter, downloadVerified } from "./downloads.ts";
import { bundledTool } from "./exec.ts";
import { transcribeGroq } from "./groq.ts";

export const WHISPER_VERSION = "1.7.5";
export const WHISPER_MODELS = ["small.en", "medium.en", "large-v3-turbo", "large-v3-turbo-light"] as const;
export type WhisperModelName = (typeof WHISPER_MODELS)[number];

/**
 * "Light": the same large-v3-turbo, compressed (q5) to a third of the size. Measured on real clips:
 * identical words on clean speech, but 14-20% of words differed on noisy streams, so it's the choice for
 * small disks and slow connections, not the default.
 */
const LIGHT = {
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin",
  sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
  size: 574_041_195,
};

/** Where a model's file lives, and the name whisper knows it by (Light passes for the full model). */
const modelFile = (setup: WhisperSetup) =>
  setup.model === "large-v3-turbo-light"
    ? { folder: path.join(setup.dir, "light"), model: "large-v3-turbo" as const }
    : { folder: setup.dir, model: setup.model };

/** Download sizes, for the download list (whisper.cpp's own downloader reports bytes as it goes). */
const SIZES: Record<WhisperModelName, number> = {
  "small.en": 487_614_201,
  "medium.en": 1_533_774_781,
  "large-v3-turbo": 1_624_555_275,
  "large-v3-turbo-light": LIGHT.size,
};

export interface WhisperSetup {
  /** Folder whisper.cpp lives in (it holds the models too). */
  readonly dir: string;
  readonly model: WhisperModelName;
  /** "en", or "auto" to detect. */
  readonly language: string;
  /** Transcribe on Groq with this key instead of on this computer (nothing to download then). */
  readonly groqKey?: string;
}

const ready = new Map<string, Promise<void>>();

/** The whisper.cpp the app ships (whisper/build/bin/whisper-cli in its tools folder), or null. */
function shippedWhisper(): string | null {
  const cli = bundledTool("whisper", "build", "bin", "whisper-cli");
  return cli ? path.dirname(path.dirname(path.dirname(cli))) : null;
}

/**
 * Downloads the model if needed (into setup.dir), and installs whisper.cpp there too unless the app
 * ships it. Concurrent callers share one install.
 */
export function ensureWhisper(
  setup: WhisperSetup,
  onProgress?: (text: string, fraction: number) => void,
): Promise<void> {
  // On Groq there's nothing to install.
  if (setup.groqKey) return Promise.resolve();
  const key = `${setup.dir}|${setup.model}`;
  let hit = ready.get(key);
  if (!hit) {
    hit = (async () => {
      onProgress?.("Setting up speech recognition", 0);
      // Shipped with the app, or built from source here (which needs Apple's developer tools).
      if (!shippedWhisper())
        await installWhisperCpp({ to: setup.dir, version: WHISPER_VERSION, printOutput: false });
      await mkdir(setup.dir, { recursive: true });
      const report = downloadReporter(`whisper:${setup.model}`, "Speech recognition", SIZES[setup.model]);
      const { folder, model } = modelFile(setup);
      if (setup.model === "large-v3-turbo-light") {
        const file = path.join(folder, `ggml-${model}.bin`);
        if (!existsSync(file))
          await downloadVerified(LIGHT.url, file, LIGHT.sha256, report, (f) =>
            onProgress?.("Downloading the speech model", f),
          );
      } else {
        let reported = false;
        try {
          await downloadWhisperModel({
            model,
            folder,
            printOutput: false,
            onProgress: (done, total) => {
              reported = true;
              report.progress(total ? done / total : 0);
              onProgress?.("Downloading the speech model", total ? done / total : 0);
            },
          });
        } catch (err) {
          if (reported) report.failed(err);
          throw err;
        }
        if (reported) report.done();
      }
    })().catch((err: unknown) => {
      ready.delete(key);
      throw err;
    });
    ready.set(key, hit);
  }
  return hit;
}

/** A token of whisper's JSON output, with its DTW-aligned time (centiseconds; -1 without alignment). */
interface DtwToken {
  readonly text: string;
  readonly t_dtw: number;
  readonly offsets: { readonly from: number; readonly to: number };
}

/**
 * Word timings from whisper's DTW alignment, which follows the audio (each token placed by the model's
 * own attention), instead of its segment offsets, which drift: measured half a second early in places,
 * and a cut placed on them clips the word. A token's aligned time marks where it ends; a word starts
 * where the token before it ended (a word after a long pause gets a start sized to it: the voice onset
 * correction then finds the real one). Null when the output has no alignment.
 */
export function wordsFromDtw(
  items: readonly { readonly tokens?: readonly DtwToken[] }[],
): TimedWord[] | null {
  const tokens = items
    .flatMap((i) => i.tokens ?? [])
    .filter((t) => !/^\s*\[_/.test(t.text) && !/^\s*<\|/.test(t.text));
  if (!tokens.length || tokens.some((t) => t.t_dtw < 0)) return null;
  const words: { text: string; start: number; end: number }[] = [];
  let prevEnd = Math.max(0, tokens[0]!.offsets.from / 1000);
  for (const t of tokens) {
    const at = t.t_dtw / 100;
    const spoken = /[\p{L}\p{N}]/u.test(t.text);
    // A new word: a token with a leading space, or a currency or tag sign after a word ("selling" "$10").
    const fresh =
      words.length === 0 ||
      /^\s/.test(t.text) ||
      (/^[$€£¥#@]/u.test(t.text) && /\p{L}$/u.test(words.at(-1)?.text ?? ""));
    if ((spoken || /^[$€£¥#@]/u.test(t.text.trim())) && fresh) {
      words.push({ text: t.text.trim(), start: prevEnd, end: Math.max(at, prevEnd + 0.04) });
    } else if (words.length) {
      // Continues the word (a word piece, or punctuation, which doesn't move its end).
      const w = words.at(-1)!;
      w.text += t.text.trim() ? t.text.replace(/^\s+/, "") : "";
      if (spoken) w.end = Math.max(at, w.end);
    }
    prevEnd = Math.max(prevEnd, at);
  }
  return words
    .filter((w) => w.text.trim() && !/^\s*[[(].*[\])]\s*$/.test(w.text))
    .map((w) => {
      const letters = w.text.replace(/[^\p{L}\p{N}]/gu, "").length;
      // A word can't take longer than a slow speaker needs: anything more is the pause before it.
      const longest = 0.35 + 0.09 * letters;
      const start = w.end - w.start > longest ? w.end - (0.12 + 0.07 * letters) : w.start;
      return {
        text: w.text.trim(),
        start: Math.round(start * 1000) / 1000,
        end: Math.round(w.end * 1000) / 1000,
      };
    });
}

/** Words with timings, in seconds. Non-speech markers like "[MUSIC]" are dropped. */
export async function transcribeWords(
  wav: string,
  setup: WhisperSetup,
  {
    glossary = [],
    prompt,
    onProgress,
    signal,
  }: {
    glossary?: readonly string[];
    /** What to expect (the words, names, "singing"): guides a second listen to a short stretch. */
    prompt?: string;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ words: TimedWord[]; language: string }> {
  if (setup.groqKey) {
    const got = await transcribeGroq(wav, setup.groqKey, {
      language: setup.language,
      ...(prompt && { prompt }),
      ...(signal && { signal }),
      ...(onProgress && { onProgress }),
    });
    return { words: spellLike(cleanHallucinations(got.words), glossary), language: got.language };
  }
  await ensureWhisper(setup);
  const output = await whisper({
    inputPath: wav,
    // The app's whisper.cpp when it ships one; the model always lives in setup.dir.
    whisperPath: shippedWhisper() ?? setup.dir,
    modelFolder: modelFile(setup).folder,
    whisperCppVersion: WHISPER_VERSION,
    model: modelFile(setup).model,
    tokenLevelTimestamps: true,
    language: (setup.model.endsWith(".en") ? "en" : setup.language) as Language,
    splitOnWord: true,
    printOutput: false,
    // Long recordings send whisper into loops ("He is a master of science in physics" for half an
    // hour) when it conditions on what it just wrote, and it hears "Thank you." in engine roar and
    // applause. No carried-over context stops the loops; suppressing non-speech tokens helps with
    // noise. (No context also means no glossary prompt: names get fixed in the captions instead.)
    additionalArgs: ["--max-context", "0", "--suppress-nst", ...(prompt ? ["--prompt", prompt] : [])],
    ...(onProgress && { onProgress }),
    ...(signal && { signal }),
  });
  // The aligned timings when whisper gave them (it does with token timestamps); its offsets otherwise.
  const aligned = wordsFromDtw(output.transcription as never);
  const { captions } = toCaptions({ whisperCppOutput: output });
  const words =
    aligned ??
    captions
      .filter((c) => c.text.trim() !== "" && !/^\s*[[(].*[\])]\s*$/.test(c.text))
      .map((c) => ({
        text: c.text.trim(),
        start: Math.round(c.startMs) / 1000,
        end: Math.round(Math.max(c.endMs, c.startMs + 40)) / 1000,
      }));
  return {
    words: spellLike(cleanHallucinations(words), glossary),
    language: output.result.language || setup.language,
  };
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** Names whisper nearly got ("Reed" for Reid): spelled the way the glossary has them. */
export function spellLike(words: readonly TimedWord[], glossary: readonly string[]): TimedWord[] {
  const terms = glossary.flatMap((g) => g.split(/\s+/)).filter((t) => t.length >= 4);
  if (!terms.length) return [...words];
  return words.map((w, i) => {
    const m = /^([^\p{L}\p{N}]*)([\p{L}\p{N}'-]+)([^\p{L}\p{N}]*)$/u.exec(w.text);
    if (!m) return w;
    const core = m[2]!;
    // Only names: capitalised mid-sentence (whisper writes names that way), so "Read this." stays.
    const sentenceStart = i === 0 || /[.!?]["')\]]?$/.test(words[i - 1]!.text);
    if (sentenceStart || core[0] !== core[0]!.toUpperCase() || core[0] === core[0]!.toLowerCase()) return w;
    const hit = terms.find((t) => {
      if (t.toLowerCase() === core.toLowerCase() || t[0]!.toLowerCase() !== core[0]!.toLowerCase())
        return false;
      return distance(t.toLowerCase(), core.toLowerCase()) <= (t.length >= 7 ? 2 : 1);
    });
    return hit ? { ...w, text: `${m[1]}${hit}${m[3]}` } : w;
  });
}

/** What whisper says when there's no speech: applause, music, engines. */
const FILLER = /^(thank you|thanks for watching|thank you for watching|you|bye|okay|music|applause)$/;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, "")
    .trim();

/**
 * Drops what whisper made up: a sentence repeated three or more times in a row is a loop (kept once),
 * and a transcript that is nothing but filler ("Thank you." over a rocket launch) is no speech at all.
 */
export function cleanHallucinations(words: readonly TimedWord[]): TimedWord[] {
  // Sentences: runs of words ending in . ! or ?
  const sentences: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const w of words) {
    current.push(w);
    if (/[.!?]["')\]]?$/.test(w.text)) {
      sentences.push(current);
      current = [];
    }
  }
  if (current.length) sentences.push(current);
  const kept: TimedWord[][] = [];
  for (let i = 0; i < sentences.length; i++) {
    const key = norm(sentences[i]!.map((w) => w.text).join(" "));
    let j = i;
    while (j + 1 < sentences.length && norm(sentences[j + 1]!.map((w) => w.text).join(" ")) === key) j++;
    kept.push(sentences[i]!);
    // Three or more in a row: a loop. Keep the first, skip the rest.
    if (j - i >= 2) i = j;
  }
  const out = kept.flat();
  const real = kept.filter((s) => !FILLER.test(norm(s.map((w) => w.text).join(" "))));
  return real.length ? out : [];
}

const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Two spellings of one word: the same, or a letter or two apart in a longer word. */
function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && distance(a, b) <= (a.length >= 7 ? 2 : 1);
}

/**
 * Known words (what the user says was said or sung) timed to the voice between `from` and `to`, seconds.
 * Words the recognizer also heard take its times; the rest share out the time between them by length,
 * over what the recognizer heard there when it heard something, else over the gap.
 */
export function alignText(text: string, heard: readonly TimedWord[], from: number, to: number): TimedWord[] {
  const said = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!said.length) return [];
  const a = said.map(bare);
  const b = heard.map((w) => bare(w.text));
  // The longest run of words in common, in order (heard words can be missing or extra).
  const n = a.length;
  const m = b.length;
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      best[i]![j] = sameWord(a[i]!, b[j]!)
        ? best[i + 1]![j + 1]! + 1
        : Math.max(best[i + 1]![j]!, best[i]![j + 1]!);
  const match = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (sameWord(a[i]!, b[j]!)) match[i++] = j++;
    else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++;
    else j++;
  }
  const out: TimedWord[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = match[i]!;
    if (j >= 0) out[i] = { text: said[i]!, start: heard[j]!.start, end: heard[j]!.end };
  }
  // Each run of unmatched words between two matched ones (or the ends of the stretch).
  for (let i = 0; i < n; ) {
    if (match[i]! >= 0) {
      i++;
      continue;
    }
    let k = i;
    while (k < n && match[k]! < 0) k++;
    const prevJ = i > 0 ? match[i - 1]! : -1;
    const nextJ = k < n ? match[k]! : m;
    let lo = i > 0 ? out[i - 1]!.end : from;
    let hi = k < n ? out[k]!.start : to;
    // What the recognizer heard in between (misheard words) is where the voice is.
    const between = heard.slice(prevJ + 1, nextJ);
    if (between.length) {
      lo = Math.max(lo, between[0]!.start);
      hi = Math.min(hi, between.at(-1)!.end);
    }
    if (hi - lo < 0.08 * (k - i)) hi = lo + 0.08 * (k - i);
    const weights = said.slice(i, k).map((w) => Math.max(1, bare(w).length));
    const total = weights.reduce((x, y) => x + y, 0);
    let at = lo;
    for (let x = i; x < k; x++) {
      const len = ((hi - lo) * weights[x - i]!) / total;
      out[x] = { text: said[x]!, start: round3(at), end: round3(at + len) };
      at += len;
    }
    i = k;
  }
  return out;
}

const round3 = (t: number) => Math.round(t * 1000) / 1000;
