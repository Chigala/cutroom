/**
 * The runtime for scripted graphics: a page that runs one graphic in a sandboxed iframe
 * (sandbox="allow-scripts", so an opaque origin with no access to the app), served next to the media at
 * `${mediaBase}runtime/graphic.html` by the editor's media protocol, the export server and the web
 * build. The libraries and the house fonts are served from the same place; the page's CSP allows
 * nothing else, so a graphic can't reach the network.
 *
 * The parent (ScriptedGraphic in @vedit/composition) posts:
 *   { type: "init", html, libs, params, vars, seed, duration, accent, font, fonts } -> { type: "ready" }
 *   { type: "frame", frame, t }                                                -> { type: "drawn", frame }
 * and the page posts { type: "error", message } for anything that throws.
 *
 * Kept free of heavy imports: the web build loads this file on its own.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUNDLED_FONTS, fontFile, KIT_CSS, KIT_EASES, prepareKit } from "@vedit/project";

const require = createRequire(import.meta.url);
const packageDir = (name: string) => {
  // Packages' "exports" may hide package.json; their main entry is always resolvable.
  let dir = path.dirname(require.resolve(name));
  while (path.basename(dir) !== name.split("/").pop() && dir !== path.dirname(dir)) dir = path.dirname(dir);
  return dir;
};

/** GSAP's plugins (free since 3.13), loaded and registered with "gsap": text, SVG, paths, physics. */
const GSAP_PLUGINS = [
  "SplitText",
  "ScrambleTextPlugin",
  "TextPlugin",
  "DrawSVGPlugin",
  "MorphSVGPlugin",
  "MotionPathPlugin",
  "CustomEase",
  "Physics2DPlugin",
];

