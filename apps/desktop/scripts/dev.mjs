// Dev loop: Vite dev server for the UI (instant HMR), watch builds for main and preload, and an Electron
// process that restarts whenever either of those rebuilds. UI edits never restart Electron.
import { spawn } from "node:child_process";
import { statSync, watch } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import electronPath from "electron";
import { createServer } from "vite";
import { clientDir, desktopDir } from "./bundle.mjs";

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

// On Linux, Chromium's sandbox helper must be owned by root with the setuid bit, which a fresh install
// in node_modules never is (and Ubuntu 23.10+ blocks the fallback). In development only, run without it
// rather than abort; `sudo chown root <it> && sudo chmod 4755 <it>` turns it back on.
const args = ["."];
if (process.platform === "linux") {
  const helper = path.join(path.dirname(electronPath), "chrome-sandbox");
  let usable = false;
  try {
    const s = statSync(helper);
    usable = s.uid === 0 && (s.mode & 0o4000) !== 0;
  } catch {}
  if (!usable) {
    console.log(
      `dev    no setuid ${path.relative(process.cwd(), helper)}: running Electron with --no-sandbox`,
    );
    args.push("--no-sandbox");
  }
}

function start() {
  child = spawn(electronPath, args, {
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

// The watch builds, from the build settings as they are now. They're read again whenever bundle.mjs
// changes (a package left out of the bundle, say): a dev session started before that change would
// otherwise keep building with the old list, bundling what should load from node_modules.
const settings = path.join(desktopDir, "scripts", "bundle.mjs");
let watchers = [];
async function watchBuilds() {
  const { buildMain, buildPreload } = await import(`${pathToFileURL(settings).href}?v=${Date.now()}`);
  await Promise.all(watchers.map((w) => w.close()));
  watchers = [];
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
    watchers.push(watcher);
  }
}
await watchBuilds();
// The folder, not the file: editors and git replace a file rather than write into it.
let changed = null;
watch(path.dirname(settings), (_, file) => {
  if (file !== path.basename(settings)) return;
  clearTimeout(changed);
  changed = setTimeout(() => {
    console.log("build settings changed: rebuilding with them");
    void watchBuilds().catch((err) => console.error(`build settings: ${err.message}`));
  }, 200);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restarting = true;
    child?.kill();
    void server.close().then(() => process.exit(0));
  });
}
