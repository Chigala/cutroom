/**
 * Renders one graphic file: fills its {{params}}, sanitizes the HTML, mounts it in a shadow root (so its
 * CSS can't leak out and the app's can't leak in), and on every frame seeks every CSS animation inside it
 * to the video's clock. That is what makes a hand-written web page render deterministically: the browser
 * never plays the animation, we place it at exactly frame / fps.
 */

import {
  type Graphic,
  graphicParams,
  isScripted,
  KIT_CSS,
  parseGraphic,
  prepareKit,
  renderTemplate,
} from "@vedit/project";
import DOMPurify from "dompurify";
import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ProjectFontsContext } from "./fonts.ts";
import { reportGraphicError, ScriptedGraphic } from "./ScriptedGraphic.tsx";
import { seekAnimations } from "./seek.ts";

export const HOUSE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** No scripts, no frames, no remote loads: a graphic is markup and style, nothing else. */
function sanitize(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORCE_BODY: true,
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      "form",
      "input",
      "video",
      "audio",
    ],
  });
  // CSS can still ask for remote files; graphics are self-contained, so cut those requests off.
  return clean
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(['"]?)\s*(https?:|\/\/)/gi, "url($1about:invalid#");
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

function format(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function seek(root: ShadowRoot, host: HTMLElement, t: number, duration: number): void {
  host.style.setProperty("--t", t.toFixed(4));
  host.style.setProperty("--progress", Math.min(1, Math.max(0, t / duration)).toFixed(4));
  seekAnimations(root, () => t);
  for (const el of root.querySelectorAll<HTMLElement>("[data-count]")) {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target)) continue;
    const start = Number(el.dataset.countStart ?? 0.1);
    const span = Number(el.dataset.countDuration ?? 1);
    const p = easeOut(Math.min(1, Math.max(0, (t - start) / Math.max(0.01, span))));
    el.textContent = format(target * p, Number(el.dataset.decimals ?? 0));
  }
}

/** Bars sized against the largest value in the graphic. Static, so done once per mount. */
function sizeBars(root: ShadowRoot): void {
  const bars = [...root.querySelectorAll<HTMLElement>("[data-bar]")];
  const max = Math.max(...bars.map((b) => Math.abs(Number(b.dataset.bar) || 0)), 1e-9);
  for (const b of bars) b.style.width = `${(Math.abs(Number(b.dataset.bar) || 0) / max) * 100}%`;
}

export interface GraphicViewProps {
  readonly graphic: Graphic | undefined;
  readonly params: Readonly<Record<string, unknown>>;
  /** Length of the visual, seconds: drives --duration and --exit. */
  readonly duration: number;
  readonly accent: string;
  readonly font: string;
  /** More CSS variables about the frame, like where the face is (--face-top, --clear-y). */
  readonly vars?: Readonly<Record<string, string>> | undefined;
  /** Where the scripted-graphics runtime is served (`${mediaBase}runtime/graphic.html`). */
  readonly mediaBase?: string | undefined;
  /** The visual showing it: seeds a scripted graphic's randomness. */
  readonly visual?: string | undefined;
}

export function GraphicView(props: GraphicViewProps) {
  const { graphic, params, duration, accent, font, vars, mediaBase, visual = "" } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<ShadowRoot | null>(null);
  const paramsKey = JSON.stringify(params);
  // A runtime error belongs to this version of the graphic and its values: change either for a fresh start.
  const errorKey = `${graphic?.html}\u0000${paramsKey}`;
  const projectFonts = useContext(ProjectFontsContext);
  const [thrown, setThrown] = useState<{ key: string; message: string } | null>(null);
  const runtimeError = thrown?.key === errorKey ? thrown.message : null;

  const result = useMemo(() => {
    if (!graphic) return { html: null, error: "missing graphic" } as const;
    try {
      const { meta, body } = parseGraphic(graphic.html);
      const filled = graphicParams(meta, JSON.parse(paramsKey));
      if (isScripted(meta, body))
        return {
          html: null,
          scripted: { html: renderTemplate(body, filled), libs: meta.libs, params: filled },
          error: null,
        };
      return { html: sanitize(renderTemplate(body, filled)), error: null };
    } catch (err) {
      return { html: null, error: (err as Error).message };
    }
  }, [graphic, paramsKey]);
  const cssVars = {
    "--duration": `${duration}s`,
    "--exit": `${Math.max(0, duration - 0.35)}s`,
    "--accent": accent,
    "--font": font,
    "--ease": HOUSE_EASE,
    ...vars,
  };
  const graphicId = graphic?.id ?? "";
  const onRuntimeError = useCallback(
    (message: string) => {
      setThrown({ key: errorKey, message });
      reportGraphicError(graphicId, visual, message);
    },
    [graphicId, visual, errorKey],
  );

  // Mount (or re-mount when the graphic or its values change).
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || result.html === null) return;
    root.current ??= el.shadowRoot ?? el.attachShadow({ mode: "open" });
    // The kit's building blocks go first, so the graphic's own CSS always wins.
    root.current.innerHTML = `<style>${KIT_CSS}</style>${result.html}`;
    prepareKit(root.current);
    sizeBars(root.current);
  }, [result.html]);

  // Seek on every frame, and after every re-mount.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !root.current || result.html === null) return;
    seek(root.current, el, frame / fps, duration);
  }, [frame, fps, duration, result.html]);

  const error = result.error ?? runtimeError;
  if (result.scripted && !error) {
    if (!mediaBase)
      return <ErrorBox font={font} text={`${graphicId}: scripted graphics need the editor's runtime`} />;
    return (
      <ScriptedGraphic
        graphic={graphicId}
        visual={visual}
        html={result.scripted.html}
        libs={result.scripted.libs}
        params={result.scripted.params}
        vars={cssVars}
        duration={duration}
        accent={accent}
        font={font}
        mediaBase={mediaBase}
        fonts={projectFonts}
        onError={onRuntimeError}
      />
    );
  }

  if (error)
    return (
      <ErrorBox
        font={font}
        text={graphic ? `${graphic.id}: ${error}` : "This visual's graphic was deleted"}
      />
    );

  return <div ref={host} style={{ position: "absolute", inset: 0, ...cssVars } as React.CSSProperties} />;
}

function ErrorBox({ text, font }: { text: string; font: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 40,
        top: 160,
        right: 40,
        padding: "12px 20px",
        borderRadius: 14,
        background: "rgba(120,20,20,0.85)",
        color: "#fff",
        fontSize: 30,
        fontFamily: font,
      }}
    >
      {text}
    </div>
  );
}
