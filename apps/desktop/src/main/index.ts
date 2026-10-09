// Before anything else: the data folder may need moving from the app's former name.
import "./rename.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readyBrowser } from "@vedit/render";
import { app, BrowserWindow, Menu } from "electron";
import { setAccountWindow } from "./account.ts";
import { runBench } from "./bench.ts";
import { claudeStatus } from "./claude.ts";
import { codexStatus } from "./codex.ts";
import { registerIpc } from "./ipc.ts";
import { logWindow, startLog } from "./log.ts";
import { userNamespacesBlocked } from "./platform.ts";
import { ProjectService } from "./project-service.ts";
import { here, registerAppProtocol, registerMediaProtocol, registerSchemes } from "./protocols.ts";
import { APP_ORIGIN, DEV_SERVER_URL, harden } from "./security.ts";
import { setSettings } from "./settings.ts";
import { runSmoke } from "./smoke.ts";
import { busyReason, checkForUpdates, startUpdates } from "./updater.ts";
import { rememberPlace, savedPlace, setAppMenu } from "./window.ts";

// Credentials (Claude, KLIPY, stock): the environment first, then a .env next to the user's data, then,
// running from the repo (not packaged), the repo's own git-ignored .env. The SDK also picks up an
// `ant auth login` profile on its own.
const envFiles = [path.join(app.getPath("userData"), ".env")];
if (!app.isPackaged) envFiles.push(path.resolve(here, "../../../../.env"));
for (const file of envFiles) {
  try {
    process.loadEnvFile(file);
  } catch {}
}

// The tools the app ships (ffmpeg, ffprobe, whisper, the voice cleaner, the sound classifier): in the
// app's resources once packaged, in resources/tools/<platform>-<arch> when run from the repo (made by
// `pnpm tools`). Without them, tools are looked for on the machine.
// The graphics runtime's libraries and fonts, copied in at build time (scripts/runtime-assets.mts).
// The open models (faces, people, sounds, cutouts off macOS) download here once, when first needed.
if (!process.env.VEDIT_MODELS) process.env.VEDIT_MODELS = path.join(app.getPath("userData"), "models");
if (!process.env.VEDIT_RUNTIME_ASSETS)
  process.env.VEDIT_RUNTIME_ASSETS = path.join(here, "../runtime-assets");

if (!process.env.VEDIT_TOOLS) {
  const shipped = app.isPackaged
    ? path.join(process.resourcesPath, "tools")
    : path.join(app.getAppPath(), "resources", "tools", `${process.platform}-${process.arch}`);
  if (existsSync(shipped)) process.env.VEDIT_TOOLS = shipped;
}

registerSchemes();
app.enableSandbox();
// An AppImage can't carry Chromium's setuid sandbox helper, and Ubuntu 24.04+ blocks its fallback
// (unprivileged user namespaces) for apps AppArmor doesn't know: the app wouldn't start at all. Only
// there, it runs without Chromium's sandbox (the .deb installs the helper and keeps it).
if (process.platform === "linux" && process.env.APPIMAGE && userNamespacesBlocked())
  app.commandLine.appendSwitch("no-sandbox");
// Windows groups the taskbar and notifications by this.
if (process.platform === "win32") app.setAppUserModelId("dev.durableagent.cutroom");

// The benchmark (bench.ts) runs headless with its own settings and data, beside a running editor.
const BENCH = process.env.VEDIT_BENCH;
if (BENCH) app.setPath("userData", path.join(app.getPath("appData"), "vedit-bench"));
// The packaged-app self-test (smoke.ts): headless, with data of its own.
const SMOKE = process.env.VEDIT_SMOKE;
if (SMOKE) app.setPath("userData", path.join(app.getPath("appData"), "vedit-smoke"));
// From here on, what's printed is also written to <app data>/logs (keys taken out).
startLog();

// Installed: Remotion's compositor ships beside the app's archive (it can't run from inside it; so does
// the fallback copy of Claude Code, which claude.ts finds), and the app works from a folder of its own: Remotion keeps its headless
// Chrome in node_modules/.remotion beside the nearest package.json above the working directory, and
// whisper writes its scratch files there too.
if (app.isPackaged) {
  const native = path.join(process.resourcesPath, "native");
  const compositor = path.join(native, "remotion-compositor");
  if (!process.env.VEDIT_REMOTION_BIN && existsSync(compositor)) process.env.VEDIT_REMOTION_BIN = compositor;
  const runtime = path.join(app.getPath("userData"), "runtime");
  mkdirSync(runtime, { recursive: true });
  const marker = path.join(runtime, "package.json");
  if (!existsSync(marker)) writeFileSync(marker, '{ "name": "vedit-runtime", "private": true }\n');
  process.chdir(runtime);
}

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
const service = new ProjectService(() => win);

