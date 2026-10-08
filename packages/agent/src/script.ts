/**
 * run_script's sandbox: JavaScript the agent writes to work something out over the project (beat-timed
 * shot lengths, spacing, bulk changes), run in QuickJS compiled to WebAssembly. Not Node's vm, which
 * isn't a security boundary: the script sees only what it's handed, with no files, network, timers or
 * modules, and stops at a time and memory limit. Pure WebAssembly, so it runs the same on every platform.
 */
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten-core";

let module: Promise<QuickJSWASMModule> | null = null;
const quickjs = () => {
  module ??= newQuickJSWASMModuleFromVariant(variant);
  return module;
};

export interface ScriptLimits {
  /** Wall time, ms. */
  readonly ms: number;
  /** Heap, bytes. */
  readonly memory: number;
}

const LIMITS: ScriptLimits = { ms: 5000, memory: 64 * 1024 * 1024 };
/** What comes back: the result as JSON, and the log, each cut to this many characters. */
const MAX_OUT = 200_000;
const MAX_LOG = 20_000;

export interface ScriptRun {
  /** The script's return value, as JSON (absent when it returned undefined or threw). */
  readonly json?: string;
  /** What it printed with console.log, one entry a call. */
  readonly logs: readonly string[];
  /** Why it failed: the error with its line, or the limit it hit. */
  readonly error?: string;
}

/**
 * Runs `code` as the body of a function (so it can `return`), with `globals` set as read-only data and
 * each of `getters` callable from the script by name: a getter takes one string and returns JSON-able
 * data, fetched only when the script asks (a transcript, a clip's analysis).
 */
export async function runScript(
  code: string,
  globals: Readonly<Record<string, unknown>>,
  getters: Readonly<Record<string, (arg: string) => unknown>>,
  limits: ScriptLimits = LIMITS,
): Promise<ScriptRun> {
  const runtime = (await quickjs()).newRuntime();
  runtime.setMemoryLimit(limits.memory);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.ms));
  const vm = runtime.newContext();
  const logs: string[] = [];
  let logged = 0;
  try {
    const set = (name: string, h: QuickJSHandle) => {
      vm.setProp(vm.global, name, h);
      h.dispose();
    };
    set("__data", vm.newString(JSON.stringify(globals)));
    set(
      "__get",
      vm.newFunction("__get", (nameH, argH) => {
        const name = vm.getString(nameH);
        const fn = getters[name];
        if (!fn) return { error: vm.newError(`no ${name}`) };
        return vm.newString(
          JSON.stringify(fn(vm.typeof(argH) === "string" ? vm.getString(argH) : "") ?? null),
        );
      }),
    );
    set(
      "__log",
      vm.newFunction("__log", (textH) => {
        const text = vm.getString(textH);
        if (logged < MAX_LOG) logs.push(text.slice(0, MAX_LOG - logged));
        logged += text.length;
      }),
    );
    const prelude = [
      "const __frozen = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const k in o) __frozen(o[k]); } return o; };",
      "const __parsed = JSON.parse(__data);",
      ...Object.keys(globals).map(
        (k) => `globalThis[${JSON.stringify(k)}] = __frozen(__parsed[${JSON.stringify(k)}]);`,
      ),
      ...Object.keys(getters).map(
        (k) =>
          `globalThis[${JSON.stringify(k)}] = (arg) => __frozen(JSON.parse(__get(${JSON.stringify(k)}, arg)));`,
      ),
      "const __show = (v) => typeof v === 'string' ? v : JSON.stringify(v);",
      "globalThis.console = { log: (...a) => __log(a.map(__show).join(' ')) };",
      "delete globalThis.__data;",
    ].join("\n");
    const setup = vm.evalCode(prelude, "setup.js");
    if ("error" in setup && setup.error) {
      const message = describe(vm, setup.error, limits);
      setup.error.dispose();
      return { logs, error: `The sandbox didn't start: ${message}` };
    }
    setup.value.dispose();
    // The script's own lines start at line 2 of script.js.
    const result = vm.evalCode(
      `JSON.stringify((function () {\n${code}\n})(), (k, v) => (typeof v === "bigint" ? Number(v) : v))`,
      "script.js",
    );
    if ("error" in result && result.error) {
      const message = describe(vm, result.error, limits);
      result.error.dispose();
      return { logs, error: message };
    }
    const json = vm.typeof(result.value) === "string" ? vm.getString(result.value) : undefined;
    result.value.dispose();
    if (json !== undefined && json.length > MAX_OUT)
      return { logs, error: `The result is ${json.length} characters; return less (under ${MAX_OUT}).` };
    return { ...(json !== undefined && { json }), logs };
  } catch (err) {
    // Out of memory or stack inside the engine can surface as a host error.
    return { logs, error: (err as Error).message || String(err) };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

/** An error thrown in the sandbox as one line: its message and where (the script's own line numbers). */
function describe(vm: QuickJSContext, h: QuickJSHandle, limits: ScriptLimits): string {
  const e = vm.dump(h) as { name?: string; message?: string; stack?: string } | string;
  if (typeof e !== "object" || !e) return String(e);
  if (e.name === "InternalError" && /interrupted/.test(e.message ?? ""))
    return `It ran too long (over ${limits.ms / 1000} seconds) and was stopped.`;
  if (/out of memory/i.test(e.message ?? ""))
    return `It ran out of memory (${Math.round(limits.memory / 1048576)} MB) and was stopped.`;
  const at = /script\.js:(\d+)(?::(\d+))?/.exec(e.stack ?? "");
  const line = at ? ` (line ${Number(at[1]) - 1})` : "";
  return `${e.name ?? "Error"}: ${e.message ?? ""}${line}`;
}
