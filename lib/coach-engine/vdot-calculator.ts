// Multi-method VDOT calibration (Sprint v0.7).
//
// Pure — math only, no DB, no I/O. Mirrors scripts/garmin-vdot-analysis.ts which
// has been validated against Q's 19-run history (see garmin-diagnostic-output/
// 28-vdot-analysis.json).
//
// Three methods triangulate around the true VDOT:
//   1. HRC (Heart-Rate-Cost) — Olher 2019, validated for recreational runners
//      (r=0.673 vs. lab gold standard).
//   2. Daniels Riegel + HR correction — extrapolates the hardest sustained
//      effort to 5k via Riegel; corrects down when HR was sub-max.
//   3. Linear regression HR vs pace — fits the (HR, pace) cloud and predicts
//      the pace at 95% HRmax (≈ vVO2max).
//
// Final estimate is a confidence-weighted average. Returns insufficient_data
// when too few runs exist for any method to produce a signal.
import type { RunSummary } from "@/lib/garmin/profile";

export interface VdotEstimate {
  method: "hrc" | "daniels_riegel" | "linear_regression";
  vdot: number;
  confidence: "low" | "medium" | "high";
  basis: string;
  /** Raw value before HR correction (Daniels-Riegel only). */
  rawValue?: number;
}

export interface VdotCalibrationResult {
  /** Confidence-weighted average across the methods that produced an estimate. */
  finalVdot: number;
  range: { min: number; max: number };
  estimates: VdotEstimate[];
  /** Overall convergence — high if max−min ≤ 2, medium if ≤ 4, else low. */
  confidence: "low" | "medium" | "high";
  /** True when fewer than 2 runs were usable. Caller falls back to default 40. */
  insufficient_data: boolean;
}

const MIN_RUNS_FOR_CALIBRATION = 2;
const SUSTAINED_RUN_MIN_SEC = 300; // 5min — minimum effort to extrapolate via Riegel
const RIEGEL_EXPONENT = 1.06;
const DANIELS_MIN_HR_RATIO = 0.88;

/**
 * Compute VDOT from a window of RunSummary records.
 *
 * Caller decides the window (e.g. 90d for onboarding seed, last-7-runs for
 * rolling auto-recalibration). This function is pure: it never mutates inputs.
 */
