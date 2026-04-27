// Pure helpers for /sensors aggregation. No DB. Easy to test.

export function avg(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export function stddev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = avg(vals);
  return Math.sqrt(
    vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length,
  );
}

export type DeviationLabel = "↑↑" | "↑" | "→" | "↓" | "↓↓";

/**
 * Classify a value as ↑↑ / ↑ / → / ↓ / ↓↓ based on z-score relative to baseline.
 * `inverted=true` flips the sign (use for RHR — higher = worse).
 */
export function classifyDeviation(
  value: number,
  baseline: number,
  sd: number,
  inverted = false,
): DeviationLabel {
  if (sd === 0) return "→";
  let z = (value - baseline) / sd;
  if (inverted) z = -z;
  if (z >= 2) return "↑↑";
  if (z >= 0.5) return "↑";
  if (z <= -2) return "↓↓";
  if (z <= -0.5) return "↓";
  return "→";
}

/** Round to N decimal places. */
export function round(v: number, decimals = 1): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

/** Minutes-since for "X min ago" labels. */
export function minutesSince(ts: Date | string | null, ref: Date): number | null {
  if (!ts) return null;
  const t = typeof ts === "string" ? new Date(ts) : ts;
  return Math.max(0, Math.floor((ref.getTime() - t.getTime()) / 60000));
}
