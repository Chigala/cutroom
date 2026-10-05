/**
 * Runs an effect, transition or grade file (see styles.ts in @vedit/project) on the real footage.
 *
 * - Its layer rules (.frame, .out, .in, .picture) are rewritten to an attribute set only on the wrapper
 *   each layer stands for (css-scope.ts), so they style the footage itself and nothing else.
 * - Its .overlay is drawn in a shadow root on top, where the file's CSS can't leak out.
 * - Every animation is seeked to the file's clock with shifted, paused delays: a pure function of the
 *   time that works before the frame is even displayed (the renderer mounts frames ahead of showing
 *   them, so reading back computed styles wouldn't).
 */

import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import { layerAttr, scopeCss } from "./css-scope.ts";
import { seekAnimations } from "./seek.ts";

const sanitizeCss = (css: string) =>
  css
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(['"]?)\s*(https?:|\/\/)/gi, "url($1about:invalid#")
    .replace(/<\/?style[^>]*>/gi, "");

const toSeconds = (v: string) => {
  const x = Number.parseFloat(v);
  return Number.isFinite(x) ? (v.trim().endsWith("ms") ? x / 1000 : x) : 0;
};

const VARS = ["--t", "--duration", "--progress", "--accent"] as const;

let counter = 0;

export function StyleLayer({
  css,
  t,
  duration,
  accent,
  targets,
}: {
  css: string;
  /** Seconds on the file's clock. */
  t: number;
  duration: number;
  accent: string;
  /** Layer class name -> the element it styles (or several, styled alike: the footage and its cutout). */
  targets: Readonly<Record<string, RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[]>>;
}) {
  const uid = useMemo(() => `vfx${(++counter).toString(36)}`, []);
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<ShadowRoot | null>(null);
  const layersKey = Object.keys(targets).join(" ");
  const clean = useMemo(() => sanitizeCss(css), [css]);
  const scoped = useMemo(
    () => scopeCss(clean, uid, layersKey.split(" ").filter(Boolean)),
    [clean, uid, layersKey],
  );
  /** Each target's own animation delays, read once the rules apply and before we shift them. */
  const bases = useRef(new Map<HTMLElement, number[]>());
  const latest = useRef(targets);
  latest.current = targets;

  // The overlay, in its own shadow root.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    root.current ??= el.shadowRoot ?? el.attachShadow({ mode: "open" });
    root.current.innerHTML = `<style>
:host { position: absolute; inset: 0; pointer-events: none; }
.scope { position: absolute; inset: 0; container-type: size; overflow: hidden; }
${clean}
</style><div class="scope"><div class="overlay"></div></div>`;
  }, [clean]);

  // The layer rules, scoped to the targets, while this file runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layersKey stands for the targets.
  useLayoutEffect(() => {
    const style = document.createElement("style");
    style.setAttribute(layerAttr, uid);
    style.textContent = scoped;
    document.head.append(style);
    const tagged: [HTMLElement, string][] = [];
    bases.current.clear();
    for (const [layer, refs] of Object.entries(latest.current))
      for (const ref of [refs].flat()) {
        const el = ref.current;
        if (!el) continue;
        const token = `${uid}-${layer}`;
        const tokens = new Set((el.getAttribute(layerAttr) ?? "").split(" ").filter(Boolean));
        tokens.add(token);
        el.setAttribute(layerAttr, [...tokens].join(" "));
        tagged.push([el, token]);
        // Delays can depend on the length (calc(var(--duration) - 0.2s)): set it before reading them.
        el.style.setProperty("--duration", `${duration}s`);
        el.style.setProperty("--accent", accent);
        el.style.animationDelay = "";
        el.style.animationPlayState = "";
        const computed = getComputedStyle(el);
        bases.current.set(
          el,
          computed.animationName === "none" || !computed.animationName
            ? []
            : computed.animationDelay.split(",").map(toSeconds),
        );
      }
    return () => {
      style.remove();
      for (const [el, token] of tagged) {
        const rest = (el.getAttribute(layerAttr) ?? "")
          .split(" ")
          .filter((x) => x && x !== token)
          .join(" ");
        if (rest) el.setAttribute(layerAttr, rest);
        else el.removeAttribute(layerAttr);
        el.style.animationDelay = "";
        el.style.animationPlayState = "";
        for (const v of VARS) el.style.removeProperty(v);
      }
    };
  }, [scoped, uid, layersKey, duration, accent]);

  // Every frame: the clock, then every animation placed on it.
  useLayoutEffect(() => {
    const vars: Record<(typeof VARS)[number], string> = {
      "--t": t.toFixed(4),
      "--duration": `${duration}s`,
      "--progress": Math.min(1, Math.max(0, t / duration)).toFixed(4),
      "--accent": accent,
    };
    const scope = root.current?.querySelector<HTMLElement>(".scope");
    for (const [k, v] of Object.entries(vars)) scope?.style.setProperty(k, v);
    if (root.current) seekAnimations(root.current, () => t);
    for (const [el, delays] of bases.current) {
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
      if (!delays.length) continue;
      el.style.animationPlayState = "paused";
      el.style.animationDelay = delays.map((d) => `${(d - t).toFixed(4)}s`).join(", ");
    }
  });

  return <div ref={host} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
}
