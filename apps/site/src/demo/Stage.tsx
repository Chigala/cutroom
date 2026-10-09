import { useEffect, useRef } from "react";

/**
 * The hero's preview, drawn live on the GPU. creator.mp4 is the clip stacked over its own matte (made by
 * Cutroom's Robust Video Matting pass), so every effect here is real compositing: the background swaps,
 * text sits behind her head, the lens blur keeps her sharp. Effects wipe in from her face.
 */

export type Look = 0 | 1 | 2 | 3 | 4; // original, tokyo, title behind, synthwave, cinematic

const VERT = `
attribute vec2 p;
varying vec2 v;
void main() { v = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D uVid;
uniform sampler2D uBg;
uniform sampler2D uText;
uniform float uTime, uFrom, uTo, uMix, uSee, uScan, uAspect, uBgAspect, uTextIn;
uniform vec2 uFace;

const vec3 AMBER = vec3(0.96, 0.65, 0.14);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 col(vec2 uv) { return texture2D(uVid, vec2(uv.x, clamp(uv.y, 0.002, 0.998) * 0.5)).rgb; }
float mat(vec2 uv) { return texture2D(uVid, vec2(uv.x, 0.5 + clamp(uv.y, 0.002, 0.998) * 0.5)).r; }
float edge(vec2 uv) {
  vec2 d = vec2(2.5 / 432.0, 2.5 / 820.0);
  return clamp(abs(mat(uv + vec2(d.x, 0.0)) - mat(uv - vec2(d.x, 0.0))) + abs(mat(uv + vec2(0.0, d.y)) - mat(uv - vec2(0.0, d.y))), 0.0, 1.0);
}
vec3 grade(vec3 c, vec3 shadows, vec3 highs) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return c * mix(shadows, highs, smoothstep(0.1, 0.8, l));
}

vec3 tokyo(vec2 uv, vec3 c, float m) {
  // The plate drifts slowly behind her, a touch soft so she reads in front of it.
  vec2 b = uv;
  float a = uAspect / uBgAspect;
  b.x = (b.x - 0.5) * a + 0.5;
  b = (b - 0.5) * (0.92 - 0.02 * sin(uTime * 0.2)) + 0.5 + vec2(0.012 * sin(uTime * 0.15), 0.0);
  vec3 bg = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float o = (float(i) - 2.0) * 0.0025;
    bg += texture2D(uBg, b + vec2(o, o * 0.5)).rgb;
  }
  bg /= 5.0;
  bg *= 0.85;
  // Her light now comes from the street: cooler key, pink neon on her edge.
  vec3 p = grade(c, vec3(0.78, 0.88, 1.05), vec3(1.0, 0.92, 1.02));
  float e = edge(uv);
  p += vec3(1.0, 0.25, 0.6) * e * 1.6 * smoothstep(0.55, 0.25, uv.x) + vec3(0.1, 0.9, 1.0) * e * 1.2 * smoothstep(0.45, 0.8, uv.x);
  return mix(bg, p, m);
}

vec3 behind(vec2 uv, vec3 c, float m) {
  vec3 bg = grade(c, vec3(0.75, 0.7, 0.72), vec3(0.95, 0.88, 0.9)) * 0.82;
  // The title rises into place word by word.
  vec2 t = uv;
  t.y += (1.0 - uTextIn) * 0.06;
  vec4 tx = texture2D(uText, t) * uTextIn;
  vec3 layer = mix(bg, tx.rgb, tx.a);
  return mix(layer, c * vec3(1.03, 1.0, 1.0), m);
}

vec3 synth(vec2 uv, vec3 c, float m) {
  float h = 0.6;
  vec3 sky = mix(vec3(0.09, 0.02, 0.2), vec3(0.95, 0.25, 0.55), smoothstep(0.05, h, uv.y));
  sky = mix(sky, vec3(1.0, 0.55, 0.2), smoothstep(h - 0.12, h, uv.y) * 0.6);
  // Sun with its stripes.
  vec2 s = (uv - vec2(0.5, 0.43)) * vec2(uAspect, 1.0);
  float r = length(s);
  float stripes = step(0.5, fract((uv.y - uTime * 0.02) * 38.0)) + step(uv.y, 0.43);
  float sun = smoothstep(0.205, 0.2, r) * min(1.0, stripes);
  sky = mix(sky, mix(vec3(1.0, 0.85, 0.3), vec3(1.0, 0.2, 0.55), smoothstep(0.25, 0.6, uv.y)), sun);
  sky += vec3(1.0, 0.3, 0.6) * smoothstep(0.42, 0.0, r) * 0.25;
  // The grid, rushing towards us.
  if (uv.y > h) {
    float z = 0.12 / (uv.y - h + 0.001);
    vec2 g = vec2((uv.x - 0.5) * z * 3.0, z + uTime * 0.9);
    vec2 f = abs(fract(g) - 0.5);
    float line = smoothstep(0.06 * z, 0.0, min(f.x, f.y) - 0.0) ;
    vec3 ground = vec3(0.05, 0.0, 0.12);
    sky = ground + vec3(1.0, 0.2, 0.85) * line * smoothstep(0.0, 0.25, uv.y - h) * 1.4 + vec3(0.9, 0.2, 0.7) * smoothstep(0.08, 0.0, uv.y - h);
  }
  // Her, as a duotone with chromatic split and a cyan glow.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 p = mix(vec3(0.35, 0.05, 0.45), vec3(0.4, 0.95, 1.0), smoothstep(0.15, 0.85, l));
  p = mix(p, c, 0.35);
  float sp = 0.004;
  p.r = mix(p.r, col(uv + vec2(sp, 0.0)).r, 0.3);
  p.b = mix(p.b, col(uv - vec2(sp, 0.0)).b, 0.3);
  float e = edge(uv);
  p += vec3(0.3, 0.95, 1.0) * e * 2.0;
  vec3 o = mix(sky, p, m);
  o += vec3(0.4, 0.95, 1.0) * smoothstep(0.0, 0.6, e) * (1.0 - m) * 0.6;
  return o;
}

vec3 cine(vec2 uv, vec3 c, float m) {
  // A lens blur that ignores her, so no halo leaks in from her edge.
  vec3 acc = vec3(0.0);
  float w = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.39996;
    float rr = sqrt(float(i) + 0.5) / 4.0 * 0.03;
    vec2 o = vec2(cos(a), sin(a)) * rr * vec2(1.0, uAspect);
    float k = 1.0 - mat(uv + o) * 0.95;
    acc += col(uv + o) * k;
    w += k;
  }
  vec3 bg = acc / max(w, 0.001);
  vec3 o = mix(bg, c, m);
  o = grade(o, vec3(0.72, 0.95, 1.08), vec3(1.12, 0.98, 0.82));
  o = mix(vec3(dot(o, vec3(0.333))), o, 1.1);
  float vig = smoothstep(1.1, 0.35, length((uv - 0.5) * vec2(1.0, 0.8)));
  o *= mix(0.55, 1.0, vig);
  o += (hash(uv * 900.0 + uTime) - 0.5) * 0.06;
  float bar = 0.11;
  o *= step(bar, uv.y) * step(uv.y, 1.0 - bar);
  return o;
}

vec3 look(float id, vec2 uv, vec3 c, float m) {
  if (id < 0.5) return c;
  if (id < 1.5) return tokyo(uv, c, m);
  if (id < 2.5) return behind(uv, c, m);
  if (id < 3.5) return synth(uv, c, m);
  return cine(uv, c, m);
}

void main() {
  vec2 uv = v;
  vec3 c = col(uv);
  float m = mat(uv);
  vec3 a = look(uFrom, uv, c, m);
  vec3 b = look(uTo, uv, c, m);
  // The new look grows out of her face, with a ragged amber front.
  float d = length((uv - uFace) * vec2(uAspect, 1.0));
  float front = uMix * 1.35;
  float n = noise(uv * 9.0 + uTime) * 0.06;
  float t = smoothstep(front + 0.02, front - 0.04, d + n);
  vec3 o = mix(a, b, t);
  float ring = smoothstep(0.035, 0.0, abs(d + n - front)) * step(0.001, uMix) * step(uMix, 0.999);
  o += AMBER * ring * 1.4;
  // Seeing: her matte lit amber, its edge traced, a scan line sweeping down.
  if (uSee > 0.001) {
    float e = edge(uv);
    float band = smoothstep(0.05, 0.0, abs(uv.y - uScan));
    o = mix(o, o * 0.55, uSee * (1.0 - m) * 0.6);
    o += AMBER * uSee * (m * 0.16 + e * 1.4 + band * m * 0.7);
    o += AMBER * uSee * band * 0.12;
  }
  gl_FragColor = vec4(o, 1.0);
}
`;

