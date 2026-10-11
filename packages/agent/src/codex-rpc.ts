/**
 * A Codex app server (`codex app-server`): Codex's own JSON-RPC over stdio, one JSON message a line, the
 * way its editor integrations drive it. Requests out and their replies, notifications in, and Codex's
 * own requests (a tool call, an approval) answered by the handler given. Started per use and stopped
 * after: nothing lingers between requests.
 */
import { type ChildProcess, spawn } from "node:child_process";
import readline from "node:readline";

export interface CodexLaunch {
  /** The codex executable. */
  readonly bin: string;
  /** Cutroom's own Codex folder: its sign-in and settings, apart from the user's ~/.codex. */
  readonly home: string;
  readonly cwd: string;
  /** `-c key=value` settings for the whole server (they hold for every thread it starts). */
  readonly config?: Readonly<Record<string, string | number | boolean>>;
  /** Arguments before `app-server` (a script, when `bin` is the runtime that runs it: tests). */
  readonly prefix?: readonly string[];
}

type Message = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

export class CodexError extends Error {
  override name = "CodexError";
}

export class CodexServer {
  private readonly child: ChildProcess;
  private next = 0;
  private readonly waiting = new Map<number, { ok: (v: unknown) => void; no: (e: Error) => void }>();
  private readonly listeners = new Set<(method: string, params: unknown) => void>();
  private stderr = "";
  private closed: Error | null = null;
  private ended!: (err: Error) => void;
  /** Settles when the server has stopped (crashed, killed or closed), with why. */
  readonly exited: Promise<Error> = new Promise((resolve) => {
    this.ended = resolve;
  });
  /** Answers Codex's own requests; anything it doesn't know is declined. */
  onRequest: (method: string, params: unknown) => Promise<unknown> = async (method) => {
    throw new CodexError(`Cutroom doesn't handle ${method}`);
  };

  constructor(launch: CodexLaunch) {
    const args = [
      ...(launch.prefix ?? []),
      "app-server",
      ...Object.entries(launch.config ?? {}).flatMap(([k, v]) => ["-c", `${k}=${toml(v)}`]),
    ];
    // The user's own OpenAI key or endpoint would replace their ChatGPT sign-in: left out.
    const { OPENAI_API_KEY: _key, OPENAI_BASE_URL: _url, CODEX_HOME: _home, ...env } = process.env;
    this.child = spawn(launch.bin, args, {
      cwd: launch.cwd,
      env: { ...env, CODEX_HOME: launch.home },
      stdio: ["pipe", "pipe", "pipe"],
      // An npm install on Windows is a .cmd shim, which only cmd.exe runs (the arguments are fixed words).
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(launch.bin),
      windowsHide: true,
    });
    readline.createInterface({ input: this.child.stdout! }).on("line", (line) => this.receive(line));
    this.child.stderr!.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    const end = (err: Error) => {
      if (this.closed) return;
      this.closed = err;
      for (const w of this.waiting.values()) w.no(err);
      this.waiting.clear();
      this.ended(err);
    };
    this.child.on("error", (err) => end(err));
    // Writing to a Codex that just died (EPIPE) would otherwise throw out of the app: its exit says why.
    this.child.stdin?.on("error", () => {});
    this.child.on("exit", (code) =>
      end(
        new CodexError(
          `Codex stopped (${code ?? "killed"})${this.stderr ? `: ${this.stderr.trim().slice(-400)}` : ""}`,
        ),
      ),
    );
  }

  /** Connects: who Cutroom is, and that it speaks Codex's experimental API (own tools, no environment). */
  async start(version: string): Promise<{ userAgent: string }> {
    const init = (await this.request("initialize", {
      clientInfo: { name: "cutroom", title: "Cutroom", version },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: ["turn/diff/updated", "remoteControl/status/changed"],
      },
    })) as { userAgent: string };
    this.notify("initialized");
    return init;
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.next;
    return new Promise<T>((ok, no) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, no });
      this.send({ id, method, ...(params !== undefined && { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ method, ...(params !== undefined && { params }) });
  }

  on(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.child.exitCode !== null || this.child.killed) return;
    // On Windows a .cmd shim runs codex under cmd.exe: killing the shell would leave codex running, so
    // the whole tree goes.
    if (process.platform === "win32" && this.child.pid)
      spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true }).on("error", () =>
        this.child.kill(),
      );
    else this.child.kill();
  }

  private send(message: Message): void {
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let m: Message;
    try {
      m = JSON.parse(line) as Message;
    } catch {
      return;
    }
    // A reply to one of ours.
    if (m.id !== undefined && m.method === undefined) {
      const w = this.waiting.get(Number(m.id));
      if (!w) return;
      this.waiting.delete(Number(m.id));
      if (m.error) w.no(new CodexError(m.error.message ?? "Codex refused the request"));
      else w.ok(m.result);
      return;
    }
    if (m.method === undefined) return;
    // One of Codex's own requests: answered by the handler, or declined.
    if (m.id !== undefined) {
      const id = m.id;
      this.onRequest(m.method, m.params).then(
        (result) => this.send({ id, result } as Message),
        (err: Error) => this.send({ id, error: { code: -32601, message: err.message } } as Message),
      );
      return;
    }
    for (const l of this.listeners) l(m.method, m.params);
  }
}

/** A value as TOML for `-c` (strings quoted). */
const toml = (v: string | number | boolean) => (typeof v === "string" ? JSON.stringify(v) : String(v));
