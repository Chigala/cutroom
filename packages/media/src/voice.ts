/**
 * The export's dialogue track, adapted from tiktok-studio's cli/media.ts. The voice never goes through
 * the browser renderer (which rebuilds audio per frame and smears it): ffmpeg cuts every kept stretch
 * straight from the footage with tiny fades so no cut clicks, cleans it up like a phone mic needs, and
 * levels it to streaming loudness.
 */
import { rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { detectSilences } from "./audio.ts";
import { ffmpegMajor, ffmpegProgress, run } from "./exec.ts";
import { roomToneStretch } from "./joins.ts";

export type VoiceSegment =
  | {
      readonly file: string;
      readonly start: number;
      /** Seconds of output; at a speed other than 1 that's duration * speed of the source. */
      readonly duration: number;
      readonly volume: number;
      readonly speed?: number;
      /** Seconds this segment overlaps (and crossfades with) the one before it. */
      readonly crossfade?: number;
      /** ffmpeg filters for this clip's voice alone: the EQ that matches it to broadcast balance. */
      readonly eq?: string;
    }
  | { readonly silence: number; readonly crossfade?: number };

/** atempo, chained: one stage only goes from 0.5x to 2x. Keeps the pitch. */
function tempo(speed: number): string {
  if (Math.abs(speed - 1) < 1e-3) return "";
  const stages: number[] = [];
  let left = speed;
  while (left > 2) {
    stages.push(2);
    left /= 2;
  }
  while (left < 0.5) {
    stages.push(0.5);
    left /= 0.5;
  }
  stages.push(left);
  return stages.map((s) => `atempo=${s.toFixed(4)},`).join("");
}

/** How the voice is finished: the project's mix settings (audio/mix.json). */
export interface VoiceOptions {
  /** EQ, de-essing and compression that make phone mics sound close and clear. */
  readonly enhance?: boolean;
  readonly denoise?: boolean;
  readonly tone?: "natural" | "warm" | "bright" | "flat";
  /** Target loudness, LUFS. */
  readonly loudness?: number;
  /** True-peak ceiling, dBTP. */
  readonly truePeak?: number;
  /** Keep the clips' stereo instead of one centred voice. */
  readonly stereo?: boolean;
  /** Each clip was already EQ'd to broadcast balance: the tone is only a character on top. */
  readonly matched?: boolean;
  /** A last correction, measured on the finished voice track, applied before the tone. */
  readonly eq?: readonly string[];
}

/** Tones on top of a voice already matched to broadcast balance. */
const MATCHED_TONES: Record<NonNullable<VoiceOptions["tone"]>, string[]> = {
  natural: [],
  warm: ["lowshelf=f=180:g=2", "highshelf=f=8000:g=-1.5"],
  bright: ["equalizer=f=3800:t=q:w=1:g=2", "highshelf=f=9000:g=3"],
  flat: [],
};

const TONES: Record<NonNullable<VoiceOptions["tone"]>, string[]> = {
  // Phone mics sound boomy and far away: clear the mud, lift presence and air.
  natural: [
    "equalizer=f=250:t=q:w=1:g=-4",
    "equalizer=f=500:t=q:w=1.4:g=-1.5",
    "equalizer=f=3200:t=q:w=0.9:g=4",
    "highshelf=f=9000:g=2",
  ],
  warm: [
    "lowshelf=f=150:g=2",
    "equalizer=f=250:t=q:w=1:g=-1",
    "equalizer=f=3200:t=q:w=0.9:g=2",
    "highshelf=f=9000:g=-1",
  ],
  bright: ["equalizer=f=250:t=q:w=1:g=-4", "equalizer=f=3200:t=q:w=0.9:g=5", "highshelf=f=9000:g=4"],
  flat: [],
};

function voiceChain(o: VoiceOptions): string {
  const enhance = o.enhance ?? true;
  const chain = [
    enhance ? "highpass=f=80" : "",
    (o.denoise ?? true) ? "afftdn=nf=-25" : "",
    ...(o.eq ?? []),
    ...(o.matched
      ? MATCHED_TONES[o.tone ?? "natural"]
      : enhance
        ? TONES[o.tone ?? "natural"]
        : o.tone && o.tone !== "natural"
          ? TONES[o.tone]
          : []),
    // Tame the s's, even out the level.
    enhance ? "deesser=i=0.4" : "",
    enhance ? "acompressor=threshold=-22dB:ratio=3:attack=4:release=90:makeup=2" : "",
  ].filter(Boolean);
  return chain.length ? chain.join(",") : "anull";
}

const loudnessOf = (o: VoiceOptions) => `I=${o.loudness ?? -14}:TP=${o.truePeak ?? -1.5}:LRA=11`;

const LoudnessStats = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
  target_offset: z.string(),
});

