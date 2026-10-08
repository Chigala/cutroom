/**
 * Graphics are small web pages: graphics/<id>.html. This is their template language, kept tiny on
 * purpose so anyone (or the agent) can write one:
 *
 *   <!-- graphic {"name": "Callout", "duration": 3,
 *                 "params": {"title": {"type": "text", "default": "Big point"}}} -->
 *   <style> .title { animation: rise .5s var(--ease) both } @keyframes rise { from { opacity: 0 } } </style>
 *   <div class="title">{{title}}</div>
 *
 * - {{name}}               a param, HTML-escaped; *words in stars* become <em class="hl"> (accent them in CSS)
 * - {{#items}}…{{/items}}  repeat for each item of a list ({{.}} is the item, {{@index}} its position);
 *                          for a non-list value, render once if it is truthy
 * - {{^name}}…{{/name}}    render when the value is empty or false
 *
 * Motion is plain CSS. The renderer seeks every animation to the video's clock each frame, and sets:
 * --t (seconds in, as a number), --duration and --exit (times: the end, and 0.35s before it), --accent,
 * --font and --ease. Over the speaker (overlay layout) it also sets where their face is, as fractions of
 * the frame height: --face-x, --face-top, --face-bottom, and --clear-y, the top of a slot for a short
 * block of text that keeps off the face and the captions (top: calc(var(--clear-y, .54) * 100cqh)).
 * Elements with data-count="1234" count up to that number.
 *
 * Scripted graphics: a graphic may also contain <script>, and ask for libraries in its header
 * ("libs": any of gsap, three, lottie, d3, chart, rough, matter; see GRAPHIC_LIBS). It then runs in a sandboxed
 * page with no network, where
 * time, Math.random, Date.now and requestAnimationFrame follow the video clock, so the same moment always
 * draws the same pixels:
 *
 *   graphic.params                  the filled params (read them here, not with {{}} inside a script)
 *   graphic.onFrame((t, f) => …)    draw the frame at t seconds; f = { duration, width, height, params,
 *                                   vars, accent, font, random } (random is seeded, fresh each frame)
 *   gsap.from/to/timeline           just work: every tween is seeked to t
 *   graphic.timeline(tl)            seeks a timeline you paused or nested yourself
 *   graphic.lottie(anim)            seeks a lottie animation (loadAnimation with autoplay: false)
 *   graphic.particles({ preset, … })  confetti, burst, sparks, snow, dust, embers or bokeh on a canvas
 *                                   of their own; every option of the preset can be overridden
 *   CSS animations                  seeked to t, as in plain graphics
 */

export type ParamType = "text" | "number" | "list" | "choice" | "boolean" | "color";

export interface ParamSpec {
  readonly type: ParamType;
  readonly label?: string;
  /** Help for whoever fills it in: a person in the inspector, or the agent. */
  readonly description?: string;
  readonly default?: unknown;
  readonly options?: readonly string[];
}

export interface GraphicMeta {
  readonly name: string;
  readonly description: string;
  /** Suggested length in seconds. */
  readonly duration: number;
  readonly params: Readonly<Record<string, ParamSpec>>;
  /** Libraries a scripted graphic loads, from GRAPHIC_LIBS. */
  readonly libs: readonly string[];
}

/** Libraries a scripted graphic can load, and the global each one sets. */
export const GRAPHIC_LIBS: Readonly<Record<string, string>> = {
  /** GSAP with its plugins registered: SplitText, ScrambleText, Text, DrawSVG, MorphSVG, MotionPath, CustomEase, Physics2D. */
  gsap: "gsap",
  three: "THREE",
  lottie: "lottie",
  /** D3 v7: scales, shapes, axes, layouts for charts drawn from the time (no d3 transitions). */
  d3: "d3",
  /** Chart.js v4: standard charts, animation off; grow them by updating data in onFrame. */
  chart: "Chart",
  /** Rough.js: hand-drawn, sketchy shapes (its randomness follows the video clock). */
  rough: "rough",
  /** Matter.js: rigid bodies that fall, stack, bounce and collide; graphic.physics steps it from the time. */
  matter: "Matter",
};

/** Whether a graphic runs code (and so renders in the sandboxed runtime rather than inline). */
export const isScripted = (meta: GraphicMeta, body: string): boolean =>
  meta.libs.length > 0 || /<script\b/i.test(body);

