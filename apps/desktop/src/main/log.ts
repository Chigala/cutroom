/**
 * The app's log, for when something goes wrong on someone else's Mac: everything the main process prints
 * and the editor window's warnings and errors go to <app data>/logs/main.log, kept to five files of 5 MB.
 * API keys never reach it: each line is scrubbed of the keys in use before it's written. The latest
 * problems are also kept in memory for Settings → Diagnostics.
 */
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync, type WriteStream } from "node:fs";
import path from "node:path";
import { format } from "node:util";
import type { DiagnosticProblem } from "@vedit/bridge";
import { app } from "electron";

const MAX_BYTES = 5 * 1024 * 1024;
const FILES = 5;

export const logsDir = () => path.join(app.getPath("userData"), "logs");
const logFile = () => path.join(logsDir(), "main.log");

let stream: WriteStream | null = null;
let size = 0;

/** Values that must never be written down: API keys, from the environment and from Settings. */
const secrets = new Set<string>();
export function addSecret(value: string | undefined): void {
  if (value && value.length >= 8) secrets.add(value);
}

/** A line with every known key, and anything shaped like an Anthropic key, taken out. */
export function scrub(text: string): string {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join("‹key›");
  return out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "‹key›");
}

const problems: DiagnosticProblem[] = [];
export const recentProblems = (): DiagnosticProblem[] => [...problems].reverse();

function rotate(): void {
  stream?.end();
  stream = null;
  const file = logFile();
  rmSync(`${file}.${FILES - 1}`, { force: true });
  for (let i = FILES - 2; i >= 1; i--) {
    try {
      renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {}
  }
  try {
    renameSync(file, `${file}.1`);
  } catch {}
  size = 0;
}

function write(level: DiagnosticProblem["level"] | "info", from: string, text: string): void {
  const clean = scrub(text);
  if (level !== "info") {
    problems.push({ at: Date.now(), level, from, text: clean.slice(0, 2000) });
    if (problems.length > 100) problems.shift();
  }
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${from === "main" ? "" : `[${from}] `}${clean}\n`;
  if (size + line.length > MAX_BYTES) rotate();
  if (!stream) {
    mkdirSync(logsDir(), { recursive: true });
    stream = createWriteStream(logFile(), { flags: "a" });
    stream.on("error", () => {
      stream = null;
    });
  }
  stream.write(line);
  size += Buffer.byteLength(line);
}

/** Starts the log: the console goes to the file too, and crashes and stray rejections are written down. */
export function startLog(): void {
  try {
    size = statSync(logFile()).size;
  } catch {
    size = 0;
  }
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "KLIPY_API_KEY",
    "PEXELS_API_KEY",
    "PIXABAY_API_KEY",
    "FREESOUND_API_KEY",
  ])
    addSecret(process.env[key]);
  // A terminal that's gone (the one the app was started from, closed) can't take the console's copy: a
  // write there fails (EIO, EPIPE), and unheard it ends as an uncaught exception. The log file has it all.
  for (const out of [process.stdout, process.stderr]) out.on("error", () => {});
  const levels = { log: "info", info: "info", warn: "warn", error: "error" } as const;
  for (const [method, level] of Object.entries(levels) as [
    keyof typeof levels,
    (typeof levels)[keyof typeof levels],
  ][]) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      write(level, "main", format(...args));
    };
  }
  process.on("uncaughtExceptionMonitor", (err) => write("error", "main", `Uncaught: ${err.stack ?? err}`));
  process.on("unhandledRejection", (reason) =>
    write("error", "main", `Unhandled rejection: ${(reason as Error)?.stack ?? String(reason)}`),
  );
  app.on("child-process-gone", (_e, d) => {
    if (d.reason !== "clean-exit")
      write("error", "main", `${d.type} process gone: ${d.reason} (${d.exitCode})`);
  });
  write(
    "info",
    "main",
    `Cutroom ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${process.arch}`,
  );
}

/** The editor window's warnings and errors, and the window itself failing. */
export function logWindow(contents: Electron.WebContents): void {
  contents.on("console-message", (e) => {
    if (e.level !== "warning" && e.level !== "error") return;
    const where = e.sourceId ? ` (${e.sourceId.replace(/^.*\//, "")}:${e.lineNumber})` : "";
    write(e.level === "warning" ? "warn" : "error", "window", `${e.message}${where}`);
  });
  contents.on("render-process-gone", (_e, d) =>
    write("error", "window", `The editor's page stopped: ${d.reason}`),
  );
  contents.on("unresponsive", () => write("warn", "window", "The editor stopped responding"));
  contents.on("responsive", () => write("info", "window", "The editor is responding again"));
}