/** Seconds decoded before each segment's start and trimmed off again. */
const PREROLL = 0.5;

/** Concatenates the segments into one mono 48 kHz WAV. */
export async function buildVoiceTrack(
  segments: readonly VoiceSegment[],
  output: string,
  signal?: AbortSignal,
  { stereo = false }: { stereo?: boolean } = {},
): Promise<void> {
  const layout = stereo ? "stereo" : "mono";
  // One input per segment, seeked to its stretch: ffmpeg decodes only the seconds the cut uses. (One
  // input shared by every segment makes each branch read and resample the whole recording: an hour's
  // source with a hundred cuts is a hundred hours of audio.)
  const inputs: string[][] = [];
  const inputOf = new Map<number, number>();
  segments.forEach((seg, n) => {
    if (!("file" in seg)) return;
    inputOf.set(n, inputs.length);
    // A little before (decoders settle; atrim takes it off), the exact stretch after.
    const from = Math.max(0, seg.start - PREROLL);
    inputs.push([
      "-ss",
      from.toFixed(4),
      "-t",
      (seg.start - from + seg.duration * (seg.speed ?? 1) + 0.5).toFixed(4),
      "-i",
      seg.file,
    ]);
  });
  const fade = 0.012;
  const xf = (n: number) => segments[n]?.crossfade ?? 0;
  const parts = segments.map((seg, n) => {
    if (!("file" in seg))
      return `anullsrc=r=48000:cl=${layout},atrim=duration=${seg.silence.toFixed(4)},asetpts=PTS-STARTPTS[a${n}]`;
    const len = seg.duration;
    const speed = seg.speed ?? 1;
    // Micro fades stop clicks at hard cuts; a crossfading edge doesn't need one.
    const fades = [
      xf(n) > 0 ? "" : `afade=t=in:d=${fade}`,
      xf(n + 1) > 0 ? "" : `afade=t=out:st=${Math.max(0, len - fade).toFixed(4)}:d=${fade}`,
    ].filter(Boolean);
    return (
      `[${inputOf.get(n)}:a:0]atrim=start=${(Math.max(0, seg.start) - Math.max(0, seg.start - PREROLL)).toFixed(4)}:duration=${(len * speed).toFixed(4)},asetpts=PTS-STARTPTS,` +
      `aresample=48000,${stereo ? "aformat=channel_layouts=stereo" : "pan=mono|c0=0.5*c0+0.5*c1"},` +
      (seg.eq ? `${seg.eq},` : "") +
      tempo(speed) +
      // Pad so a clip whose audio ends early still fills its slot exactly.
      `apad=whole_dur=${len.toFixed(4)},volume=${seg.volume.toFixed(3)}` +
      (fades.length ? `,${fades.join(",")}` : "") +
      `[a${n}]`
    );
  });
  if (segments.every((_, n) => xf(n) === 0))
    parts.push(`${segments.map((_, n) => `[a${n}]`).join("")}concat=n=${segments.length}:v=0:a=1[out]`);
  else {
    // J/L cuts and transitions: each segment overlaps the one before by its crossfade.
    let acc = "a0";
    for (let n = 1; n < segments.length; n++) {
      const out = n === segments.length - 1 ? "out" : `x${n}`;
      parts.push(
        xf(n) > 0
          ? // Equal power for short dialogue crossfades (no dip in level mid-word); linear for long ones.
            `[${acc}][a${n}]acrossfade=d=${xf(n).toFixed(4)}:c1=${xf(n) <= 0.3 ? "qsin" : "tri"}:c2=${xf(n) <= 0.3 ? "qsin" : "tri"}[${out}]`
          : `[${acc}][a${n}]concat=n=2:v=0:a=1[${out}]`,
      );
      acc = out;
    }
    if (segments.length === 1) parts.push("[a0]anull[out]");
  }
  const script = `${output}.filter`;
  await writeFile(script, parts.join(";\n"));
  // The graph is read from a file (it can outgrow a command line, Windows' especially). ffmpeg 7 spells
  // that -/filter_complex; the older ones Linux distributions ship (4 to 6), -filter_complex_script.
  const fromFile = (await ffmpegMajor()) >= 7 ? "-/filter_complex" : "-filter_complex_script";
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        ...inputs.flat(),
        fromFile,
        script,
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        output,
      ],
      signal ? { signal } : {},
    );
  } finally {
    await rm(script, { force: true });
  }
}

