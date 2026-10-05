import { existsSync, readFileSync } from "node:fs";
import { type ChromiumOptions, ensureBrowser, type OpenGlRenderer } from "@remotion/renderer";

const GL_MODES: readonly OpenGlRenderer[] = ["swangle", "angle", "egl", "swiftshader", "vulkan", "angle-egl"];

/** Running inside WSL (Linux on Windows), where there's no GPU path for the browser to draw with. */
const wsl = () =>
  process.platform === "linux" &&
  (!!process.env.WSL_DISTRO_NAME ||
    (existsSync("/proc/version") && /microsoft/i.test(readFileSync("/proc/version", "utf8"))));

/**
 * How the headless browser draws frames. ANGLE on the GPU on macOS and Windows; software on Linux,
 * where drivers vary and WSL and servers have no GPU path (slower, always works). VEDIT_GL overrides it
 * (e.g. "angle-egl" or "vulkan" on a Linux machine with a working GPU).
 */
export function chromiumOptions(): ChromiumOptions {
  const forced = process.env.VEDIT_GL as OpenGlRenderer | undefined;
  if (forced && GL_MODES.includes(forced)) return { gl: forced };
  return { gl: process.platform === "linux" || wsl() ? "swangle" : "angle" };
}

/**
 * Where Remotion's native compositor lives when the app ships it unpacked from its archive
 * (VEDIT_REMOTION_BIN, set by the app); in development Remotion finds its own.
 */
export function remotionBinaries(): { binariesDirectory?: string } {
  const dir = process.env.VEDIT_REMOTION_BIN;
  return dir ? { binariesDirectory: dir } : {};
}

let browser: Promise<unknown> | null = null;
/**
 * Remotion's headless Chrome, downloaded once (about 190 MB) if it isn't there yet. One shared download:
 * the app starts it in the background at launch, and an export or a look that comes first waits for it.
 */
export function readyBrowser(): Promise<unknown> {
  browser ??= ensureBrowser().catch((err: unknown) => {
    browser = null;
    throw err;
  });
  return browser;
}
