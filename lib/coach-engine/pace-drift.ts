// Pace-Drift detection (Sprint v0.7).
//
// Pure — math only, no DB, no I/O. Detects systematic VDOT-mismatch from
// recent Easy-Run training data. Triggered passively from /api/progress so
// the user sees a recommendation; not auto-applied (heat, recovery, RPE-noise
// can all confound).
//
// Decision rules (see sprint_v0.7_prompt.md Phase 1.5):
//   - 3+ Easy runs with RPE >= cap+2 OR mean pace deviation > 7% slower
//     → vdot_too_high (recommend VDOT−1 or −2)
//   - 3+ Easy runs faster than planned by > 7% AND RPE <= cap−1
//     → vdot_too_low (recommend VDOT+1)
//   - else no_drift
//
// The recommendation includes the underlying numbers transparently so the
// runner can decide if the drift is real or noise (see brief: "False-Positives").

export interface DriftEasyRunSample {
  /** Plan E-Pace upper bound (slower side), sec/km. */
  plannedPaceSecPerKm: number;
  /** Garmin-imported actual average pace, sec/km. */
  actualPaceSecPerKm: number;
  /** Plan RPE cap (typically 4 for Easy, 6 for Threshold). */
  plannedRpe: number;
  /** User-reported actual RPE. */
  actualRpe: number;
  /** Plan zone (1=easy, 2=threshold, 3=interval). */
  plannedZone: 1 | 2 | 3;
  /** Optional: average HR for this session, bpm. */
  actualHrAvg: number | null;
  /** Optional: upper HR bound of plannedZone (when HR-zones configured). */
  plannedZoneHrMax: number | null;
}

export interface DriftDetectionInput {
  recentEasyRuns: DriftEasyRunSample[];
}

export type DriftType = "vdot_too_high" | "vdot_too_low" | "no_drift";

export interface DriftDetectionResult {
  hasDrift: boolean;
  driftType: DriftType;
  /** Number of runs that triggered the rule (RPE-too-high count + slow-pace count). */
  affectedSessions: number;
  /** Mean (actualRpe − plannedRpe) across the sample. */
  rpeDeviation: number;
  /** Mean fractional pace deviation; positive = slower than planned. */
  paceDeviation: number;
  /** Human-readable string for UI display. Includes raw numbers for transparency. */
  recommendation: string;
  /** Suggested VDOT delta (negative = drop, positive = bump, 0 = none). Bounded ±2. */
  suggestedVdotDelta: number;
}

const MIN_SAMPLE = 3;
const PACE_DEVIATION_THRESHOLD = 0.07; // 7%
const RPE_HIGH_DELTA = 2; // RPE >= cap+2
const RPE_LOW_DELTA = -1; // RPE <= cap-1

/**
 * Detect VDOT-mismatch from a window of recent Easy Runs.
 * See module-header for trigger semantics.
 */
export function detectPaceDrift(
  input: DriftDetectionInput,
): DriftDetectionResult {
  const runs = input.recentEasyRuns;

  if (runs.length < MIN_SAMPLE) {
    return {
      hasDrift: false,
      driftType: "no_drift",
      affectedSessions: 0,
      rpeDeviation: 0,
      paceDeviation: 0,
      recommendation: `Nicht genug Daten — mind. ${MIN_SAMPLE} Easy Runs benötigt (aktuell ${runs.length}).`,
      suggestedVdotDelta: 0,
    };
  }

  const rpeDeltas = runs.map((r) => r.actualRpe - r.plannedRpe);
  const paceDeltas = runs.map(
    (r) => (r.actualPaceSecPerKm - r.plannedPaceSecPerKm) / r.plannedPaceSecPerKm,
  );
  const meanRpeDelta = mean(rpeDeltas);
  const meanPaceDelta = mean(paceDeltas);

  const highRpeCount = rpeDeltas.filter((d) => d >= RPE_HIGH_DELTA).length;
  const slowPaceCount = paceDeltas.filter(
    (d) => d > PACE_DEVIATION_THRESHOLD,
  ).length;
  const lowRpeCount = rpeDeltas.filter((d) => d <= RPE_LOW_DELTA).length;
  const fastPaceCount = paceDeltas.filter(
    (d) => d < -PACE_DEVIATION_THRESHOLD,
  ).length;

  // VDOT too high: plan is more aggressive than current fitness
  if (highRpeCount >= MIN_SAMPLE || (meanPaceDelta > PACE_DEVIATION_THRESHOLD && slowPaceCount >= 2)) {
    // 1 RPE-point ≈ 5% pace; bound the suggestion to [−2, −1].
    const rawDelta = (meanRpeDelta * 0.5 + meanPaceDelta * 20) / 2;
    const suggestedVdotDelta = -Math.min(2, Math.max(1, Math.round(Math.abs(rawDelta))));
    return {
      hasDrift: true,
      driftType: "vdot_too_high",
      affectedSessions: highRpeCount + slowPaceCount,
      rpeDeviation: roundTo(meanRpeDelta, 2),
      paceDeviation: roundTo(meanPaceDelta, 3),
      recommendation:
        `Über die letzten ${runs.length} Easy Runs RPE im Schnitt ${meanRpeDelta >= 0 ? "+" : ""}${meanRpeDelta.toFixed(1)} ` +
        `vs. Plan, Pace ${(meanPaceDelta * 100).toFixed(1)}% langsamer. ` +
        `Engine-Plan ist aggressiver als deine aktuelle Form. ` +
        `Empfehlung: VDOT um ${Math.abs(suggestedVdotDelta)} Punkt${Math.abs(suggestedVdotDelta) === 1 ? "" : "e"} reduzieren.`,
      suggestedVdotDelta,
    };
  }

  // VDOT too low: runner consistently faster than plan with low RPE
  if (lowRpeCount >= MIN_SAMPLE && fastPaceCount >= 2) {
    return {
      hasDrift: true,
      driftType: "vdot_too_low",
      affectedSessions: lowRpeCount,
      rpeDeviation: roundTo(meanRpeDelta, 2),
      paceDeviation: roundTo(meanPaceDelta, 3),
      recommendation:
        `Über die letzten ${runs.length} Easy Runs läufst du im Schnitt ${(Math.abs(meanPaceDelta) * 100).toFixed(1)}% ` +
        `schneller als geplant bei niedriger RPE (Ø ${meanRpeDelta.toFixed(1)} vs. Plan). ` +
        `Du bist fitter als der Plan annimmt. Empfehlung: VDOT um 1 Punkt erhöhen.`,
      suggestedVdotDelta: 1,
    };
  }

  return {
    hasDrift: false,
    driftType: "no_drift",
    affectedSessions: 0,
    rpeDeviation: roundTo(meanRpeDelta, 2),
    paceDeviation: roundTo(meanPaceDelta, 3),
    recommendation: "Pace und RPE liegen im erwarteten Bereich.",
    suggestedVdotDelta: 0,
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
