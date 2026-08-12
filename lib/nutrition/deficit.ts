// Deficit resolution — Sprint 2.7 (A5). Pure leaf module.
//
// WHY THIS EXISTS
//
// `targetWeightKg` was stored, drawn as a line on the weight chart, and read by
// the coaching export — but nothing ever compared it to the athlete's actual
// mass. The deficit therefore had no end condition at all. The only brake was
// the Garthe rate cap, which bounds how FAST mass comes off, never how LONG the
// deficit runs; at 88 kg that cap sits at 677 kcal, so it never even engaged.
//
// This module turns the goal weight into an actual controller: full deficit
// while far away, a linear taper across the last stretch, maintenance at goal.
//
// Hysteresis without a schema column: the current mode is inferred from
// `MealPlan.deficitKcal` itself. Once it reaches 0 (maintenance), leaving
// maintenance requires climbing DEFICIT_RESUME_MARGIN_KG above the target. That
// dead band is what stops a single heavy breakfast from restarting a cut.
//
// Pure: no db, no next/*, no side effects.

/** Width of the taper ramp above the target weight. */
export const DEFICIT_TAPER_BAND_KG = 1.5;

/** How far above target the athlete must climb to leave maintenance again. */
export const DEFICIT_RESUME_MARGIN_KG = 1.0;

/** Below this a deficit is noise, not a plan — round it down to maintenance. */
export const MIN_MEANINGFUL_DEFICIT_KCAL = 100;

export type DeficitMode = "full" | "taper" | "maintenance" | "unknown";

export interface ResolveDeficitInput {
  /** Rolling 7-day body-mass average. `null` when there are too few samples. */
  avg7dWeightKg: number | null;
  /** Goal weight. `null` disables the controller (no goal → no end condition). */
  targetWeightKg: number | null;
  /** The deficit currently stored on the MealPlan — the hysteresis state. */
  currentDeficitKcal: number | null;
  /** The intended deficit at full strength (DEFICIT_KCAL). */
  baseDeficitKcal: number;
  /** Garthe rate ceiling at the current body mass. */
  gartheCapKcal: number;
}

export interface ResolvedDeficit {
  deficitKcal: number;
  mode: DeficitMode;
  reason: string;
}

/** Keep resolved deficits on 25-kcal steps so targets don't jitter weekly. */
function round25(kcal: number): number {
  return Math.round(kcal / 25) * 25;
}

/**
 * Resolve the deficit that should be in force right now.
 *
 * Deliberate: when the weight average is unavailable this returns the FULL
 * deficit, not maintenance. Missing data is not evidence of having arrived —
 * and the caller must never substitute `targetWeightKg` for a measurement, or
 * the controller would read `weight == target` and pin itself at 0 forever.
 */
export function resolveDeficitKcal(input: ResolveDeficitInput): ResolvedDeficit {
  const { avg7dWeightKg, targetWeightKg, currentDeficitKcal, baseDeficitKcal, gartheCapKcal } = input;

  const capped = Math.min(baseDeficitKcal, gartheCapKcal);
  const cappedNote = capped < baseDeficitKcal ? ` (Garthe-capped from ${baseDeficitKcal})` : "";

  if (avg7dWeightKg == null || targetWeightKg == null) {
    return {
      deficitKcal: capped,
      mode: "unknown",
      reason:
        avg7dWeightKg == null
          ? `No reliable 7-day weight average — holding the full deficit ${capped}${cappedNote}`
          : `No target weight set — holding the full deficit ${capped}${cappedNote}`,
    };
  }

  const overTarget = avg7dWeightKg - targetWeightKg;
  const inMaintenance = currentDeficitKcal === 0;

  // Hysteresis: already at maintenance and not yet clearly back above target.
  if (inMaintenance && overTarget < DEFICIT_RESUME_MARGIN_KG) {
    return {
      deficitKcal: 0,
      mode: "maintenance",
      reason:
        `At maintenance: ${avg7dWeightKg.toFixed(1)} kg is within ${DEFICIT_RESUME_MARGIN_KG} kg of the ` +
        `${targetWeightKg.toFixed(1)} kg target — the cut resumes at ${(targetWeightKg + DEFICIT_RESUME_MARGIN_KG).toFixed(1)} kg`,
    };
  }

  if (overTarget <= 0) {
    return {
      deficitKcal: 0,
      mode: "maintenance",
      reason: `Target weight reached (${avg7dWeightKg.toFixed(1)} kg ≤ ${targetWeightKg.toFixed(1)} kg) — deficit off`,
    };
  }

  if (overTarget <= DEFICIT_TAPER_BAND_KG) {
    const scaled = round25((capped * overTarget) / DEFICIT_TAPER_BAND_KG);
    if (scaled < MIN_MEANINGFUL_DEFICIT_KCAL) {
      return {
        deficitKcal: 0,
        mode: "maintenance",
        reason:
          `${overTarget.toFixed(1)} kg above target — the tapered deficit (${scaled}) is below the ` +
          `${MIN_MEANINGFUL_DEFICIT_KCAL} kcal noise floor, going to maintenance`,
      };
    }
    return {
      deficitKcal: scaled,
      mode: "taper",
      reason:
        `${overTarget.toFixed(1)} kg above target — tapering ${capped} → ${scaled} across the last ` +
        `${DEFICIT_TAPER_BAND_KG} kg${cappedNote}`,
    };
  }

  return {
    deficitKcal: capped,
    mode: "full",
    reason: `${overTarget.toFixed(1)} kg above the ${targetWeightKg.toFixed(1)} kg target — full deficit ${capped}${cappedNote}`,
  };
}
