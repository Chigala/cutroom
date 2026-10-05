import { ensureBrowser } from "@remotion/renderer";

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
