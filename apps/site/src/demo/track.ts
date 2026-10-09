import sees from "./sees.json";

/** Face and person boxes at time t (sampled 10 times a second), as [cx, cy, w, h, score] fractions. */
type Row = number[];
export function boxesAt(t: number): { face: number[]; person: number[] } {
  const rows = sees as Row[];
  const i = Math.min(rows.length - 2, Math.max(0, Math.floor(t * 10)));
  const a = rows[i]!;
  const b = rows[i + 1]!;
  const k = Math.min(1, Math.max(0, t * 10 - i));
  const lerp = (n: number) => a[n]! + (b[n]! - a[n]!) * k;
  return { face: [1, 2, 3, 4, 5].map(lerp), person: [6, 7, 8, 9, 10].map(lerp) };
}
export const faceAt = (t: number): [number, number] => {
  const { face } = boxesAt(t);
  return [face[0]!, face[1]!];
};
