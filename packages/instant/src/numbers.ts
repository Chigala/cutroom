/**
 * The numbers a request spells out ("75px", "10%", "1.5x", "2 seconds"). Jev can't produce a number, so
 * code finds them in the text and Jev only picks which one the request means.
 */
import type { Unit } from "./plan.ts";

export interface NumberSpan {
  /** As written: "75px". */
  readonly text: string;
  readonly value: number;
  /** The unit written with it, if any. "%" is its own: relative or absolute depends on the field. */
  readonly unit: Unit | "percent" | null;
}

const UNITS: Record<string, NumberSpan["unit"]> = {
  px: "px",
  "%": "percent",
  percent: "percent",
  x: "times",
  "×": "times",
  s: "seconds",
  sec: "seconds",
  secs: "seconds",
  second: "seconds",
  seconds: "seconds",
  db: "db",
};

// A time like 0:09 is a place in the video, not a value: skipped (the item questions see it).
const NUMBER =
  /(?<![\d:.])(-?\d+(?:\.\d+)?)(?![\d:])\s*(px|%|percent|x|×|seconds|second|secs|sec|s|db)?(?![a-z])/gi;

export function numbersIn(text: string): NumberSpan[] {
  const spans: NumberSpan[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    const unit = m[2] ? (UNITS[m[2].toLowerCase()] ?? null) : null;
    spans.push({ text: m[0].trim(), value, unit });
  }
  return spans.slice(0, 12);
}

/**
 * A number for a field, from what was written. Percent on a 0-1 level is that level ("music at 10%");
 * elsewhere it's a change, handled by the caller. A unit the field doesn't take means it wasn't meant.
 */
export function absoluteValue(span: NumberSpan, unit: Unit, max: number): number | null {
  if (span.unit === "percent") return unit === "fraction" ? (span.value / 100) * Math.min(1, max) : null;
  if (span.unit === null || span.unit === unit) return span.value;
  return null;
}

/** Places in the video a request names ("at 0:09", "1:05"), in seconds. */
export function timesIn(text: string): { text: string; seconds: number }[] {
  return [...text.matchAll(/\b(\d{1,2}):([0-5]\d)(?:\.(\d))?\b/g)].map((m) => ({
    text: m[0],
    seconds: Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0),
  }));
}
