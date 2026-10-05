/**
 * Deterministic CSS animation: every animation in a shadow root placed at a time, as a pure function
 * of that time.
 */

/** Each element's own animation delays, read once before we start overriding them. */
const baseDelays = new WeakMap<Element, number[]>();

function delaysOf(el: Element): number[] {
  const cached = baseDelays.get(el);
  if (cached) return cached;
  const style = getComputedStyle(el);
  // Before an element is in a rendered document (a thumbnail's first paint), its style isn't computed
  // yet: read it next time rather than remember "no animations".
  if (!el.isConnected || !style.animationName) return [];
  const d =
    style.animationName === "none"
      ? []
      : style.animationDelay.split(",").map((v) => {
          const x = Number.parseFloat(v);
          return Number.isFinite(x) ? (v.trim().endsWith("ms") ? x / 1000 : x) : 0;
        });
  baseDelays.set(el, d);
  return d;
}

/**
 * Places every animation at its element's time (`timeOf`, seconds). Pure function of t, safe in any order, and independent of
 * when the browser creates the animations: each one is paused with its delay shifted by -t, so the
 * moment it exists it is already at the right frame. (Seeking Animation objects is not enough: the
 * renderer mounts a frame before it is displayed, and CSS animations only exist once it is.)
 */
export function seekAnimations(root: ShadowRoot, timeOf: (el: Element) => number): void {
  for (const el of root.querySelectorAll<HTMLElement | SVGElement>("*")) {
    const delays = delaysOf(el);
    if (!delays.length) continue;
    const t = timeOf(el);
    el.style.animationPlayState = "paused";
    el.style.animationDelay = delays.map((d) => `${(d - t).toFixed(4)}s`).join(", ");
  }
}