/** What a scripted graphic can't do, caught early with a readable message. The runtime's CSP enforces it. */
const NETWORK =
  /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon|RTCPeerConnection)\b|\bimport\s*\(/;

const HEADER = /^\s*<!--\s*graphic\s+(\{[\s\S]*?\})\s*-->/;

export class GraphicError extends Error {
  override name = "GraphicError";
}

/** Splits a graphic file into its header and body. Throws GraphicError when the header is malformed. */
export function parseGraphic(html: string): { meta: GraphicMeta; body: string } {
  const m = HEADER.exec(html);
  let raw: Record<string, unknown> = {};
  if (m) {
    try {
      raw = JSON.parse(m[1]!) as Record<string, unknown>;
    } catch (err) {
      throw new GraphicError(`the graphic header is not valid JSON: ${(err as Error).message}`);
    }
  }
  const params: Record<string, ParamSpec> = {};
  for (const [key, spec] of Object.entries((raw.params as Record<string, Partial<ParamSpec>>) ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new GraphicError(`param "${key}" needs a simple name`);
    params[key] = { type: spec?.type ?? "text", ...spec } as ParamSpec;
  }
  return {
    meta: {
      name: typeof raw.name === "string" ? raw.name : "Graphic",
      description: typeof raw.description === "string" ? raw.description : "",
      duration: typeof raw.duration === "number" ? raw.duration : 3,
      params,
      libs: Array.isArray(raw.libs) ? raw.libs.map(String) : [],
    },
    body: m ? html.slice(m[0].length) : html,
  };
}

const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const empty = (v: unknown) =>
  v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && !v.length);

function lookup(scope: readonly Record<string, unknown>[], name: string): unknown {
  if (name === ".") return scope[0]?.["."];
  for (const frame of scope) {
    if (name in frame) return frame[name];
  }
  return undefined;
}

/** Fills a template. Unknown names render empty; sections must be closed. */
export function renderTemplate(body: string, params: Readonly<Record<string, unknown>>): string {
  const render = (text: string, scope: Record<string, unknown>[]): string => {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{{", i);
      if (open < 0) {
        out += text.slice(i);
        break;
      }
      out += text.slice(i, open);
      const close = text.indexOf("}}", open);
      if (close < 0) throw new GraphicError("a {{ is never closed");
      const tag = text.slice(open + 2, close).trim();
      i = close + 2;
      if (tag.startsWith("#") || tag.startsWith("^")) {
        const name = tag.slice(1).trim();
        const end = findClose(text, i, name);
        const inner = text.slice(i, end.start);
        i = end.after;
        const value = lookup(scope, name);
        if (tag.startsWith("^")) {
          if (empty(value)) out += render(inner, scope);
        } else if (Array.isArray(value)) {
          value.forEach((item, index) => {
            const frame: Record<string, unknown> =
              item && typeof item === "object" && !Array.isArray(item)
                ? { ...(item as Record<string, unknown>), ".": item, "@index": index }
                : { ".": item, "@index": index };
            out += render(inner, [frame, ...scope]);
          });
        } else if (!empty(value)) {
          out += render(
            inner,
            value && typeof value === "object" ? [value as Record<string, unknown>, ...scope] : scope,
          );
        }
      } else if (tag.startsWith("/")) {
        throw new GraphicError(`{{${tag}}} has no matching opening tag`);
      } else {
        // *stars* mark words to highlight, in any text value.
        out += escapeHtml(lookup(scope, tag)).replace(/\*([^*\n]+)\*/g, '<em class="hl">$1</em>');
      }
    }
    return out;
  };
  return render(body, [{ ...params }]);
}

function findClose(text: string, from: number, name: string): { start: number; after: number } {
  let depth = 1;
  const re = /\{\{\s*([#^/])\s*([^}\s]+)\s*\}\}/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[2] !== name) continue;
    if (m[1] === "/") depth--;
    else depth++;
    if (depth === 0) return { start: m.index, after: m.index + m[0].length };
  }
  throw new GraphicError(`{{#${name}}} is never closed with {{/${name}}}`);
}

/** Header defaults merged under the visual's values. */
export function graphicParams(
  meta: GraphicMeta,
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(meta.params)) out[key] = spec.default;
  return { ...out, ...params };
}

/** Checks a graphic file the way the renderer will read it. Returns a readable problem, or null. */
export function validateGraphic(html: string): string | null {
  try {
    const { meta, body } = parseGraphic(html);
    renderTemplate(body, graphicParams(meta, {}));
    const unknown = meta.libs.filter((l) => !(l in GRAPHIC_LIBS));
    if (unknown.length)
      return `unknown libs: ${unknown.join(", ")} (available: ${Object.keys(GRAPHIC_LIBS).join(", ")})`;
    if (/<script\b[^>]*\bsrc\s*=/i.test(body))
      return 'graphics can\'t load scripts from files or the web: ask for a library in "libs" instead';
    const net = NETWORK.exec(body);
    if (net)
      return `graphics can't use the network (${net[0].trim()}): everything they need must be in the file`;
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
