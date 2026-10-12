// Procedural sound design: every effect is synthesized with
// ffmpeg, so there is nothing to license and nothing to download.
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { SfxName } from "@vedit/project";
import { run } from "./exec.ts";

// Deterministic "random" key presses so the typing sound is identical on every render.
const typingExpression = () => {
  const hits: number[] = [];
  let t = 0.02;
  let seed = 7;
  while (t < 1.3) {
    hits.push(t);
    seed = (seed * 9301 + 49297) % 233280;
    t += 0.055 + (seed / 233280) * 0.09;
  }
  const clicks = hits.map(
    (h, i) => `${(0.55 + (i % 3) * 0.15).toFixed(2)}*exp(-420*(t-${h.toFixed(3)}))*gte(t,${h.toFixed(3)})`,
  );
  return `(random(0)*2-1)*(${clicks.join("+")})`;
};

/** ffmpeg filter arguments need their commas escaped inside an expression. */
const eq = (expression: string) => expression.replaceAll(",", "\\,");

const knock = (at: number) =>
  `((random(0)*2-1)*exp(-120*(t-${at}))+0.8*sin(2*PI*220*(t-${at}))*exp(-40*(t-${at})))*gte(t,${at})`;

const pluck = (at: number, hz: number) => `0.5*sin(2*PI*${hz}*(t-${at}))*exp(-22*(t-${at}))*gte(t,${at})`;

// Procedural sound design: every effect is synthesized, so there is nothing to license.
const RECIPES: Record<SfxName, string[]> = {
  whoosh: [
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=0.6:c=pink:a=0.9",
    "-af",
    "highpass=f=180,lowpass=f=3200,afade=t=in:d=0.32:curve=qsin,afade=t=out:st=0.3:d=0.3:curve=qsin,volume=1.4",
  ],
  swipe: [
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=0.28:c=white:a=0.6",
    "-af",
    "highpass=f=1200,lowpass=f=5000,afade=t=in:d=0.12:curve=qsin,afade=t=out:st=0.1:d=0.18:curve=qsin,volume=0.8",
  ],
  pop: [
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.7*sin(2*PI*t*(300+480*exp(-45*t)))*exp(-28*t):d=0.2",
    "-af",
    "lowpass=f=2500,afade=t=in:d=0.004",
  ],
  ding: [
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.45*sin(2*PI*1568*t)*exp(-5*t)+0.18*sin(2*PI*3136*t)*exp(-8*t)+0.4*sin(2*PI*2093*(t-0.09))*exp(-4.5*(t-0.09))*gte(t\\,0.09):d=1.4",
    "-af",
    "aecho=0.8:0.5:60:0.25",
  ],
  type: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${typingExpression().replaceAll(",", "\\,")}:d=1.35`,
    "-af",
    "bandpass=f=2800:t=q:w=0.8,volume=2.2",
  ],
  thump: [
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.9*sin(2*PI*t*(45+90*exp(-18*t)))*exp(-5*t):d=0.8",
    "-af",
    "lowpass=f=900,afade=t=in:d=0.006",
  ],
  riser: [
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.3*sin(2*PI*(180*t+650*t*t))*(t/0.9)^2+0.18*(random(0)*2-1)*(t/0.9)^3:d=0.9",
    "-af",
    "highpass=f=150,afade=t=out:st=0.86:d=0.04",
  ],
  click: [
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=(random(0)*2-1)*exp(-600*t):d=0.04",
    "-af",
    "highpass=f=1500,volume=0.8",
  ],
  // A rubber stamp hitting paper: a low body plus a short clack.
  stamp: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq("0.9*sin(2*PI*t*(60+140*exp(-30*t)))*exp(-9*t)+0.55*(random(0)*2-1)*exp(-70*t)")}:d=0.5`,
    "-af",
    "lowpass=f=3000,afade=t=in:d=0.003",
  ],
  // A marker drawn across paper.
  squeak: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq("(random(0)*2-1)*0.7*(0.55+0.45*sin(2*PI*13*t))")}:d=0.45`,
    "-af",
    "bandpass=f=3400:t=q:w=0.7,afade=t=in:d=0.05,afade=t=out:st=0.33:d=0.12,volume=1.6",
  ],
  // A fingertip on glass.
  tap: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq("0.8*(random(0)*2-1)*exp(-260*t)+0.45*sin(2*PI*190*t)*exp(-60*t)")}:d=0.12`,
    "-af",
    "lowpass=f=4000",
  ],
  // A deep cinematic hit.
  boom: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq("0.95*sin(2*PI*t*(36+72*exp(-6*t)))*exp(-2.2*t)+0.35*(random(0)*2-1)*exp(-9*t)")}:d=1.6`,
    "-af",
    "lowpass=f=700,afade=t=in:d=0.004,afade=t=out:st=1.3:d=0.3",
  ],
  // A record pulled back and forth under the needle.
  scratch: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq("(0.5*(random(0)*2-1)+0.45*sin(2*PI*(900*t-620*t*t)))*abs(sin(2*PI*5.5*t))")}:d=0.45`,
    "-af",
    "bandpass=f=1600:t=q:w=1.1,afade=t=out:st=0.38:d=0.07,volume=1.5",
  ],
  // A falling slide whistle.
  whistle: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq("0.35*sin(2*PI*(1800*t-700*t*t)+0.6*sin(2*PI*6*t))")}:d=1.1`,
    "-af",
    "afade=t=in:d=0.04,afade=t=out:st=0.85:d=0.25",
  ],
  // Two knocks of a wooden gavel.
  gavel: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq(`${knock(0)}+${knock(0.2)}`)}:d=0.6`,
    "-af",
    "lowpass=f=2600,volume=1.3",
  ],
  // Soft pizzicato steps, like tiptoeing.
  tiptoe: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq([0, 0.2, 0.4, 0.6].map((a, n) => pluck(a, n % 2 ? 392 : 523)).join("+"))}:d=0.9`,
    "-af",
    "lowpass=f=3000,volume=1.4",
  ],
  // A sharp snap, like a cable giving way.
  snap: [
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${eq("0.9*(random(0)*2-1)*exp(-900*t)+0.5*sin(2*PI*2400*t)*exp(-200*t)")}:d=0.08`,
    "-af",
    "highpass=f=800",
  ],
};

/** The effect as a 48 kHz WAV, synthesized once into `cacheDir`. */
export async function sfxFile(name: SfxName, cacheDir: string): Promise<string> {
  const target = path.join(cacheDir, "sfx-v3", `${name}.wav`);
  if (!existsSync(target)) {
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.wav`;
    await run("ffmpeg", ["-y", ...RECIPES[name], "-ar", "48000", "-ac", "1", tmp]);
    await rename(tmp, target);
  }
  return target;
}