function makeText(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 864;
  c.height = 1640;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const face = '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = "#fff8ec";
  g.font = `900 250px ${face}`;
  g.fillText("MAIN", 432, 370);
  g.fillStyle = "#f5a524";
  g.font = `900 150px ${face}`;
  g.fillText("CHARACTER", 432, 520, 840);
  g.fillStyle = "rgba(255,248,236,0.85)";
  g.font = `700 34px ${face}`;
  g.fillText("EP. 01 · MONDAY", 432, 590);
  return c;
}

function shader(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

function texture(gl: WebGLRenderingContext, unit: number) {
  const t = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  return t;
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export interface StageProps {
  look: Look;
  seeing: boolean;
  running: boolean;
  /** Called every frame with the clip's time, for the playhead and the boxes drawn over it. */
  onTime: (t: number) => void;
  face: (t: number) => [number, number];
}

export function Stage({ look, seeing, running, onTime, face }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const state = useRef({ from: 0, to: 0, start: 0, see: 0, seeing: false, textIn: 0 });
  const props = useRef({ onTime, face, running });
  props.current = { onTime, face, running };

  // A new look starts a wipe from whatever is showing now.
  useEffect(() => {
    const s = state.current;
    if (look === s.to) return;
    s.from = s.to;
    s.to = look;
    s.start = performance.now();
    s.textIn = 0;
  }, [look]);
  useEffect(() => {
    state.current.seeing = seeing;
  }, [seeing]);

  useEffect(() => {
    const v = video.current!;
    if (running) void v.play().catch(() => {});
    else v.pause();
  }, [running]);

  useEffect(() => {
    const cv = canvas.current!;
    const v = video.current!;
    const gl = cv.getContext("webgl", { antialias: false, premultipliedAlpha: false, alpha: false });
    if (!gl) return;
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
    } catch (err) {
      console.warn(err);
      return;
    }
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tVid = texture(gl, 0);
    const tBg = texture(gl, 1);
    const tText = texture(gl, 2);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u("uVid"), 0);
    gl.uniform1i(u("uBg"), 1);
    gl.uniform1i(u("uText"), 2);
    gl.uniform1f(u("uAspect"), 432 / 820);
    gl.uniform1f(u("uBgAspect"), 640 / 960);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tText);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeText());
    const bg = new Image();
    bg.onload = () => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tBg);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bg);
    };
    bg.src = "/demo/tokyo.jpg";

    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = state.current;
      if (!props.current.running) return;
      if (v.readyState >= 2) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tVid);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
      }
      const mix = Math.min(1, (now - s.start) / 1200);
      s.see += ((s.seeing ? 1 : 0) - s.see) * Math.min(1, dt * 6);
      s.textIn += (1 - s.textIn) * Math.min(1, dt * (mix > 0.4 ? 4 : 0));
      const t = v.currentTime;
      const [fx, fy] = props.current.face(t);
      gl.uniform1f(u("uTime"), (now - t0) / 1000);
      gl.uniform1f(u("uFrom"), s.from);
      gl.uniform1f(u("uTo"), s.to);
      gl.uniform1f(u("uMix"), easeInOut(mix));
      gl.uniform1f(u("uSee"), s.see);
      gl.uniform1f(u("uScan"), (((now - t0) / 1600) % 1.3) - 0.15);
      gl.uniform1f(u("uTextIn"), s.textIn);
      gl.uniform2f(u("uFace"), fx, fy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      props.current.onTime(t);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <video
        ref={video}
        src="/demo/creator.mp4"
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        className="pointer-events-none absolute size-px opacity-0"
      />
      <canvas
        ref={canvas}
        width={432}
        height={820}
        className="absolute inset-0 size-full bg-[url(/demo/creator.jpg)] bg-cover"
      />
    </>
  );
}
