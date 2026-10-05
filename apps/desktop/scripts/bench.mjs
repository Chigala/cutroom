// Runs the benchmark (src/main/bench.ts) on the built app: `pnpm --filter @vedit/desktop bench [cases.json]`.
// Headless, with its own settings and data. Build first (pnpm build). Keys come from the environment
// (or a .env at the repo root): the agent's, and optionally Pexels, Pixabay and Freesound.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const env = path.join(root, ".env");
if (existsSync(env)) process.loadEnvFile(env);
const cases = path.resolve(process.argv[2] ?? path.join(root, "bench/cases.json"));
const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, ["."], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, VEDIT_BENCH: cases },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
