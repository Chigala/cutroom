/**
 * The colour grade on the GPU: a shot's own correction, then the video's grade, then its LUT, in one
 * pass (grading.ts in @vedit/project is the spec this follows step for step).
 *
 * It runs as a Remotion effect on each piece of footage (<Video effects>, <Img effects>), the same code
 * in the preview and in the export's headless Chrome. Remotion's own WebGL effects take two contexts per
 * video, and a browser keeps only 16 alive, so every video here shares one context instead: the frame is
 * graded there and copied onto the effect's 2D canvas.
 *
 * Without WebGL2: the preview falls back to the nearest CSS filter; an export stops with GL_UNAVAILABLE,
 * so the renderer can retry in software (which always has WebGL2), rather than export the wrong colours.
 */
import {
  cssApproximation,
  type GradeColor,
  type GradeSteps,
  gradeSteps,
  isNeutral,
  type Lut,
} from "@vedit/project";
import { createEffect, getRemotionEnvironment } from "remotion";

/** In the error an export stops with when the browser has no WebGL2 (the renderer retries in software). */
export const GL_UNAVAILABLE = "cutroom: colour grading needs WebGL2";

export interface ColorParams {
  /** The shot's own correction (scene.adjust), first. */
  readonly shot: GradeColor | null;
  /** The video's grade (the grade file's color), then. */
  readonly grade: GradeColor | null;
  /** The grade's LUT, loaded; null while it loads or when there is none. */
  readonly lut: Lut | null;
  /** The frame, for grain that moves (0 when there's no grain). */
  readonly frame: number;
  /** Identifies the params, for Remotion's memoizing (the frame included when there's grain). */
  readonly key: string;
  /** Identifies the colour alone. */
  readonly colorKey: string;
}

/** The effect params for a shot under a grade, or null when nothing would change. */
export function colorParams(
  shot: GradeColor | null,
  grade: GradeColor | null,
  lut: Lut | null,
  frame = 0,
): ColorParams | null {
  const s = isNeutral(shot) ? null : shot;
  const g = isNeutral(grade) ? null : grade;
  if (!s && !g) return null;
  const colorKey = JSON.stringify([s, g, g?.lut && lut ? lut.size : 0]);
  const grain = !!g?.grain;
  return {
    shot: s,
    grade: g,
    lut: g?.lut ? lut : null,
    frame: grain ? frame : 0,
    key: grain ? `${colorKey}@${frame}` : colorKey,
    colorKey,
  };
}

/** Whether a grade's look changes every frame (its grain), so footage has to know the frame. */
export const moves = (grade: GradeColor | null) => !!grade?.grain;

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
// Frames upload as they are (top row first): flipped here, not on upload, which costs a copy.
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 o;
uniform sampler2D u_img;
uniform bool u_on[2];
uniform vec3 u_balance[2];
uniform float u_exposure[2];
uniform vec3 u_lift[2];
uniform vec3 u_invGamma[2];
uniform vec3 u_gain[2];
uniform float u_contrast[2];
uniform float u_sat[2];
uniform bool u_curveOn[2];
uniform sampler2D u_curve0;
uniform sampler2D u_curve1;
uniform bool u_lutOn;
uniform float u_lutStrength;
uniform vec3 u_lutMin;
uniform vec3 u_lutMax;
uniform float u_lutSize;
uniform sampler3D u_lut;
uniform float u_grain;
uniform float u_grainCell;
uniform uint u_seed;
uniform vec2 u_size;

vec3 toLinear(vec3 v) { return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(0.04045, v)); }
vec3 toSrgb(vec3 v) { return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)); }

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uvec3 p) { return float(pcg(p.x ^ pcg(p.y ^ pcg(p.z)))) / 4294967295.0; }