const LIB_FILES: Record<string, () => string> = {
  "lib/gsap.min.js": () => path.join(packageDir("gsap"), "dist/gsap.min.js"),
  ...Object.fromEntries(
    GSAP_PLUGINS.map((p) => [
      `lib/gsap/${p}.min.js`,
      () => path.join(packageDir("gsap"), `dist/${p}.min.js`),
    ]),
  ),
  "lib/d3.min.js": () => path.join(packageDir("d3"), "dist/d3.min.js"),
  "lib/chart.umd.min.js": () => path.join(packageDir("chart.js"), "dist/chart.umd.min.js"),
  "lib/rough.js": () => path.join(packageDir("roughjs"), "bundled/rough.js"),
  "lib/lottie.min.js": () => path.join(packageDir("lottie-web"), "build/player/lottie.min.js"),
  "lib/matter.min.js": () => path.join(packageDir("matter-js"), "build/matter.min.js"),
  "lib/three.module.js": () => path.join(packageDir("three"), "build/three.module.js"),
  "lib/three.core.js": () => path.join(packageDir("three"), "build/three.core.js"),
};
for (const f of BUNDLED_FONTS) {
  for (const weight of f.weights) {
    LIB_FILES[`fonts/${fontFile(f, weight)}`] = () =>
      path.join(packageDir(`@fontsource/${f.pkg}`), `files/${f.pkg}-latin-${weight}-normal.woff2`);
  }
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
${BUNDLED_FONTS.flatMap((f) =>
  f.weights.map(
    (w) =>
      `@font-face { font-family: "${f.family}"; font-weight: ${w}; font-style: normal; src: url(fonts/${fontFile(f, w)}) format("woff2"); }`,
  ),
).join("\n")}
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; color-scheme: light; }
body { position: relative; color: #fff; font-family: var(--font, "IBM Plex Sans", sans-serif); -webkit-font-smoothing: antialiased; }
</style>
<script src="runtime.js"></script>
</head><body></body></html>
`;

const SCRIPT = `(() => {
  "use strict";
  const host = window.parent;
  const post = (m) => host.postMessage(m, "*");
  // Same t, same pixels: time, randomness and animation frames all come from the video clock.
  let now = 0;
  let seed = 1;
  const seeded = (s) => () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  let random = seeded(seed);
  Math.random = () => random();
  Date.now = () => Math.round(now * 1000);
  performance.now = () => now * 1000;
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};

  const report = (message) => post({ type: "error", message: String(message || "unknown error") });
  window.addEventListener("error", (e) => report(e.error && e.error.message ? e.error.message : e.message));
  window.addEventListener("unhandledrejection", (e) => report(e.reason && e.reason.message ? e.reason.message : e.reason));

  const drawers = [];
  const timelines = [];
  const lotties = [];
  let info = null;
  window.graphic = {
    params: {},
    onFrame(fn) { drawers.push(fn); },
    timeline(tl) { tl.pause(); timelines.push(tl); return tl; },
    lottie(anim) { lotties.push(anim); return anim; },
    particles(opts) { return particles(opts || {}); },
    physics(opts) { return physics(opts); },
  };

  const script = (src) => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => fail(new Error("couldn't load " + src));
    document.head.append(s);
  });
  const GSAP_PLUGINS = ${JSON.stringify(GSAP_PLUGINS)};
  const KIT_CSS = ${JSON.stringify(KIT_CSS)};
  const KIT_EASES = ${JSON.stringify(KIT_EASES)};
  ${prepareKit.toString()}
  const SCRIPTS = { lottie: "lib/lottie.min.js", d3: "lib/d3.min.js", chart: "lib/chart.umd.min.js", rough: "lib/rough.js", matter: "lib/matter.min.js" };
  async function load(lib) {
    if (lib === "three") {
      await new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.type = "module";
        s.textContent = 'import * as THREE from "' + new URL("lib/three.module.js", location.href) + '"; window.THREE = THREE; window.dispatchEvent(new Event("vedit:three"));';
        window.addEventListener("vedit:three", () => ok(), { once: true });
        s.onerror = () => fail(new Error("couldn't load three"));
        document.head.append(s);
      });
    } else if (lib === "gsap") {
      await script("lib/gsap.min.js");
      for (const p of GSAP_PLUGINS) await script("lib/gsap/" + p + ".min.js");
      window.gsap.registerPlugin(...GSAP_PLUGINS.map((p) => window[p]).filter(Boolean));
    } else if (SCRIPTS[lib]) {
      await script(SCRIPTS[lib]);
    } else {
      throw new Error("unknown library " + lib);
    }
    if (lib === "chart" && window.Chart) {
      // Charts draw from the clock: no animation loop of their own (it would never tick), a fixed
      // size, the project's font. Grow them by updating data in onFrame and chart.update("none").
      const d = window.Chart.defaults;
      d.animation = false;
      d.responsive = false;
      d.maintainAspectRatio = false;
      d.devicePixelRatio = window.devicePixelRatio || 1;
      d.color = "#fff";
      d.borderColor = "rgba(255,255,255,.14)";
      if (info && info.font) d.font.family = info.font;
    }
  }

  // Particles that are a pure function of time: every particle's path is worked out from its birth,
  // velocity, gravity and drag (closed form), never stepped frame to frame, so any frame draws the
  // same on its own (exports render frames out of order, in parallel).
  const PRESETS = {
    confetti: { count: 150, emit: 0.12, life: 3.4, speed: [1000, 1900], angle: -90, spread: 32, gravity: 1500, drag: 1.1, size: [10, 18], shape: "rect", spin: [3, 9], flip: [6, 14], fade: 0.25, origin: { x: 0.5, y: 0.72 } },
    burst: { count: 130, emit: 0.05, life: 1.4, speed: [600, 1800], angle: 0, spread: 180, gravity: 300, drag: 2.4, size: [8, 18], shape: "circle", glow: true, fade: 0.6, origin: { x: 0.5, y: 0.5 } },
    sparks: { count: 140, emit: 0.3, life: 1, speed: [800, 1900], angle: -90, spread: 38, gravity: 1900, drag: 1.2, size: [4, 7], shape: "streak", glow: true, fade: 0.5, colors: ["#fff6d5", "#ffc76b", "#ff8a2a"], origin: { x: 0.5, y: 0.75 } },
    snow: { continuous: true, area: "top", count: 120, life: 9, speed: [60, 150], angle: 90, spread: 14, gravity: 0, drag: 0, size: [3, 8], shape: "circle", wobble: 28, opacity: 0.9, colors: ["#ffffff"] },
    dust: { continuous: true, area: "full", count: 80, life: 6, speed: [8, 30], angle: 0, spread: 180, gravity: 0, drag: 0, size: [1.5, 3.5], shape: "circle", wobble: 14, opacity: 0.55, colors: ["#ffffff"] },
    embers: { continuous: true, area: "bottom", count: 70, life: 4.5, speed: [260, 520], angle: -90, spread: 18, gravity: -60, drag: 0.15, size: [5, 11], shape: "circle", glow: true, wobble: 30, colors: ["#ffe08a", "#ffab45", "#ff6a2a"] },
    bokeh: { continuous: true, area: "full", count: 26, life: 9, speed: [10, 40], angle: 0, spread: 180, gravity: 0, drag: 0, size: [50, 150], shape: "bokeh", opacity: 0.28, wobble: 20 },
  };
  let systems = 0;
  function particles(opts) {
    const preset = PRESETS[opts.preset || "confetti"];
    if (!preset) throw new Error("unknown particle preset " + opts.preset + " (" + Object.keys(PRESETS).join(", ") + ")");
    const o = Object.assign({ at: 0, opacity: 1, wobble: 0, spin: [0, 0], flip: [0, 0], fade: 0.3 }, preset, opts);
    const id = ++systems;
    const canvas = o.canvas || document.createElement("canvas");
    if (!o.canvas) {
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
      if (o.behind) document.body.prepend(canvas); else document.body.append(canvas);
    }
    const ctx = canvas.getContext("2d");
    const range = (r, v) => (Array.isArray(v) ? v[0] + r() * (v[1] - v[0]) : v);
    window.graphic.onFrame((t, f) => {
      const dpr = window.devicePixelRatio || 1;
      const W = f.width, H = f.height, k = W / 1080;
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Unless given: confetti is festive, everything else stays in the project's accent and white.
      const colors =
        o.colors || (o.shape === "rect" ? [f.accent, "#ffffff", "#ffd166", "#ff6b6b", "#5ad1ff"] : [f.accent, "#ffffff"]);
      const end = o.until != null ? o.until : f.duration;
      // Continuous kinds are born across the whole run (starting a life early, so the frame is full
      // from the first moment); count is how many are on screen at once.
      const span = o.continuous ? end - o.at + o.life : o.emit;
      const total = o.continuous ? Math.ceil((o.count * span) / o.life) : o.count;
      ctx.globalCompositeOperation = o.glow ? "lighter" : "source-over";
      for (let i = 0; i < total; i++) {
        const r = seeded((seed * 31 + id * 1000003 + i * 7919) | 0);
        const birth = o.continuous ? o.at - o.life + ((i + r()) / total) * span : o.at + r() * o.emit;
        const life = o.life * (0.7 + 0.3 * r());
        const age = t - birth;
        if (age < 0 || age > life) continue;
        const a = ((o.angle + (r() * 2 - 1) * o.spread) * Math.PI) / 180;
        const v = range(r, o.speed) * k;
        const vx = Math.cos(a) * v, vy = Math.sin(a) * v, g = o.gravity * k, d = o.drag;
        let x, y;
        if (o.continuous) {
          x = r() * W;
          y = o.area === "top" ? -40 * k : o.area === "bottom" ? H + 40 * k : r() * H;
        } else {
          const org = o.origin || { x: 0.5, y: 0.5 };
          x = org.x * W + (r() - 0.5) * 30 * k;
          y = org.y * H + (r() - 0.5) * 30 * k;
        }
        if (d > 0) {
          const e = (1 - Math.exp(-d * age)) / d;
          x += vx * e;
          y += (vy - g / d) * e + (g * age) / d;
        } else {
          x += vx * age;
          y += vy * age + 0.5 * g * age * age;
        }
        const phase = r() * Math.PI * 2;
        x += Math.sin(age * (1 + r() * 1.5) + phase) * o.wobble * k;
        const size = range(r, o.size) * k;
        const fadeIn = Math.min(1, age / 0.08);
        const fadeOut = Math.min(1, (life - age) / Math.max(0.05, life * o.fade));
        ctx.globalAlpha = Math.max(0, o.opacity * fadeIn * fadeOut);
        const color = colors[Math.floor(r() * colors.length) % colors.length];
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        if (o.shape === "rect") {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(phase + range(r, o.spin) * age);
          ctx.scale(1, Math.cos(phase + range(r, o.flip) * age));
          ctx.fillRect(-size / 2, -size * 0.3, size, size * 0.6);
          ctx.restore();
        } else if (o.shape === "streak") {
          const sp = Math.max(1, Math.hypot(vx, vy));
          ctx.lineWidth = size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - (vx / sp) * size * 6, y - (vy / sp) * size * 6);
          ctx.stroke();
        } else if (o.shape === "bokeh") {
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, color);
          grad.addColorStop(0.65, color);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    });
    return { canvas };
  }

  // Physics (Matter.js) as a function of time: setup builds the world, which is stepped at a fixed rate
  // from 0 up to t. Frames asked in order keep stepping the same world; an earlier one (a seek back, or
  // an export worker starting midway) builds it again from the start, so any frame draws the same on its
  // own. Matter's own randomness and ids, and Math.random in setup and in every step, are reset with it.
  function physics(opts) {
    const o = typeof opts === "function" ? { setup: opts } : opts || {};
    if (typeof o.setup !== "function") throw new Error("graphic.physics needs a setup(Matter, engine, f) function");
    const rate = o.rate || 120;
    let world = null;
    let steps = 0;
    const withRandom = (s, fn) => {
      const saved = Math.random;
      Math.random = seeded(s);
      try { return fn(); } finally { Math.random = saved; }
    };
    const build = (f) => {
      const M = window.Matter;
      if (!M) throw new Error('graphic.physics needs "matter" in libs');
      M.Common._seed = 0;
      M.Common._nextId = 0;
      const engine = M.Engine.create(o.engine || {});
      const made = withRandom(seed ^ 0x51ed270b, () => o.setup(M, engine, f));
      world = { engine, made: made === undefined ? engine : made };
      steps = 0;
    };
    const at = (t, f) => {
      const target = Math.max(0, Math.floor(t * rate + 1e-6));
      if (!world || target < steps) build(f);
      const M = window.Matter;
      while (steps < target) {
        withRandom((seed ^ Math.imul(steps + 1, 0x9e3779b1)) | 0, () => M.Engine.update(world.engine, 1000 / rate));
        steps++;
      }
      // Bodies made with plugin: { el } carry their element: centred on the body, turned with it.
      for (const b of M.Composite.allBodies(world.engine.world)) {
        const el = b.plugin && b.plugin.el;
        if (el) el.style.transform = "translate(" + b.position.x + "px," + b.position.y + "px) translate(-50%,-50%) rotate(" + b.angle + "rad)";
      }
      return world.made;
    };
    window.graphic.onFrame((t, f) => {
      const made = at(t, f);
      if (o.draw) return o.draw(made, t, f);
    });
    return { at };
  }

  async function init(m) {
    info = m;
    seed = m.seed | 0;
    random = seeded(seed);
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(m.vars)) root.setProperty(k, v);
    // The project's own fonts (fonts/); the bundled ones are declared in this page's CSS.
    await Promise.all((m.fonts || []).map((f) => {
      const face = new FontFace(f.family, 'url("' + f.url + '")', { weight: String(f.weight), style: f.style });
      document.fonts.add(face);
      return face.load().catch(() => report("couldn't load the font " + f.family));
    }));
    for (const lib of m.libs) await load(lib);
    if (window.gsap) {
      // Tweens attach to a paused global timeline at 0 and are seeked to the video's time every frame.
      window.gsap.globalTimeline.autoRemoveChildren = false;
      window.gsap.globalTimeline.pause(0);
    }
    // The kit's curves as GSAP eases ("k-out", "k-in"...), when CustomEase is there.
    if (window.CustomEase) for (const [name, curve] of Object.entries(KIT_EASES)) window.CustomEase.create(name, curve);
    window.graphic.params = m.params;
    // The kit's building blocks, before the graphic's own CSS so its CSS always wins.
    const kit = document.createElement("style");
    kit.textContent = KIT_CSS;
    document.head.append(kit);
    const tpl = document.createElement("template");
    tpl.innerHTML = m.html;
    const scripts = [...tpl.content.querySelectorAll("script")];
    for (const s of scripts) s.remove();
    document.body.append(tpl.content);
    prepareKit(document.body);
    for (const s of scripts) {
      const run = document.createElement("script");
      run.textContent = s.textContent;
      document.body.append(run);
    }
    await document.fonts.ready;
    post({ type: "ready" });
  }

  async function frame(m) {
    now = m.t;
    random = seeded(seed);
    document.documentElement.style.setProperty("--t", String(m.t));
    if (m.vars) {
      for (const [k, v] of Object.entries(m.vars)) document.documentElement.style.setProperty(k, v);
      info.vars = m.vars;
    }
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = m.t * 1000;
    }
    if (window.gsap) window.gsap.globalTimeline.totalTime(m.t, false);
    for (const tl of timelines) tl.totalTime(m.t, false);
    for (const a of lotties) a.goToAndStop(m.t * 1000, false);
    const f = {
      duration: info.duration,
      width: innerWidth,
      height: innerHeight,
      params: info.params,
      vars: info.vars,
      accent: info.accent,
      font: info.font,
      random: seeded(seed ^ 0x9e3779b9),
    };
    for (const draw of drawers) await draw(m.t, f);
    post({ type: "drawn", frame: m.frame });
  }

  let queue = Promise.resolve();
  window.addEventListener("message", (e) => {
    if (e.source !== host || !e.data || typeof e.data !== "object") return;
    const m = e.data;
    const step = m.type === "init" ? () => init(m) : m.type === "frame" ? () => frame(m) : null;
    if (!step) return;
    queue = queue.then(step).catch((err) => {
      report(err && err.message ? err.message : err);
      if (m.type === "frame") post({ type: "drawn", frame: m.frame });
      else post({ type: "ready" });
    });
  });
})();
`;

let generated: string | null = null;

/** The page and its script are written once per process to a temp folder, so every server can stream them. */
function generatedDir(): string {
  if (generated) return generated;
  const dir = path.join(tmpdir(), `vedit-runtime-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "graphic.html"), PAGE);
  writeFileSync(path.join(dir, "runtime.js"), SCRIPT);
  generated = dir;
  return dir;
}