function createWindow({ hidden = false } = {}): void {
  const min = { width: 1080, height: 680 };
  const place = hidden ? { width: 1440, height: 900 } : savedPlace(min);
  win = new BrowserWindow({
    width: place.width,
    height: place.height,
    ...(place.x !== undefined && place.y !== undefined && { x: place.x, y: place.y }),
    minWidth: min.width,
    minHeight: min.height,
    show: false,
    backgroundColor: "#111113",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  // Show only once the first frame is painted: no white flash, no layout jump.
  if (!hidden) {
    if ("maximized" in place && place.maximized) win.maximize();
    if ("fullScreen" in place && place.fullScreen) win.setFullScreen(true);
    rememberPlace(win);
    win.once("ready-to-show", () => win?.show());
  }
  logWindow(win.webContents);
  win.on("closed", () => {
    win = null;
  });
  // Right-click: copy what's selected (the chat, a reply), and cut/paste in text fields.
  win.webContents.on("context-menu", (_e, p) => {
    const items: Electron.MenuItemConstructorOptions[] = p.isEditable
      ? [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" }]
      : p.selectionText.trim()
        ? [{ role: "copy" }]
        : [];
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  void win.loadURL(DEV_SERVER_URL ?? `${APP_ORIGIN}/index.html`);
  if (DEV_SERVER_URL) win.webContents.openDevTools({ mode: "detach", activate: false });
}

app.on("second-instance", () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

app.whenReady().then(() => {
  harden();
  // Running from the repo, the Dock shows Electron's icon unless told otherwise; installed, the app's own.
  if (process.platform === "darwin" && !app.isPackaged) {
    const icon = path.join(app.getAppPath(), "build", "icon-mac.png");
    if (existsSync(icon)) app.dock?.setIcon(icon);
  }
  if (!DEV_SERVER_URL) registerAppProtocol(path.join(here, "../renderer"));
  registerMediaProtocol(service.resolveMedia);
  registerIpc(service);
  setAccountWindow(() => win);
  // Find Claude Code now (the user's own, or the app's copy), so the first request needn't wait.
  void claudeStatus();
  // Codex too, so the agent can use it if it's the one chosen (and Settings shows it at once).
  void codexStatus();
  // The asset library: made on first launch, catalogued as files arrive.
  if (!SMOKE && !BENCH)
    void service.library.start().catch((err: unknown) => console.warn("[library] couldn't start:", err));
  if (SMOKE) {
    // A build machine's test: a smaller speech model than people get (it proves transcription works).
    const smokeWhisper = process.env.VEDIT_SMOKE_WHISPER;
    const smokeSetup = smokeWhisper ? setSettings({ whisperModel: smokeWhisper }) : Promise.resolve();
    void smokeSetup
      .then(() =>
        runSmoke(service, SMOKE, async () => {
          // The editor itself, hidden: the app's protocol, preload and interface load and show the project.
          createWindow({ hidden: true });
          const contents = win!.webContents;
          await new Promise<void>((ok) => contents.once("did-finish-load", () => ok()));
          for (let i = 0; i < 40; i++) {
            const shown = (await contents.executeJavaScript(
              `(document.querySelector("header")?.innerText ?? "") + " | " + document.querySelectorAll("button").length`,
            )) as string;
            if (/\| [1-9]/.test(shown) && !shown.startsWith(" |")) return shown;
            await new Promise((ok) => setTimeout(ok, 250));
          }
          throw new Error("the editor's window didn't show the project");
        }),
      )
      // The exit code says whether it passed (Electron's quit doesn't carry process.exitCode).
      .then(async (ok) => {
        await service.close().catch(() => {});
        app.exit(ok ? 0 : 1);
      });
    return;
  }
  if (BENCH) {
    void runBench(service, BENCH)
      .catch((err: unknown) => console.error("[bench] failed:", err))
      .finally(() => app.quit());
    return;
  }
  setAppMenu(
    (action) => {
      if (!win || win.isDestroyed()) createWindow();
      win?.webContents.send("event:menu", { action });
      win?.focus();
    },
    !app.isPackaged,
    () => void checkForUpdates(true),
  );
  createWindow();
  // Cutroom's own updates: found and offered in the header, never installed without a click.
  void startUpdates({
    notify: (state) => win?.webContents.send("event:update", state),
    whyBusy: () =>
      busyReason({
        agentRuns: service.activeRuns().length,
        exporting: service.exporter.busy,
        indexing: service.indexer.indexing,
        downloading: service.downloads
          .state()
          .filter((d) => d.state === "running")
          .map((d) => d.label),
        claudeTask: service.claude.running(),
      }),
    saveAll,
  });
  // Remotion's headless Chrome, fetched once in the background (about 190 MB) so the first export or
  // look doesn't wait for it; they wait on this same download if it's still going.
  setTimeout(
    () => void readyBrowser().catch((err: unknown) => console.warn("[render] browser:", err)),
    15_000,
  );
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !BENCH) app.quit();
});

let flushed = false;
/** Saves and stops background work, but never hangs on it: after 5 seconds, it's done anyway. */
async function saveAll(): Promise<void> {
  const giveUp = new Promise<void>((ok) =>
    setTimeout(() => {
      console.error("[quit] cleanup took over 5s; quitting anyway");
      ok();
    }, 5_000),
  );
  await Promise.race([service.close(), giveUp]).catch((err: unknown) =>
    console.error("[quit] cleanup failed:", err),
  );
  flushed = true;
}

app.on("before-quit", (event) => {
  if (flushed) return;
  event.preventDefault();
  void saveAll().finally(() => {
    app.quit();
    // If the quit itself stalls (it has, with the window already gone), exit: everything is saved.
    setTimeout(() => {
      console.error("[quit] still running 3s after quitting; exiting");
      app.exit(0);
    }, 3_000);
  });
});