export function calibrateVdotFromRuns(
  runs: RunSummary[],
  hrMax: number,
  hrRest: number,
): VdotCalibrationResult {
  if (runs.length < MIN_RUNS_FOR_CALIBRATION) {
    return emptyResult(true);
  }

  const estimates: VdotEstimate[] = [];

  // Method 1: HRC (Olher 2019)
  const hrcVdots: number[] = [];
  for (const run of runs) {
    if (run.avgHr < hrRest + 30) continue; // skip super-easy noise
    const hrc = run.avgHr / run.velocityMperMin;
    const vVO2max = hrMax / hrc; // m/min
    const t5kSec = 5000 / (vVO2max / 60);
    hrcVdots.push(vdotFrom5kSec(t5kSec));
  }
  if (hrcVdots.length > 0) {
    const mean = hrcVdots.reduce((a, b) => a + b, 0) / hrcVdots.length;
    estimates.push({
      method: "hrc",
      vdot: Math.round(mean),
      confidence:
        hrcVdots.length >= 3 ? "high" : hrcVdots.length >= 2 ? "medium" : "low",
      basis: `n=${hrcVdots.length} runs, mean=${mean.toFixed(1)}, range=${Math.min(...hrcVdots)}-${Math.max(...hrcVdots)}`,
    });
  }

  // Method 2: Daniels Riegel + HR correction
  // Only useful when the hardest run reached near-threshold effort (≥88% HRmax).
  // Below that, the Riegel extrapolation error compounds with the HR correction,
  // producing estimates 10-15 VDOT points below reality.
  const sustained = runs.filter((r) => r.durationSec >= SUSTAINED_RUN_MIN_SEC);
  if (sustained.length > 0) {
    const hardest = sustained.reduce((max, r) =>
      r.avgHr / hrMax > max.avgHr / hrMax ? r : max,
    );
    const hrRatio = hardest.avgHr / hrMax;
    if (hrRatio >= DANIELS_MIN_HR_RATIO) {
      const eq5kSec = hardest.durationSec * Math.pow(5000 / hardest.distanceM, RIEGEL_EXPONENT);
      const rawVdot = vdotFrom5kSec(eq5kSec);

      let correctedVdot = rawVdot;
      if (hrRatio < 0.9) correctedVdot = Math.round(rawVdot * 0.9);

      estimates.push({
        method: "daniels_riegel",
        vdot: correctedVdot,
        confidence: hrRatio > 0.92 ? "high" : "medium",
        basis: `hardest run @ ${(hrRatio * 100).toFixed(0)}% HRmax, raw VDOT=${rawVdot}, corrected=${correctedVdot}`,
        rawValue: rawVdot,
      });
    }
  }

  // Method 3: Linear regression HR vs pace
  const dataPoints = runs.filter((r) => {
    const ratio = r.avgHr / hrMax;
    return ratio >= 0.65 && ratio <= 0.95;
  });
  if (dataPoints.length >= 2) {
    const n = dataPoints.length;
    const sumHR = dataPoints.reduce((s, r) => s + r.avgHr, 0);
    const sumPace = dataPoints.reduce((s, r) => s + r.avgPaceSecPerKm, 0);
    const sumHRPace = dataPoints.reduce(
      (s, r) => s + r.avgHr * r.avgPaceSecPerKm,
      0,
    );
    const sumHR2 = dataPoints.reduce((s, r) => s + r.avgHr * r.avgHr, 0);

    const denom = n * sumHR2 - sumHR * sumHR;
    if (denom !== 0) {
      const a = (n * sumHRPace - sumHR * sumPace) / denom;
      const b = (sumPace - a * sumHR) / n;
      const paceAt95pctHRmax = a * (hrMax * 0.95) + b;
      const t5kSec = 5 * paceAt95pctHRmax;

      estimates.push({
        method: "linear_regression",
        vdot: vdotFrom5kSec(t5kSec),
        confidence: n >= 5 ? "high" : n >= 3 ? "medium" : "low",
        basis: `n=${n} datapoints, slope=${a.toFixed(2)}, intercept=${b.toFixed(0)}`,
      });
    }
  }

  if (estimates.length === 0) return emptyResult(true);

  // Confidence-weighted average. high=3, medium=2, low=1.
  const weights = { high: 3, medium: 2, low: 1 } as const;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const est of estimates) {
    const w = weights[est.confidence];
    weightedSum += est.vdot * w;
    weightTotal += w;
  }
  const finalVdot = Math.round(weightedSum / weightTotal);
  const allVdots = estimates.map((e) => e.vdot);
  const min = Math.min(...allVdots);
  const max = Math.max(...allVdots);
  const overallConfidence: "low" | "medium" | "high" =
    max - min <= 2 ? "high" : max - min <= 4 ? "medium" : "low";

  return {
    finalVdot,
    range: { min, max },
    estimates,
    confidence: overallConfidence,
    insufficient_data: false,
  };
}

function emptyResult(insufficient: boolean): VdotCalibrationResult {
  return {
    finalVdot: 0,
    range: { min: 0, max: 0 },
    estimates: [],
    confidence: "low",
    insufficient_data: insufficient,
  };
}

/**
 * Daniels VDOT formula — derives VDOT from a 5k time (seconds).
 * Reference: Daniels' Running Formula 2nd ed., Appendix.
 *
 * VO2 demand at velocity v (m/min):
 *   VO2 = -4.60 + 0.182258·v + 0.000104·v²
 * Fraction of VO2max sustainable for time t (min):
 *   %VO2max = 0.8 + 0.1894393·exp(-0.012778·t) + 0.2989558·exp(-0.1932605·t)
 * VDOT = VO2 / %VO2max
 */
export function vdotFrom5kSec(t5kSec: number): number {
  const vMperMin = 5000 / (t5kSec / 60);
  const vo2 = -4.6 + 0.182258 * vMperMin + 0.000104 * vMperMin * vMperMin;
  const tMin = t5kSec / 60;
  const pctVo2max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * tMin) +
    0.2989558 * Math.exp(-0.1932605 * tMin);
  return Math.round(vo2 / pctVo2max);
}
