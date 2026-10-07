/**
 * The voice model in a process of its own. ONNX Runtime is a native library: a crash inside it (as its
 * memory arena once did inside Electron) would take the whole app down, a request running with it. Here
 * it takes down this process only, and the separation fails with a plain message.
 *
 * The process is this app's own executable run as Node (Electron's ELECTRON_RUN_AS_NODE; plain Node in
 * tests), so it's there wherever the app is, packaged or not. Its script is small and written out when
 * first needed, so the build has nothing extra to ship. It loads ONNX Runtime from where the app resolves
 * it, takes one window at a time over IPC, and sends the voice back.
 */
import { type ChildProcess, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const WORKER = `// Cutroom's voice model, in a process of its own (voice-worker.ts).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let ort;
let session;
const lean = { enableCpuMemArena: false, enableMemPattern: false };
process.on("message", async (m) => {
  try {
    if (m.type === "init") {
      ort = require(m.ort);
      for (const providers of m.providers) {
        try {
          session = await ort.InferenceSession.create(m.model, { executionProviders: providers, ...lean });
          break;
        } catch (err) {
          if (providers === m.providers.at(-1)) throw err;
        }
      }
      process.send({ type: "ready" });
    } else if (m.type === "run") {
      const input = new ort.Tensor("float32", m.mix, [1, 2, m.n]);
      const out = await session.run({ [session.inputNames[0]]: input });
      const stems = out[session.outputNames[0]].data;
      process.send({ type: "done", id: m.id, voice: stems.slice(3 * 2 * m.n, 4 * 2 * m.n) });
    }
  } catch (err) {
    process.send({ type: "error", id: m.id, message: String((err && err.message) || err) });
  }
});
process.on("disconnect", () => process.exit(0));
`;

let written: Promise<string> | null = null;
/** The worker's script on disk, written once (named by its contents, so an update writes a new one). */
function script(): Promise<string> {
  written ??= (async () => {
    const hash = createHash("sha256").update(WORKER).digest("hex").slice(0, 12);
    const file = path.join(tmpdir(), `cutroom-voice-worker-${hash}.mjs`);
    if (!existsSync(file)) await writeFile(file, WORKER);
    return file;
  })().catch((err: unknown) => {
    written = null;
    throw err;
  });
  return written;
}

export interface VoiceWorker {
  /** The voice in one window (planar stereo, `n` samples a channel). */
  run(mix: Float32Array, n: number): Promise<Float32Array>;
  close(): void;
  readonly pid: number | undefined;
}

/**
 * Starts the voice model `modelFile` in its own process. On Windows it tries the graphics card
 * (DirectML) first, then the CPU. Resolves once the model is loaded.
 */
export async function startVoiceWorker(modelFile: string): Promise<VoiceWorker> {
  const ort = createRequire(import.meta.url).resolve("onnxruntime-node");
  const child: ChildProcess = fork(await script(), [], {
    // In the app, its own executable run as Node; in Node, Node.
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d).slice(-2000);
  });
  const pending = new Map<number, { ok: (v: Float32Array) => void; no: (e: Error) => void }>();
  let ready: { ok: () => void; no: (e: Error) => void } | null = null;
  let gone: Error | null = null;
  child.on("message", (m: { type: string; id?: number; voice?: Float32Array; message?: string }) => {
    if (m.type === "ready") ready?.ok();
    else if (m.type === "done") pending.get(m.id!)?.ok(m.voice!);
    else if (m.type === "error") {
      const err = new Error(`The voice model failed: ${m.message}`);
      if (m.id === undefined) ready?.no(err);
      else pending.get(m.id)?.no(err);
    }
    if (m.id !== undefined) pending.delete(m.id);
  });
  child.on("exit", (code, signal) => {
    gone = new Error(
      `The voice model stopped (${signal ?? `exit ${code}`})${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}.`,
    );
    ready?.no(gone);
    for (const p of pending.values()) p.no(gone);
    pending.clear();
  });
  const providers = process.platform === "win32" ? [["dml", "cpu"], ["cpu"]] : [["cpu"]];
  await new Promise<void>((ok, no) => {
    ready = { ok, no };
    child.send({ type: "init", ort, model: modelFile, providers });
  });
  ready = null;
  let next = 0;
  return {
    run: (mix, n) =>
      new Promise((ok, no) => {
        if (gone) return no(gone);
        const id = next++;
        pending.set(id, { ok, no });
        child.send({ type: "run", id, mix, n });
      }),
    close: () => {
      if (child.connected) child.disconnect();
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    },
    get pid() {
      return child.pid;
    },
  };
}