/** A recording laid over the dialogue track at a moment (a voiceover). */
export interface VoiceOverlay {
  readonly file: string;
  /** Seconds into the recording. */
  readonly start: number;
  /** Seconds heard. */
  readonly duration: number;
  /** Output seconds it starts at. */
  readonly at: number;
  readonly volume: number;
  /** How loud the dialogue under it stays (0..1). */
  readonly duck: number;
  /** ffmpeg filters for this recording alone: the EQ that matches it to broadcast balance. */
  readonly eq?: string;
}

/**
 * Lays voiceovers over a built dialogue track: each recording at its moment, the dialogue under it
 * stepping back to its duck, `ramp` seconds before and after (duckAt in @vedit/project: the preview's
 * curve, so both sound the same). The result is as long as the track.
 */
export async function overlayVoices(
  track: string,
  overlays: readonly VoiceOverlay[],
  output: string,
  signal?: AbortSignal,
  { stereo = false, ramp = 0.25 }: { stereo?: boolean; ramp?: number } = {},
): Promise<void> {
  const layout = stereo ? "aformat=channel_layouts=stereo" : "pan=mono|c0=0.5*c0+0.5*c1";
  const inputs = overlays.map((o) => {
    const from = Math.max(0, o.start - PREROLL);
    return ["-ss", from.toFixed(4), "-t", (o.start - from + o.duration + 0.5).toFixed(4), "-i", o.file];
  });
  // The dialogue's gain over time: the lowest any voiceover asks for, eased in and out around each.
  const f = (n: number) => n.toFixed(4);
  const gains = overlays.map(
    (o) =>
      // Commas inside an expression are escaped: the graph would read them as the next filter.
      `1-${f(1 - o.duck)}*clip(min((t-${f(o.at - ramp)})/${f(ramp)}\\,(${f(o.at + o.duration + ramp)}-t)/${f(ramp)})\\,0\\,1)`,
  );
  const gain = gains.reduce((a, b) => `min(${a}\\,${b})`);
  const fade = 0.02;
  const parts = [
    `[0:a:0]aresample=48000,${layout},volume=eval=frame:volume=${gain}[base]`,
    ...overlays.map(
      (o, n) =>
        `[${n + 1}:a:0]atrim=start=${f(o.start - Math.max(0, o.start - PREROLL))}:duration=${f(o.duration)},asetpts=PTS-STARTPTS,` +
        `aresample=48000,${layout},${o.eq ? `${o.eq},` : ""}volume=${o.volume.toFixed(3)},` +
        `afade=t=in:d=${fade},afade=t=out:st=${f(Math.max(0, o.duration - fade))}:d=${fade},` +
        // Padded with silence, so every input lasts as long as the track: amix then scales them all by
        // the same 1/n throughout (no option needed: older ffmpeg has no normalize), undone after.
        `adelay=${Math.round(o.at * 1000)}:all=1,apad[v${n}]`,
    ),
    `[base]${overlays.map((_, n) => `[v${n}]`).join("")}amix=inputs=${overlays.length + 1}:duration=first:dropout_transition=0,volume=${overlays.length + 1}[out]`,
  ];
  const script = `${output}.filter`;
  await writeFile(script, parts.join(";\n"));
  const fromFile = (await ffmpegMajor()) >= 7 ? "-/filter_complex" : "-filter_complex_script";
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        track,
        ...inputs.flat(),
        fromFile,
        script,
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        output,
      ],
      signal ? { signal } : {},
    );
  } finally {
    await rm(script, { force: true });
  }
}

