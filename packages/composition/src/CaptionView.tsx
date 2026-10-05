/**
 * One caption page, drawn by a caption look (captions/looks/<id>.css; see caption-looks.ts in
 * @vedit/project for the hooks). The engine places the block; the look's CSS, in a shadow root, decides
 * how it looks, and its animations are seeked to the video's clock: on .caption to the page's time, on
 * each .word to that word's own time.
 */

import type { CaptionStyle } from "@vedit/project";
import { type CSSProperties, useLayoutEffect, useMemo, useRef } from "react";
import { seekAnimations } from "./seek.ts";

export interface CaptionWord {
  readonly text: string;
  /** When it's said, in seconds of output time. */
  readonly at: number;
  readonly emphasis: boolean;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Looks are self-contained: no imports or remote files, even if a hand edit slips one in. */
const sanitizeCss = (css: string) =>
  css
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(['"]?)\s*(https?:|\/\/)/gi, "url($1about:invalid#")
    .replace(/<\/?style[^>]*>/gi, "");

export function CaptionView({
  css,
  words,
  start,
  t,
  style,
  place,
  box,
}: {
  css: string;
  words: readonly CaptionWord[];
  /** When the page appears, seconds. */
  start: number;
  /** Now, seconds. */
  t: number;
  style: CaptionStyle;
  place: "usual" | "above" | "seam";
  /** Where the engine puts the block. */
  box: CSSProperties;
}) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<ShadowRoot | null>(null);
  const now = words.findLastIndex((w) => t >= w.at);

  const markup = useMemo(() => {
    const vars = [
      `--size: ${style.size}px`,
      `--color: ${style.color}`,
      `--accent: ${style.accent}`,
      `--words: ${words.length}`,
      // Single quotes: this goes inside a double-quoted style attribute.
      ...(style.font ? [`--font: '${style.font.replace(/["'\\<>&]/g, "")}'`] : []),
    ].join("; ");
    const spans = words
      .map((w, i) => {
        const state = i < now ? "said" : i === now ? "now" : "next";
        return `<span class="word ${state}${w.emphasis ? " hl" : ""}" style="--i: ${i}">${escapeHtml(w.text)}</span>`;
      })
      .join(" ");
    return `<style>:host { display: block; }\n${sanitizeCss(css)}</style><div class="caption" data-preset="${style.preset}" data-place="${place}" style="${vars}">${spans}</div>`;
  }, [css, words, now, style.size, style.color, style.accent, style.font, style.preset, place]);

  // Re-mount when the words, their states or the look change; every animation is re-seeked below.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    root.current ??= el.shadowRoot ?? el.attachShadow({ mode: "open" });
    root.current.innerHTML = markup;
  }, [markup]);

  // Every frame: the clocks, then every animation placed on its own clock. Also after every re-mount
  // (markup), which can happen while paused, when the time hasn't moved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: markup re-runs this after a re-mount.
  useLayoutEffect(() => {
    const r = root.current;
    if (!r) return;
    const caption = r.querySelector<HTMLElement>(".caption");
    caption?.style.setProperty("--page-t", (t - start).toFixed(4));
    const spans = [...r.querySelectorAll<HTMLElement>(".word")];
    const wordT = new Map<Element, number>();
    spans.forEach((span, i) => {
      const wt = t - (words[i]?.at ?? start);
      wordT.set(span, wt);
      span.style.setProperty("--word-t", wt.toFixed(4));
    });
    seekAnimations(r, (el) => {
      const word = el.closest(".word");
      return word ? (wordT.get(word) ?? 0) : t - start;
    });
  }, [t, start, words, markup]);

  return (
    <div
      ref={host}
      style={{ ...box, textAlign: "center", textTransform: style.uppercase ? "uppercase" : "none" }}
    />
  );
}
