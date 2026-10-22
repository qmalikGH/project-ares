// ReadinessLogic — Daily readiness from HRV + Sleep + Body Battery + RHR + subjective + knee
// See science_doc.md Kap 7.x (Sensor-Layer) & spec 6.5.
// Pure functions.

import type {
  DailySensorInputs,
  ReadinessBand,
  ReadinessOutput,
  SensorBaselines,
  Trend7d,
} from "../types";
import { kneeScoreFromInputs } from "../limitations";

// Weights from spec 6.5 / science_doc Kap 7
const WEIGHTS = {
  hrv: 0.30,
  sleep: 0.25,
  battery: 0.20,
  rhrDev: 0.15,
  subjective: 0.05,
  knee: 0.05,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Score 0-100 based on z-score deviation from baseline.
 * `inverted = true` for metrics where higher = worse (e.g. RHR).
 *
 * Mapping: at baseline → 80 (GREEN boundary), +1 SD better → 95,
 * -1 SD worse → 60 (mid-YELLOW), -2 SD worse → 40 (ORANGE).
 * Asymmetric loss aversion: drops below baseline penalised harder than
 * gains rewarded, matching how athletes perceive fatigue vs. peak-feel.
 */
export function scoreFromDeviation(
  value: number,
  baseline: number,
  sd: number,
  inverted = false,
): number {
  if (sd === 0) return 80;
  let z = (value - baseline) / sd;
  if (inverted) z = -z;
  // Asymmetric: gains worth +15/SD, losses worth -20/SD
  const delta = z >= 0 ? 15 * z : 20 * z;
  return clamp(Math.round(80 + delta), 0, 100);
}

/**
 * Score 0-100 directly from a 0-100 absolute metric (e.g. sleep score).
 * At baseline → 80; mild non-linearity to penalize lows more than reward highs.
 */
export function scoreFromAbsolute(value: number, baseline: number): number {
  if (value <= 0) return 0;
  if (baseline <= 0) return clamp(value, 0, 100);
  const ratio = value / baseline;
  if (ratio >= 1) return clamp(Math.round(80 + (ratio - 1) * 80), 0, 100);
  return clamp(Math.round(80 - (1 - ratio) * 120), 0, 100);
}

const DEFAULT_BASELINES: SensorBaselines = {
  hrv28dAvg: 50,
  hrv28dSd: 10,
  sleep28dAvg: 75,
  sleep28dSd: 10,
  rhr28dAvg: 55,
  rhr28dSd: 5,
};

/** Sprint 3.3 (C1): a baseline needs this many real values; fewer → default. */
export const MIN_BASELINE_SAMPLES = 7;

/** A Garmin field that arrived. Missing keys are undefined, cleared ones null. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Build 28-day rolling baselines + SDs.
 *
 * Sprint 3.3 (C1): per metric, only values that actually arrived count. A day
 * with RHR but no HRV used to put null (→ 0) or undefined (→ NaN) into the HRV
 * average; NaN then reached the band classification as "RED".
 */
export function computeBaselines(recentSensorData: DailySensorInputs[]): SensorBaselines {
  const garminEntries = recentSensorData.slice(-28).filter((d) => d.garmin);
  const values = (pick: (g: NonNullable<DailySensorInputs["garmin"]>) => unknown) =>
    garminEntries.map((d) => pick(d.garmin!)).filter(isFiniteNumber);

  const hrv = values((g) => g.hrvRmssd);
  const sleep = values((g) => g.sleepScore);
  const rhr = values((g) => g.rhr);
  const enough = (arr: number[]) => arr.length >= MIN_BASELINE_SAMPLES;

  return {
    hrv28dAvg: enough(hrv) ? avg(hrv) : DEFAULT_BASELINES.hrv28dAvg,
    hrv28dSd: enough(hrv) ? sd(hrv) : DEFAULT_BASELINES.hrv28dSd,
    sleep28dAvg: enough(sleep) ? avg(sleep) : DEFAULT_BASELINES.sleep28dAvg,
    sleep28dSd: enough(sleep) ? sd(sleep) : DEFAULT_BASELINES.sleep28dSd,
    rhr28dAvg: enough(rhr) ? avg(rhr) : DEFAULT_BASELINES.rhr28dAvg,
    rhr28dSd: enough(rhr) ? sd(rhr) : DEFAULT_BASELINES.rhr28dSd,
  };
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sd(arr: number[]): number {
  if (arr.length < 2) return 1;
  const m = avg(arr);
  const variance = arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.max(Math.sqrt(variance), 1); // avoid 0
}

function classifyBand(score: number): ReadinessBand {
  if (score >= 80) return "GREEN";
  if (score >= 65) return "YELLOW";
  if (score >= 50) return "ORANGE";
  return "RED";
}

/**
 * Compute today's readiness output.
 * `historicalScores` is used for trend7d computation; can be empty.
 *
 * Sprint 3.3 (C1): a Garmin component that did not arrive is left out and the
 * weights are renormalized over the ones that did. It used to be scored as a
 * number anyway — null as 0, undefined as NaN — and NaN made the score null and
 * the band RED (a morning with RHR and Body Battery, HRV and sleep still out).
 * Without any Garmin component the neutral fallback stays as it was.
 */
export function computeReadiness(
  inputs: DailySensorInputs,
  baselines: SensorBaselines,
  historicalScores: { date: Date; score: number }[] = [],
): ReadinessOutput {
  // Subjective component (always available). Sprint 3.3: a malformed morning
  // input reads as neutral rather than as NaN.
  const subjectiveRaw = clamp(inputs.userMorning.subjectiveRecovery * 10, 0, 100);
  const subjective = isFiniteNumber(subjectiveRaw) ? subjectiveRaw : 80;
  const kneeRaw = kneeScoreFromInputs(inputs.userMorning);
  // kneeRaw=1 → 100 (perfect), kneeRaw=10 → 10 (worst). Linear inversion.
  const kneeScore = clamp(110 - kneeRaw * 10, 0, 100);
  const knee = isFiniteNumber(kneeScore) ? kneeScore : 80;

  const g = inputs.garmin;
  const hrv = g && isFiniteNumber(g.hrvRmssd)
    ? scoreFromDeviation(g.hrvRmssd, baselines.hrv28dAvg, baselines.hrv28dSd)
    : null;
  const sleep = g && isFiniteNumber(g.sleepScore) ? scoreFromAbsolute(g.sleepScore, baselines.sleep28dAvg) : null;
  const battery = g && isFiniteNumber(g.bodyBatteryMorning) ? clamp(g.bodyBatteryMorning, 0, 100) : null;
  const rhrDev = g && isFiniteNumber(g.rhr)
    ? scoreFromDeviation(g.rhr, baselines.rhr28dAvg, baselines.rhr28dSd, true)
    : null;
  const hasGarmin = [hrv, sleep, battery, rhrDev].some((c) => c !== null);

  if (!hasGarmin) {
    // Garmin missing → neutral 80 for unobserved components.
    const score =
      WEIGHTS.hrv * 80 +
      WEIGHTS.sleep * 80 +
      WEIGHTS.battery * 80 +
      WEIGHTS.rhrDev * 80 +
      WEIGHTS.subjective * subjective +
      WEIGHTS.knee * knee;
    return {
      score: Math.round(score),
      band: classifyBand(score),
      components: { hrv: 80, sleep: 80, battery: 80, rhrDev: 80, subjective, knee },
      trend7d: trendFromScores(historicalScores),
    };
  }

  const weighted: Array<[number, number | null]> = [
    [WEIGHTS.hrv, hrv],
    [WEIGHTS.sleep, sleep],
    [WEIGHTS.battery, battery],
    [WEIGHTS.rhrDev, rhrDev],
    [WEIGHTS.subjective, subjective],
    [WEIGHTS.knee, knee],
  ];
  let sum = 0;
  let weight = 0;
  for (const [w, c] of weighted) {
    if (c === null || !Number.isFinite(c)) continue;
    sum += w * c;
    weight += w;
  }
  const score = sum / weight;

  return {
    score: Math.round(score),
    band: classifyBand(score),
    components: { hrv, sleep, battery, rhrDev, subjective, knee },
    trend7d: trendFromScores(historicalScores),
  };
}

function trendFromScores(scores: { date: Date; score: number }[]): Trend7d {
  if (scores.length < 3) return "stable";
  const sorted = [...scores].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(-7);
  const xs = sorted.map((_, i) => i);
  const ys = sorted.map((s) => s.score);
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  if (yMean === 0) return "stable";
  const rel = slope / Math.abs(yMean);
  if (rel > 0.02) return "improving";
  if (rel < -0.02) return "declining";
  return "stable";
}
