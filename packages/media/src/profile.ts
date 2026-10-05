/**
 * What a clip sounds and looks like, measured once at import so the agent (and the export) don't guess:
 * the voice's tonal balance against broadcast speech, its noise floor, and the picture's colour cast.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { castCorrection } from "@vedit/project";
import { run } from "./exec.ts";

/** Speech bands, Hz: low end, body, clarity, presence, air. */
export const VOICE_BANDS = [
  [80, 250],
  [250, 800],
  [800, 2500],
  [2500, 6000],
  [6000, 12000],
] as const;

/**
 * Broadcast speech, each band's level against the body band (dB): measured on close-miked NASA
 * broadcast voices. A phone in a room is usually several dB boomier and duller.
 */
export const BROADCAST_VOICE = [-6, 0, -2, -8, -15.5] as const;

export interface VoiceProfile {
  /** Each band's level against the body band (250-800 Hz), dB. */
  readonly bands: readonly number[];
  /** Room noise under the voice, dBFS. */
  readonly noiseFloor: number;
}

const rms = (stderr: string) => {
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(stderr);
  return m && m[1] !== "-inf" ? Number(m[1]) : null;
};

/** The voice's tonal balance, from up to `seconds` of speech (pauses removed). Null without speech. */
export async function voiceProfile(
  file: string,
  seconds = 150,
  signal?: AbortSignal,
): Promise<VoiceProfile | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "vedit-voice-"));
  const speech = path.join(dir, "speech.wav");
  const opts = signal ? { signal } : {};
  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-t",
        String(seconds * 1.5),
        "-i",
        file,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-af",
        "asplit[a][b];[a]astats=measure_overall=Noise_floor:measure_perchannel=none,anullsink;" +
          "[b]silenceremove=start_periods=1:stop_periods=-1:stop_threshold=-38dB:stop_duration=0.15",
        "-t",
        String(seconds),
        "-y",
        speech,
      ],
      opts,
    );
    const floor = /Noise floor dB:\s*(-?[\d.]+)/.exec(stderr);
    const levels = await Promise.all(
      VOICE_BANDS.map(async ([lo, hi]) => {
        const out = await run(
          "ffmpeg",
          [
            "-hide_banner",
            "-i",
            speech,
            "-af",
            `highpass=f=${lo},highpass=f=${lo},lowpass=f=${hi},lowpass=f=${hi},astats=measure_overall=RMS_level:measure_perchannel=none`,
            "-f",
            "null",
            "-",
          ],
          opts,
        );
        return rms(out.stderr);
      }),
    );
    const body = levels[1];
    if (body === null || body === undefined || levels.some((l) => l === null) || body < -70) return null;
    return {
      bands: levels.map((l) => Math.round((l! - body) * 10) / 10),
      noiseFloor: floor ? Math.round(Number(floor[1])) : -90,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** How far each band sits from broadcast speech, dB (positive: too much). */
export const voiceDeviation = (p: VoiceProfile) => p.bands.map((b, i) => b - BROADCAST_VOICE[i]!);

/**
 * The EQ that moves a voice most of the way to broadcast balance: each band's gap closed by
 * `strength`, never more than 8 dB, as ffmpeg filters.
 */
export function voiceMatchEq(p: VoiceProfile, strength = 0.8): string[] {
  const g = voiceDeviation(p).map((d) => Math.max(-8, Math.min(8, -d * strength)));
  const f = (n: number) => n.toFixed(1);
  return [
    // The low band needs two cuts to move as a whole: the boom (~120 Hz) and the mud above it.
    `equalizer=f=120:t=o:w=1.4:g=${f(Math.max(-10, g[0]! * 1.4))}`,
    `equalizer=f=220:t=o:w=1:g=${f(Math.max(-10, g[0]! * 0.8))}`,
    `equalizer=f=1400:t=q:w=1.1:g=${f(g[2]!)}`,
    `equalizer=f=3800:t=q:w=1:g=${f(g[3]!)}`,
    `highshelf=f=7500:g=${f(g[4]!)}`,
  ].filter((s) => !/g=-?0\.0$/.test(s));
}

/** In words, for the agent: "boomy (+8 dB low end), dull (-6 dB presence)". */
export function describeVoice(p: VoiceProfile): string {
  const [low, , clarity, presence, air] = voiceDeviation(p);
  const notes: string[] = [];
  if (low! > 3) notes.push(`boomy (+${low!.toFixed(0)} dB low end)`);
  if (low! < -4) notes.push(`thin (${low!.toFixed(0)} dB low end)`);
  if ((clarity! + presence!) / 2 < -3)
    notes.push(`muffled (${((clarity! + presence!) / 2).toFixed(0)} dB clarity)`);
  if (presence! > 4) notes.push(`harsh (+${presence!.toFixed(0)} dB presence)`);
  if (air! < -5) notes.push(`dull top (${air!.toFixed(0)} dB air)`);
  if (p.noiseFloor > -55) notes.push(`noisy room (floor ${p.noiseFloor} dB)`);
  return notes.length ? notes.join(", ") : "clean, close to broadcast balance";
}

export interface PictureProfile {
  /** Mean luma, 0..1. */
  readonly brightness: number;
  /** Colour cast: positive is warm (orange), negative cool (blue); about -30..30. */
  readonly warmth: number;
  /** Positive is magenta, negative green. */
  readonly tint: number;
}

/** The picture's average brightness and colour cast, over frames spread through the clip. */
export async function pictureProfile(
  video: string,
  duration: number,
  signal?: AbortSignal,
): Promise<PictureProfile | null> {
  if (duration <= 0) return null;
  try {
    const { stdout } = await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-i",
        video,
        "-vf",
        `fps=${Math.min(2, 12 / duration).toFixed(4)},scale=320:-2,format=yuv420p,signalstats,metadata=print:file=-`,
        "-an",
        "-f",
        "null",
        "-",
      ],
      signal ? { signal } : {},
    );
    const avg = (key: string) => {
      const xs = [...stdout.matchAll(new RegExp(`signalstats\\.${key}=([\\d.]+)`, "g"))].map((m) =>
        Number(m[1]),
      );
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const [y, u, v] = [avg("YAVG"), avg("UAVG"), avg("VAVG")];
    if (y === null || u === null || v === null) return null;
    const r = (n: number) => Math.round(n * 10) / 10;
    return { brightness: r(y / 255), warmth: r(v - 128 - (u - 128)), tint: r(u - 128 + (v - 128)) };
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/** In words, for the agent: "strong warm (orange) cast". Empty when neutral. */
export function describePicture(p: PictureProfile, rules?: Parameters<typeof castCorrection>[1]): string {
  const notes: string[] = [];
  // With the exact white balance that corrects it, so the edit and the colour-cast check agree.
  const fix = castCorrection(p.warmth, rules);
  if (p.warmth > 10) notes.push(`strong warm (orange) cast, ${p.warmth}: correct with adjust.warmth ${fix}`);
  else if (p.warmth > 6) notes.push(`slightly warm, ${p.warmth} (adjust.warmth ${fix} neutralises it)`);
  else if (p.warmth < -6) notes.push(`cool (blue) cast, ${p.warmth}: correct with adjust.warmth ${fix}`);
  if (p.tint > 6) notes.push("magenta tint");
  if (p.tint < -6) notes.push("green tint");
  if (p.brightness < 0.3) notes.push("dark");
  if (p.brightness > 0.7) notes.push("very bright");
  return notes.length ? notes.join(", ") : "neutral colour";
}
