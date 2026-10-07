/**
 * Stills of the finished video at given times: what the agent sees when it looks at its own edit
 * (graphics, captions, motion, all of it), and how it learns that a scripted graphic threw.
 */

import {
  type HeadlessBrowser,
  makeCancelSignal,
  openBrowser,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import type { CompositionProps } from "@vedit/composition";
import type { ProjectDoc } from "@vedit/project";
import {
  chromiumOptions,
  fallBackToSoftware,
  isGlUnavailable,
  readyBrowser,
  remotionBinaries,
} from "./binaries.ts";
import { type ExportOptions, serveUrl } from "./export.ts";
import { startMediaServer } from "./server.ts";

export interface StillsOptions {
  readonly doc: ProjectDoc;
  readonly entry: ExportOptions["entry"];
  /** Output times, in seconds. */
  readonly times: readonly number[];
  /** Media key to file, as for export; previews can use the fast proxies. */
  readonly resolve: (key: string) => Promise<string | null>;
  /** Of 1080x1920. */
  readonly scale?: number;
  /** Every console line from the page, for debugging. */
  readonly onLog?: (text: string) => void;
  /** The most one frame may take, ms. */
  readonly frameDeadline?: number;
  /** The video (default), or its cover image (cover.json; times are ignored). */
  readonly composition?: "Video" | "Cover";
  readonly imageFormat?: "jpeg" | "png";
}

export interface Stills {
  readonly images: readonly Buffer[];
  /** Runtime errors from scripted graphics, "<graphic>: <message>". */
  readonly errors: readonly string[];
}

let browser: Promise<HeadlessBrowser> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;

/** One warm browser between looks; it closes after a minute without one. */
function warmBrowser(): Promise<HeadlessBrowser> {
  clearTimeout(idle);
  browser ??= readyBrowser()
    .then(() => openBrowser("chrome", { chromiumOptions: chromiumOptions() }))
    .catch((err: unknown) => {
      browser = null;
      throw err;
    });
  return browser;
}

/**
 * A page that never finishes a frame (a graphic stuck in an endless loop freezes it, timers and all, so
 * nothing inside the page can time out): drop that browser so the next look starts clean.
 */
function discardBrowser(): void {
  clearTimeout(idle);
  const b = browser;
  browser = null;
  void b?.then((x) => x.close({ silent: true })).catch(() => {});
}

class FrameTimeout extends Error {}
class SetupTimeout extends Error {}

/** How long bundling and starting a browser may take before a look gives up. */
const SETUP_DEADLINE = 120_000;

/** `work`, or a FrameTimeout after `ms` (cancelling it). Enforced from outside the page. */
async function within<T>(
  ms: number,
  work: (cancel: ReturnType<typeof makeCancelSignal>) => Promise<T>,
): Promise<T> {
  const cancel = makeCancelSignal();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(cancel),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel.cancel();
          reject(new FrameTimeout());
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long one frame may take, at most: a scripted graphic gets its own 60 s to start inside that. */
const FRAME_DEADLINE = 75_000;

function release(): void {
  clearTimeout(idle);
  idle = setTimeout(() => {
    const b = browser;
    browser = null;
    void b?.then((x) => x.close({ silent: true })).catch(() => {});
  }, 60_000);
  idle.unref?.();
}

export async function renderStills(o: StillsOptions): Promise<Stills> {
  try {
    return await renderStillsOnce(o);
  } catch (err) {
    // No WebGL2 on this GPU (the colour grade needs it): again in software, in a fresh browser.
    if (!isGlUnavailable(err) || !fallBackToSoftware()) throw err;
    discardBrowser();
    return renderStillsOnce(o);
  }
}

async function renderStillsOnce(o: StillsOptions): Promise<Stills> {
  const server = await startMediaServer(o.resolve);
  const errors = new Set<string>();
  const onBrowserLog = ({ text }: { text: string }) => {
    o.onLog?.(text);
    const m = /\[graphic-error\] (.*)/.exec(text);
    if (m) errors.add(m[1]!);
  };
  try {
    // Getting ready (the bundle, a browser) has a deadline too: a browser that never comes up must not
    // hold the edit forever.
    const [url, puppeteerInstance] = await within(SETUP_DEADLINE, () =>
      Promise.all([serveUrl(o.entry), warmBrowser()]),
    ).catch((err: unknown) => {
      if (err instanceof FrameTimeout) {
        discardBrowser();
        throw new SetupTimeout();
      }
      throw err;
    });
    const inputProps: CompositionProps = {
      doc: o.doc,
      mediaBase: server.base,
      quality: "export",
      muteSources: true,
      audio: false,
    };
    const id = o.composition ?? "Video";
    const composition = await within(o.frameDeadline ?? FRAME_DEADLINE, () =>
      selectComposition({
        ...remotionBinaries(),
        serveUrl: url,
        id,
        inputProps,
        puppeteerInstance,
        chromiumOptions: chromiumOptions(),
        onBrowserLog,
      }),
    );
    const images: Buffer[] = [];
    for (const t of id === "Cover" ? [0] : o.times) {
      const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(t * composition.fps)));
      try {
        const { buffer } = await within(o.frameDeadline ?? FRAME_DEADLINE, (cancel) =>
          renderStill({
            ...remotionBinaries(),
            composition,
            serveUrl: url,
            inputProps,
            frame,
            imageFormat: o.imageFormat ?? "jpeg",
            ...((o.imageFormat ?? "jpeg") === "jpeg" && { jpegQuality: 82 }),
            scale: o.scale ?? 0.4,
            puppeteerInstance,
            chromiumOptions: chromiumOptions(),
            onBrowserLog,
            cancelSignal: cancel.cancelSignal,
          }),
        );
        if (buffer) images.push(buffer);
      } catch (err) {
        if (!(err instanceof FrameTimeout)) throw err;
        // The page froze: say where, keep the frames that did render, and start fresh next time.
        discardBrowser();
        errors.add(
          `the frame at ${t.toFixed(2)}s never finished rendering: a scripted graphic on screen then froze the page (most likely an endless loop, or waiting on something that never comes). Look at its script.`,
        );
        break;
      }
    }
    return { images, errors: [...errors] };
  } catch (err) {
    if (err instanceof SetupTimeout)
      return { images: [], errors: ["the renderer didn't start in time (it has been reset; try again)."] };
    if (!(err instanceof FrameTimeout)) throw err;
    discardBrowser();
    return {
      images: [],
      errors: ["the video never finished loading to render: a scripted graphic probably froze the page."],
    };
  } finally {
    await server.close();
    release();
  }
}