/** Measures, then applies one fixed gain (two-pass loudnorm), so pauses never get pumped up. */
export async function masterVoice(
  input: string,
  output: string,
  signal?: AbortSignal,
  options: VoiceOptions = {},
): Promise<void> {
  const VOICE_EQ = voiceChain(options);
  const LOUDNESS = loudnessOf(options);
  const { stderr } = await run(
    "ffmpeg",
    ["-i", input, "-af", `${VOICE_EQ},loudnorm=${LOUDNESS}:print_format=json`, "-f", "null", "-"],
    signal ? { signal } : {},
  );
  const json = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
  const m = LoudnessStats.parse(JSON.parse(json));
  const filter =
    `${VOICE_EQ},loudnorm=${LOUDNESS}:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset},aresample=48000`;
  await run(
    "ffmpeg",
    ["-y", "-i", input, "-af", filter, "-c:a", "pcm_s16le", "-ar", "48000", output],
    signal ? { signal } : {},
  );
}

/**
 * Lays the room's own quiet sound, looped, under a dialogue track at `level` (0-1 of its natural level),
 * so the gaps and crossfades between shots never fall to dead silence or step in background noise. The
 * room is taken from the track's own longest pause, else from `fallback` (a source clip's silences).
 * False, leaving `output` unwritten, when there's no pause long enough to loop.
 */
export async function addRoomTone(
  input: string,
  output: string,
  level: number,
  {
    fallback,
    stereo = false,
    signal,
  }: {
    fallback?: { file: string; silences: readonly (readonly [number, number])[] };
    /** The track is stereo. */
    stereo?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const layout = stereo ? "stereo" : "mono";
  if (level <= 0) return false;
  const own = roomToneStretch(
    await detectSilences(input, { noiseDb: -40, minDuration: 0.6, ...(signal && { signal }) }),
    0.4,
  );
  const from = own
    ? { file: input, ...own }
    : fallback && { file: fallback.file, ...roomToneStretch(fallback.silences) };
  if (!from || from.start === undefined || from.duration === undefined) return false;
  // Each loop crossfades into the next (half of the stretch fades), so the bed has no seam.
  const fade = Math.min(0.15, from.duration / 4);
  await run(
    "ffmpeg",
    [
      "-y",
      "-i",
      input,
      "-ss",
      String(from.start),
      "-t",
      String(from.duration),
      "-i",
      from.file,
      "-filter_complex",
      `[1:a]aresample=48000,aformat=channel_layouts=${layout},afade=t=in:d=${fade},afade=t=out:st=${from.duration - fade}:d=${fade},` +
        `aloop=loop=-1:size=${Math.round(from.duration * 48000)},volume=${level}[bed];` +
        `[0:a]aresample=48000,aformat=channel_layouts=${layout}[v];[v][bed]amix=inputs=2:duration=first:normalize=0[out]`,
      "-map",
      "[out]",
      "-c:a",
      "pcm_s16le",
      output,
    ],
    signal ? { signal } : {},
  );
  return true;
}

/**
 * Lays the mastered voice under the rendered picture (whose own audio is music and effects, already
 * ducked by the composition), and brick-wall limits the mix.
 */
export async function muxFinal(
  {
    picture,
    voice,
    output,
    duration,
  }: { picture: string; voice: string | null; output: string; duration: number },
  {
    signal,
    onProgress,
    audioBitrate = "192k",
    truePeak = -1,
    stereo = false,
  }: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    audioBitrate?: string;
    /** The limiter's ceiling, dB. */
    truePeak?: number;
    /** The voice track is stereo already. */
    stereo?: boolean;
  } = {},
): Promise<void> {
  const limit = Math.min(1, 10 ** (truePeak / 20)).toFixed(3);
  const progress = ffmpegProgress(duration, onProgress);
  const opts = { ...(signal && { signal }), ...(progress && { onStderr: progress }) };
  if (!voice) {
    await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        picture,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        audioBitrate,
        "-movflags",
        "+faststart",
        output,
      ],
      opts,
    );
    return;
  }
  await run(
    "ffmpeg",
    [
      "-y",
      "-i",
      picture,
      "-i",
      voice,
      "-filter_complex",
      // pan, not aformat: the mono voice lands at full level in both ears instead of -3 dB.
      `[1:a:0]aresample=48000,${stereo ? "aformat=channel_layouts=stereo" : "pan=stereo|c0=c0|c1=c0"}[voice];` +
        "[0:a:0]aresample=48000,aformat=channel_layouts=stereo[fx];" +
        `[voice][fx]amix=inputs=2:duration=first:normalize=0,alimiter=limit=${limit}:attack=3:release=60:level=false[mix]`,
      "-map",
      "0:v:0",
      "-map",
      "[mix]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      "-movflags",
      "+faststart",
      "-shortest",
      output,
    ],
    opts,
  );
}