vec3 curve(sampler2D t, vec3 c) {
  vec3 x = clamp(c, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
  return vec3(texture(t, vec2(x.r, 0.5)).r, texture(t, vec2(x.g, 0.5)).g, texture(t, vec2(x.b, 0.5)).b);
}

vec3 stage(int i, vec3 c) {
  c *= u_balance[i];
  if (u_exposure[i] != 0.0) c = toSrgb(toLinear(max(c, 0.0)) * exp2(u_exposure[i]));
  c = pow(max(u_gain[i] * (c + u_lift[i] * (1.0 - c)), 0.0), u_invGamma[i]);
  c = (c - 0.5) * u_contrast[i] + 0.5;
  float luma = dot(c, vec3(0.213, 0.715, 0.072));
  c = clamp(luma + (c - luma) * u_sat[i], 0.0, 1.0);
  if (u_curveOn[i]) c = i == 0 ? curve(u_curve0, c) : curve(u_curve1, c);
  return c;
}

void main() {
  // Frames arrive premultiplied (as the browser keeps them): graded straight, sent back premultiplied.
  vec4 px = texture(u_img, uv);
  vec3 c = px.a > 0.0 ? px.rgb / px.a : vec3(0.0);
  if (u_on[0]) c = stage(0, c);
  if (u_on[1]) c = stage(1, c);
  if (u_lutOn) {
    vec3 at = clamp((c - u_lutMin) / (u_lutMax - u_lutMin), 0.0, 1.0);
    at = at * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
    c = clamp(mix(c, texture(u_lut, at).rgb, u_lutStrength), 0.0, 1.0);
  }
  if (u_grain > 0.0) {
    // Film grain: one random value per grain, new every frame, strongest in the midtones.
    uvec3 cell = uvec3(uvec2(uv * u_size / u_grainCell), u_seed);
    float n = rnd(cell) + rnd(cell + uvec3(0u, 0u, 7919u)) - 1.0;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(c + n * u_grain * 0.16 * (0.25 + 3.0 * l * (1.0 - l)), 0.0, 1.0);
  }
  o = vec4(c * px.a, px.a);
}`;

interface Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly u: (name: string) => WebGLUniformLocation | null;
  readonly img: WebGLTexture;
  readonly curves: [WebGLTexture, WebGLTexture];
  readonly lutTex: WebGLTexture;
  curveData: [Float32Array | null, Float32Array | null];
  lut: Lut | null;
}

/** The one shared renderer: undefined until first asked for, null when the browser has no WebGL2. */
let shared: Renderer | null | undefined;

function renderer(): Renderer | null {
  if (shared && !shared.gl.isContextLost()) return shared;
  if (shared === null) return null;
  try {
    shared = makeRenderer();
  } catch {
    shared = null;
  }
  return shared;
}

function makeRenderer(): Renderer {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("no WebGL2");
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const locs = new Map<string, WebGLUniformLocation | null>();
  const u = (name: string) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
    return locs.get(name)!;
  };
  const texture = (unit: number, target: number) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    const t = gl.createTexture()!;
    gl.bindTexture(target, t);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return t;
  };
  const img = texture(0, gl.TEXTURE_2D);
  // One texel per pixel: no filtering to pay for.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const curves: [WebGLTexture, WebGLTexture] = [texture(1, gl.TEXTURE_2D), texture(2, gl.TEXTURE_2D)];
  const lutTex = texture(3, gl.TEXTURE_3D);
  gl.uniform1i(u("u_img"), 0);
  gl.uniform1i(u("u_curve0"), 1);
  gl.uniform1i(u("u_curve1"), 2);
  gl.uniform1i(u("u_lut"), 3);
  // Data textures are uploaded as they are: no flipping, no premultiplying.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  // Placeholders, so every sampler is complete before its first upload.
  for (const unit of [1, 2]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB16F,
      2,
      1,
      0,
      gl.RGB,
      gl.FLOAT,
      new Float32Array([0, 0, 0, 1, 1, 1]),
    );
  }
  gl.activeTexture(gl.TEXTURE3);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, 2, 2, 2, 0, gl.RGB, gl.FLOAT, identityLut(2));
  return { canvas, gl, u, img, curves, lutTex, curveData: [null, null], lut: null };
}

function identityLut(n: number): Float32Array {
  const d = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        d[i++] = r / (n - 1);
        d[i++] = g / (n - 1);
        d[i++] = b / (n - 1);
      }
  return d;
}

/** Resolved steps by params key: curves are sampled once, not every frame. */
const stepsCache = new Map<string, [GradeSteps | null, GradeSteps | null]>();
function stepsOf(p: ColorParams): [GradeSteps | null, GradeSteps | null] {
  let s = stepsCache.get(p.colorKey);
  if (!s) {
    s = [p.shot ? gradeSteps(p.shot) : null, p.grade ? gradeSteps(p.grade) : null];
    if (stepsCache.size > 64) stepsCache.clear();
    stepsCache.set(p.colorKey, s);
  }
  return s;
}

/** Grades one frame of `source` onto `target` (a 2D canvas). False when there is no WebGL2. */
export function gradeFrame(
  source: CanvasImageSource,
  target: HTMLCanvasElement,
  p: ColorParams,
  width: number,
  height: number,
): boolean {
  const r = renderer();
  if (!r) return false;
  const { gl, u } = r;
  if (r.canvas.width !== width || r.canvas.height !== height) {
    r.canvas.width = width;
    r.canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  const steps = stepsOf(p);
  steps.forEach((s, i) => {
    gl.uniform1i(u(`u_on[${i}]`), s ? 1 : 0);
    if (!s) return;
    gl.uniform3fv(u(`u_balance[${i}]`), s.balance);
    gl.uniform1f(u(`u_exposure[${i}]`), s.exposure);
    gl.uniform3fv(u(`u_lift[${i}]`), s.lift);
    gl.uniform3fv(
      u(`u_invGamma[${i}]`),
      s.gamma.map((g) => 1 / g),
    );
    gl.uniform3fv(u(`u_gain[${i}]`), s.gain);
    gl.uniform1f(u(`u_contrast[${i}]`), s.contrast);
    gl.uniform1f(u(`u_sat[${i}]`), s.saturation);
    gl.uniform1i(u(`u_curveOn[${i}]`), s.curves ? 1 : 0);
    if (s.curves && r.curveData[i] !== s.curves) {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, r.curves[i]!);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, s.curves.length / 3, 1, 0, gl.RGB, gl.FLOAT, s.curves);
      r.curveData[i] = s.curves;
    }
  });
  const grade = steps[1];
  const lut = grade?.lut && grade.lutStrength > 0 ? p.lut : null;
  gl.uniform1i(u("u_lutOn"), lut ? 1 : 0);
  gl.uniform1f(u("u_grain"), grade?.grain ?? 0);
  if (grade?.grain) {
    // Grain sized on a 1080-wide frame, whatever the footage's own size.
    gl.uniform1f(u("u_grainCell"), Math.max(1, grade.grainSize * (width / 1080)));
    gl.uniform1ui(u("u_seed"), p.frame);
    gl.uniform2f(u("u_size"), width, height);
  }
  if (lut && grade) {
    if (r.lut !== lut) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_3D, r.lutTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
      r.lut = lut;
    }
    gl.uniform1f(u("u_lutStrength"), grade.lutStrength);
    gl.uniform3fv(u("u_lutMin"), lut.min);
    gl.uniform3fv(u("u_lutMax"), lut.max);
    gl.uniform1f(u("u_lutSize"), lut.size);
  }
  // The frame, as the browser holds it (top row first, premultiplied): no conversion on the way in.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, r.img);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(r.canvas, 0, 0, width, height);
  return true;
}

/** A screen without WebGL2: the nearest CSS filter (see cssApproximation). */
function approximate(
  source: CanvasImageSource,
  target: HTMLCanvasElement,
  p: ColorParams,
  w: number,
  h: number,
) {
  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.filter = [cssApproximation(p.shot), cssApproximation(p.grade)].filter(Boolean).join(" ") || "none";
  ctx.drawImage(source, 0, 0, w, h);
  ctx.filter = "none";
}

/** The colour grade as a Remotion effect, for <Video effects> and <Img effects>. */
export const colorGrade = createEffect<ColorParams, null>({
  type: "cutroom-color",
  label: "Colour",
  documentationLink: null,
  backend: "2d",
  calculateKey: (p) => p.key,
  schema: {},
  validateParams: () => {},
  setup: () => null,
  apply: ({ source, target, params, width, height }) => {
    if (gradeFrame(source, target, params, width, height)) return;
    // An export must not quietly come out in the wrong colours: stop, and let it retry in software.
    if (getRemotionEnvironment().isRendering) throw new Error(GL_UNAVAILABLE);
    approximate(source, target, params, width, height);
  },
  cleanup: () => {},
});
