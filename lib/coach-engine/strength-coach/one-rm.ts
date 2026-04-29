// 1RM estimator (Sprint v0.11). Pure module — no DB, no I/O.
//
// Epley (1985) is the canonical sub-max → 1RM formula and the most accurate
// for ≤12 reps per Nuzzo et al. 2023 (meta-regression of 1RM-estimation
// formulas). RIR/RPE correction extends accuracy when reps were not taken to
// failure (Helms et al. 2016, Zourdos 2016).

/**
 * Estimate 1RM from a sub-maximal set using Epley.
 *
 * Epley:  1RM = weight × (1 + reps / 30)
 *
 * If `rpe` is provided (6-10 valid range), the formula uses
 * `effectiveReps = repsPerformed + (10 - rpe)` — the set is projected to
 * failure via RIR (Reps In Reserve = 10 - RPE). This gives a more accurate
 * estimate for non-AMRAP sets, e.g. 5 reps @ RPE 8 → effective 7 reps.
 *
 * Returns 0 for invalid inputs; otherwise rounded to 0.1 kg.
 */
export function estimateOneRM(
  weightKg: number,
  repsPerformed: number,
  rpe?: number,
): number {
  if (weightKg <= 0 || repsPerformed <= 0) return 0;

  const effectiveReps =
    rpe !== undefined && rpe >= 6 && rpe <= 10
      ? repsPerformed + (10 - rpe)
      : repsPerformed;

  const estimated = weightKg * (1 + effectiveReps / 30);
  return Math.round(estimated * 10) / 10;
}

/**
 * Convert a percentage of 1RM to absolute load, snapped to the nearest
 * 2.5 kg plate increment (standard in commercial gyms).
 *
 * Returns 0 for invalid inputs.
 */
export function loadPctToKg(oneRM: number, pct: number): number {
  if (oneRM <= 0 || pct <= 0) return 0;
  const raw = oneRM * (pct / 100);
  return Math.round(raw / 2.5) * 2.5;
}

/**
 * Compute a rolling 1RM estimate from recent training sets using the
 * MEDIAN of per-set Epley estimates (robust to outlier sessions where the
 * lifter was crashed / overcaffeinated).
 *
 * Returns null with fewer than 2 data points so callers can degrade
 * gracefully (no jumpy first-data-point estimates).
 */
export function rollingOneRMEstimate(
  recentSets: { weightKg: number; reps: number; rpe?: number }[],
): number | null {
  if (recentSets.length < 2) return null;
  const estimates = recentSets.map((s) =>
    estimateOneRM(s.weightKg, s.reps, s.rpe),
  );
  const sorted = [...estimates].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return Math.round(median * 10) / 10;
}

export interface OneRMDivergence {
  divergent: boolean;
  /** Signed: positive = engine estimate higher than user's manual value. */
  pctDiff: number;
  suggestion: string;
}

/**
 * Check whether the engine's auto-estimate diverges from the user's manual
 * 1RM by more than 10%. Used during Block-W4 deload review.
 *
 * Returns `null` when no comparison is possible OR the values agree
 * (within ±10%). Returns a divergence object otherwise.
 */
export function checkOneRMDivergence(
  manualRM: number,
  estimatedRM: number,
): OneRMDivergence | null {
  if (manualRM <= 0 || estimatedRM <= 0) return null;
  const pctDiff = ((estimatedRM - manualRM) / manualRM) * 100;
  if (Math.abs(pctDiff) <= 10) return null;
  const rounded = Math.round(pctDiff * 10) / 10;
  return {
    divergent: true,
    pctDiff: rounded,
    suggestion:
      pctDiff > 0
        ? `Dein geschätztes 1RM liegt bei ${Math.round(estimatedRM)} kg (${Math.round(pctDiff)}% über deinem eingestellten Wert). Anpassen?`
        : `Dein geschätztes 1RM liegt bei ${Math.round(estimatedRM)} kg (${Math.round(Math.abs(pctDiff))}% unter deinem eingestellten Wert). Anpassen?`,
  };
}
