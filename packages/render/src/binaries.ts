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
 * where drivers vary and WSL and servers have no GPU path (slower, always works), and anywhere the GPU
 * turned out to have no WebGL2 (fallBackToSoftware). VEDIT_GL overrides it (e.g. "angle-egl" or
 * "vulkan" on a Linux machine with a working GPU).
 */
export function chromiumOptions(): ChromiumOptions {
  const forced = process.env.VEDIT_GL as OpenGlRenderer | undefined;
  if (forced && GL_MODES.includes(forced)) return { gl: forced };
  return { gl: software || process.platform === "linux" || wsl() ? "swangle" : "angle" };
}

/** Set once the GPU couldn't run WebGL2 here (a blocked driver, a virtual machine): software from then on. */
let software = false;

/**
 * The page had no WebGL2: the colour grade (GL_UNAVAILABLE in @vedit/composition) or a scripted
 * graphic's WebGL couldn't start.
 */
export function isGlUnavailable(err: unknown): boolean {
  return /colour grading needs WebGL2|WebGL2 context/i.test((err as Error)?.message ?? "");
}

/**
 * Switches rendering to software, which always has WebGL2 (SwiftShader, inside Chrome): slower, but the
 * right colours. True when that's a change worth retrying with; false when already there or forced.
 */
export function fallBackToSoftware(): boolean {
  // Already there, or a renderer someone chose on purpose: nothing to retry with.
  if (chromiumOptions().gl === "swangle" || process.env.VEDIT_GL) return false;
  console.warn("[render] no WebGL2 on the GPU here: rendering in software from now on");
  software = true;
  return true;
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
