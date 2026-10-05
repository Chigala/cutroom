/**
 * A scripted graphic (one with <script> or libs) runs in a sandboxed iframe: the runtime page served at
 * `${mediaBase}runtime/graphic.html` (see @vedit/render's runtime.ts). Every frame, the composition posts
 * the time and the page draws it; while rendering, the frame waits for the page to say it drew, so the
 * export is exact.
 */

import { useLayoutEffect, useRef, useState } from "react";
import {
  continueRender,
  delayRender,
  getRemotionEnvironment,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { FontSource } from "./fonts.ts";

export interface ScriptedGraphicProps {
  readonly graphic: string;
  readonly visual: string;
  readonly html: string;
  readonly libs: readonly string[];
  readonly params: Readonly<Record<string, unknown>>;
  readonly vars: Readonly<Record<string, string>>;
  readonly duration: number;
  readonly accent: string;
  readonly font: string;
  readonly mediaBase: string;
  /** The project's own fonts, loaded into the page before the script runs. */
  readonly fonts: readonly FontSource[];
  readonly onError: (message: string) => void;
}

/** How long a page gets to load its libraries, and then to draw one frame, before we give up on it. */
const START_TIMEOUT = 15_000;
const FRAME_TIMEOUT = 5_000;

/** A stable seed per graphic and visual, so its randomness is the same on every render. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

export function ScriptedGraphic(p: ScriptedGraphicProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const rendering = getRemotionEnvironment().isRendering;
  const waiting = useRef(new Map<number, () => void>());
  const onError = useRef(p.onError);
  // Variables can change every frame (a graphic following a tracked face); they go with each frame.
  const varsRef = useRef(p.vars);
  varsRef.current = p.vars;
  onError.current = p.onError;

  // The page is reloaded whenever what it runs changes.
  const init = {
    type: "init",
    html: p.html,
    libs: p.libs,
    params: p.params,
    vars: p.vars,
    seed: seedOf(`${p.graphic}/${p.visual}`),
    duration: p.duration,
    accent: p.accent,
    font: p.font,
    fonts: p.fonts,
  };
  const initKey = JSON.stringify(init);

  // Hold the render until the page has loaded its libraries, run its script and drawn its first frame
  // (the frame effect releases it, so there's no gap for a screenshot of an empty page).
  const starting = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    setReady(false);
    const handle = rendering
      ? delayRender(`graphic ${p.graphic}: starting`, { timeoutInMilliseconds: 60_000 })
      : null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      starting.current = null;
      if (handle !== null) continueRender(handle);
    };
    starting.current = finish;
    const timer = setTimeout(() => {
      onError.current("the graphic didn't start in time");
      finish();
    }, START_TIMEOUT);
    const onMessage = (e: MessageEvent) => {
      if (!iframe.current || e.source !== iframe.current.contentWindow) return;
      const m = e.data as { type?: string; frame?: number; message?: string };
      if (m.type === "ready") {
        setReady(true);
        if (!rendering) finish();
      } else if (m.type === "drawn" && typeof m.frame === "number") {
        waiting.current.get(m.frame)?.();
      } else if (m.type === "error") {
        onError.current(String(m.message));
      }
    };
    window.addEventListener("message", onMessage);
    const el = iframe.current;
    const start = () => el?.contentWindow?.postMessage(JSON.parse(initKey), "*");
    el?.addEventListener("load", start);
    return () => {
      window.removeEventListener("message", onMessage);
      el?.removeEventListener("load", start);
      finish();
    };
  }, [initKey, rendering, p.graphic]);

  // Draw each frame; while rendering, wait for the page to finish it.
  useLayoutEffect(() => {
    const win = iframe.current?.contentWindow;
    if (!ready || !win) return;
    if (!rendering) {
      win.postMessage({ type: "frame", frame, t: frame / fps, vars: varsRef.current }, "*");
      return;
    }
    const handle = delayRender(`graphic ${p.graphic}: frame ${frame}`);
    const finish = () => {
      clearTimeout(timer);
      waiting.current.delete(frame);
      continueRender(handle);
    };
    const timer = setTimeout(() => {
      onError.current(`frame ${frame} took longer than ${FRAME_TIMEOUT / 1000}s to draw`);
      finish();
    }, FRAME_TIMEOUT);
    waiting.current.set(frame, finish);
    starting.current?.();
    win.postMessage({ type: "frame", frame, t: frame / fps, vars: varsRef.current }, "*");
    return () => {
      if (waiting.current.get(frame) === finish) finish();
    };
  }, [frame, fps, ready, rendering, p.graphic]);

  return (
    <iframe
      key={initKey}
      ref={iframe}
      title={p.graphic}
      src={`${p.mediaBase}runtime/graphic.html`}
      sandbox="allow-scripts"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        background: "transparent",
        // A dark-preferring embedder gives a "normal" frame an opaque white canvas; "light" keeps it clear.
        colorScheme: "light",
        pointerEvents: "none",
      }}
    />
  );
}

/** Lets the editor show a graphic's runtime errors live; export and stills read the console line. */
export function reportGraphicError(graphic: string, visual: string, message: string): void {
  console.error(`[graphic-error] ${graphic}: ${message}`);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("vedit:graphic-error", { detail: { graphic, visual, message } }));
}
