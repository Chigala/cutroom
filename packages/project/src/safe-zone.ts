/**
 * Where each platform's app leaves the picture clear: the caption bar and buttons cover the bottom and
 * the right of a phone video. The checks warn about what falls outside it; overlays marked `clear`
 * (a watermark, a logo, a badge) are drawn inside it.
 */
import type { CheckRules } from "./schema.ts";

/**
 * Where each platform's app UI leaves the picture clear (fractions of the frame), and where its column of
 * buttons down the right starts (rail; drawn in the preview, the checks keep the whole right edge clear).
 */
const SAFE_ZONES: Record<
  CheckRules["platform"],
  { top: number; bottom: number; right: number; rail: number }
> = {
  // Phone UI covers roughly the bottom 17% (caption bar, buttons) and the right 18% (like, share).
  tiktok: { top: 0.08, bottom: 0.78, right: 0.82, rail: 0.35 },
  // Reels and Shorts keep their buttons lower down, by the caption.
  reels: { top: 0.1, bottom: 0.8, right: 0.85, rail: 0.55 },
  shorts: { top: 0.08, bottom: 0.8, right: 0.85, rail: 0.5 },
  youtube: { top: 0, bottom: 1, right: 1, rail: 1 },
  none: { top: 0, bottom: 1, right: 1, rail: 1 },
};

export const safeZoneFor = (platform: CheckRules["platform"]) => SAFE_ZONES[platform];

/** The phone platforms, whose apps draw over a portrait video. */
export const PHONE_PLATFORMS = ["tiktok", "reels", "shorts"] as const;

/** Show the video as it sits in this platform's app: its zones, not a custom clear area. */
export const platformRules = (rules: CheckRules, platform: CheckRules["platform"]): CheckRules => {
  const { safeZone: _, ...rest } = rules;
  return { ...rest, platform };
};

/** The project's clear area: its own (checks.json safeZone), or its platform's. */
export const clearArea = (rules: Pick<CheckRules, "platform" | "safeZone">) =>
  rules.safeZone ?? SAFE_ZONES[rules.platform];

/** The TikTok safe zone, the default. */
export const SAFE_ZONE = SAFE_ZONES.tiktok;

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The clear area of a frame, in pixels. Only a portrait frame has the apps' buttons over it: the same
 * project exported wide (for YouTube) uses all of it.
 */
export function clearRect(
  rules: Pick<CheckRules, "platform" | "safeZone">,
  width: number,
  height: number,
): Rect {
  if (height <= width) return { left: 0, top: 0, width, height };
  const z = clearArea(rules);
  return { left: 0, top: z.top * height, width: z.right * width, height: (z.bottom - z.top) * height };
}
