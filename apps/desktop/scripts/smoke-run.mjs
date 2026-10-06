// Runs the packaged app's self-test (src/main/smoke.ts) on the system it was built for, after
// electron-builder: imports a short clip with speech and words on screen, transcribes it, reads its
// picture, renders a scripted graphic, exports, and opens the editor's window. Fails (exit 1) unless
// all of it worked. On Linux it needs a screen: run it under xvfb-run.
//
//   node apps/desktop/scripts/smoke-run.mjs
//
// VEDIT_SMOKE_WHISPER (e.g. small.en) and VEDIT_WHISPER_DIR pick and keep the speech model.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const release = path.join(here, "..", "release");
const app = {
  darwin: [path.join(release, `mac-${process.arch}`, "Cutroom.app", "Contents", "MacOS", "Cutroom")],
  win32: [path.join(release, "win-unpacked", "Cutroom.exe")],
  linux: [path.join(release, "linux-unpacked", "cutroom")],
}[process.platform]?.find(existsSync);
if (!app) {
  console.error(`No packaged app in ${release} for ${process.platform}-${process.arch}`);
  process.exit(1);
}

const report = path.join(mkdtempSync(path.join(tmpdir(), "cutroom-smoke-")), "report.json");
const args = process.platform === "linux" ? ["--no-sandbox"] : [];
console.log(`Self-testing ${app}`);
const child = spawn(app, args, {
  env: { ...process.env, VEDIT_SMOKE: path.join(here, "smoke-speech.mp4"), VEDIT_SMOKE_REPORT: report },
  stdio: ["ignore", "inherit", "inherit"],
});
// Twenty minutes: the speech model downloads on a cold cache.
const timer = setTimeout(() => {
  console.error("The self-test took over 20 minutes");
  child.kill();
}, 20 * 60_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  const result = existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null;
  if (result) console.log(JSON.stringify(result, null, 2));
  const ok = code === 0 && result?.ok === true;
  console.log(ok ? "Self-test passed" : `Self-test failed (exit ${code})`);
  process.exit(ok ? 0 : 1);
});
