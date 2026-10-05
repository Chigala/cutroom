// Dev loop: Vite dev server for the UI (instant HMR), watch builds for main and preload, and an Electron
// process that restarts whenever either of those rebuilds. UI edits never restart Electron.
import { spawn } from "node:child_process";
import path from "node:path";
import electronPath from "electron";
import { createServer } from "vite";
import { buildMain, buildPreload, clientDir, desktopDir } from "./bundle.mjs";

const server = await createServer({
  configFile: path.join(clientDir, "vite.config.ts"),
  mode: "development",
});
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`ui     ${url}`);

let child = null;
let restarting = false;
let timer = null;

function start() {
  child = spawn(electronPath, ["."], {
    cwd: desktopDir,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: "development" },
  });
  child.on("exit", (code) => {
    if (restarting) return;
    void server.close();
    process.exit(code ?? 0);
  });
}

function restart() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!child) return start();
    restarting = true;
    child.once("exit", () => {
      restarting = false;
      start();
    });
    child.kill();
  }, 80);
}

const ready = new Set();
for (const [name, bundle] of [
  ["main", buildMain],
  ["preload", buildPreload],
]) {
  const watcher = await bundle({ mode: "development", watch: true });
  watcher.on("event", (e) => {
    if (e.code === "ERROR") console.error(`${name}: ${e.error.message}`);
    if (e.code !== "END") return;
    ready.add(name);
    if (ready.size === 2) restart();
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restarting = true;
    child?.kill();
    void server.close().then(() => process.exit(0));
  });
}
