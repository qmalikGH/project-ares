// Pure decision helpers extracted from regenerate-plans.ts so they can be
// tested without a database (same split as progress-helpers.ts).
//
// Sprint 2.4 — this is where the single most consequential bug of the comeback
// lived: the gate read "no recent shin report" as "shin is calm". An athlete
// who stopped training BECAUSE of shin splints files no pain reports while he
// isn't running, so the absence of data was being counted as evidence of
// health and the plan progressed at full tilt on his first day back.

export type VolumeGate = "progress" | "hold" | "regress";

export interface VolumeGateInput {
  /** Worst shin NRS across completed sessions in the last 10 days; null if none reported. */
  recentShin: number | null;
  /** How many sessions were completed in that window at all. */
  completedInWindow: number;
  /** Most recent Garmin resting HR inside the freshness window; null if none. */
  latestRhr: number | null;
  /** The user's calibrated resting-HR baseline; null if never set. */
  baselineRhr: number | null;
}

export interface VolumeGateDecision {
  gate: VolumeGate;
  /** Why the gate landed where it did — surfaced in ops output and logs. */
  reason: string;
}

/**
 * Derive the graded run-volume gate:
 *   ≤2 → progress (full volume + threshold ladder)
 *   3  → hold     (threshold clamped to the 2×10 floor, volume normal)
 *   ≥4 → regress  (−20% run volume + quality day replaced by an easy run)
 *
 * Two things can only downgrade, never upgrade:
 *   - no completed session in the window at all → at best "hold". Unknown must
 *     never outrank confirmed-calm.
 *   - resting HR more than 5 bpm over baseline → progress downgrades to hold.
 *
 * Pure.
 */
export function deriveVolumeGate(input: VolumeGateInput): VolumeGateDecision {
  const { recentShin, completedInWindow, latestRhr, baselineRhr } = input;

  if (recentShin != null && recentShin >= 4) {
    return { gate: "regress", reason: `shin NRS ${recentShin} (≥4)` };
  }
  if (recentShin === 3) {
    return { gate: "hold", reason: "shin NRS 3" };
  }

  if (completedInWindow === 0) {
    return {
      gate: "hold",
      reason: "no completed session in the last 10 days — readiness unknown",
    };
  }

  const rhrElevated =
    latestRhr != null && baselineRhr != null && latestRhr > baselineRhr + 5;
  if (rhrElevated) {
    return {
      gate: "hold",
      reason: `resting HR ${latestRhr} over baseline ${baselineRhr}+5`,
    };
  }

  return { gate: "progress", reason: "shin calm, resting HR at baseline" };
}