/**
 * The file behind a runtime path (the part after `runtime/`), or null. Only the fixed set of names
 * resolves, so a raw URL tail can't reach anything else.
 */
/**
 * Every library and font file the runtime serves, by the path it's served at, resolved from
 * node_modules: the app's build copies them (scripts/runtime-assets.mts), since it ships no node_modules.
 */
export function runtimeAssets(): [string, string][] {
  return Object.entries(LIB_FILES).map(([rel, file]) => [rel, file()]);
}

export function runtimeFile(rel: string): string | null {
  if (rel === "graphic.html" || rel === "runtime.js") return path.join(generatedDir(), rel);
  const lib = LIB_FILES[rel];
  if (!lib) return null;
  // The app's own copy (VEDIT_RUNTIME_ASSETS), else the workspace's node_modules (development).
  const shipped = process.env.VEDIT_RUNTIME_ASSETS && path.join(process.env.VEDIT_RUNTIME_ASSETS, rel);
  if (shipped && existsSync(shipped)) return shipped;
  try {
    return lib();
  } catch {
    return null;
  }
}

/** Headers for a runtime response. `origin` is where the runtime is served from (e.g. media://project). */
export function runtimeHeaders(origin: string, rel: string): Record<string, string> {
  const type = rel.endsWith(".html")
    ? "text/html; charset=utf-8"
    : rel.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : rel.endsWith(".woff2")
        ? "font/woff2"
        : "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": type,
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
    "cache-control": "no-cache",
  };
  if (rel.endsWith(".html"))
    headers["content-security-policy"] = [
      "default-src 'none'",
      `script-src 'unsafe-inline' ${origin}`,
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      `font-src ${origin}`,
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  return headers;
}
