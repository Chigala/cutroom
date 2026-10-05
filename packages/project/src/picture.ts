/**
 * Colour casts: the white balance that neutralises a clip's measured cast (analysis.picture.warmth),
 * shared by the colour-cast check, its fix and what the agent is told about each clip, so they never
 * disagree about how much is enough. How strong it is lives in checks.json (castCorrection).
 */
import { CheckRules } from "./schema.ts";

type CastRules = CheckRules["castCorrection"];
const DEFAULT: CastRules = CheckRules.parse({}).castCorrection;

/** The adjust.warmth that neutralises a cast of `warmth` (the measured value); 0 when it's neutral. */
export function castCorrection(warmth: number, rules: CastRules = DEFAULT): number {
  if (Math.abs(warmth) <= rules.neutral) return 0;
  const amount = Math.min(rules.max, (Math.abs(warmth) - rules.neutral) * rules.strength);
  return Math.round(-Math.sign(warmth) * amount * 100) / 100;
}

/** A shot's white balance is close enough to the correction (`rules.enough` of it, the right way). */
export function castCorrected(
  measured: number,
  shotWarmth: number | undefined,
  rules: CastRules = DEFAULT,
): boolean {
  const want = castCorrection(measured, rules);
  const have = shotWarmth ?? 0;
  if (!want) return true;
  return Math.sign(have) === Math.sign(want) && Math.abs(have) >= Math.abs(want) * rules.enough - 1e-9;
}
