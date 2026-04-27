// LoadMonitoringLogic — Banister TRIMP / sRPE-based daily load + ACWR
// See science_doc.md Kap 6.4 (Load Monitoring) & spec 6.4.
// Pure functions. No async, no DB, no LLM.

import type { ACWRBand, LoadOutput, Trend7d } from "../types";

const ACWR_LOW_THRESHOLD = 0.8;
const ACWR_OPTIMAL_UPPER = 1.3;
const ACWR_HIGH_UPPER = 1.5;

const EWMA_LAMBDA_ACUTE = 0.25; // ~7-day half-life
const EWMA_LAMBDA_CHRONIC = 0.075; // ~28-day half-life

// Cold-start safeguards (Wang 2020): ACWR isn't statistically meaningful until
// the chronic baseline is established. Otherwise a single high day in week 1
// trivially produces "DANGER" because chronic ≈ 0.
const ACWR_MIN_DAYS = 14; // distinct days of load data needed
const ACWR_MIN_CHRONIC_AU = 50; // typical 5-min easy walk RPE 2 → ≈10 AU/day → 50 = ≥ a couple sessions

export interface DailyLoadEntry {
  date: Date;
  load: number; // sRPE × duration_min in arbitrary units (AU)
}

/**
 * sRPE × duration → daily load in AU.
 * Foster (2001) session-RPE method, see science_doc.md Kap 6.4.
 */
export function computeDailyLoad(rpe: number, durationMin: number): number {
  if (rpe < 0 || rpe > 10) {
    throw new Error(`computeDailyLoad: rpe out of [0,10]: ${rpe}`);
  }
  if (durationMin < 0) {
    throw new Error(`computeDailyLoad: durationMin negative: ${durationMin}`);
  }
  return rpe * durationMin;
}

function dayDiff(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function isWithinDays(entryDate: Date, today: Date, days: number): boolean {
  const diff = dayDiff(today, entryDate);
  return diff >= 0 && diff < days;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/**
 * EWMA over a chronological load series.
 * Williams et al. (2017): EWMA reduces over-weighting of single high days.
 * Higher lambda = more weight on recent. Returns the EWMA value at the
 * latest entry's timestamp.
 */
function ewma(loads: DailyLoadEntry[], lambda: number): number {
  if (loads.length === 0) return 0;
  const sorted = [...loads].sort((a, b) => a.date.getTime() - b.date.getTime());
  let value = sorted[0].load;
  for (let i = 1; i < sorted.length; i++) {
    value = lambda * sorted[i].load + (1 - lambda) * value;
  }
  return value;
}

function classifyACWR(acwr: number): ACWRBand {
  if (acwr < ACWR_LOW_THRESHOLD) return "LOW";
  if (acwr <= ACWR_OPTIMAL_UPPER) return "OPTIMAL";
  if (acwr <= ACWR_HIGH_UPPER) return "HIGH";
  return "DANGER";
}

/**
 * Number of distinct calendar days with load data in the chronic window.
 * Used to gate ACWR validity: <14 distinct days → cold-start, can't trust the ratio.
 */
function countDistinctDays(loads: DailyLoadEntry[]): number {
  const keys = new Set<string>();
  for (const l of loads) {
    if (l.load > 0) keys.add(l.date.toISOString().slice(0, 10));
  }
  return keys.size;
}

/**
 * Compute Acute:Chronic Workload Ratio.
 * Method "rolling": simple averages over 7d / 28d.
 * Method "ewma": exponentially-weighted moving averages (Williams 2017).
 * "today" defines the right edge of the window (defaults to latest entry).
 *
 * See science_doc.md Kap 6.4 for methodology rationale.
 *
 * Cold-start: when chronic baseline is too thin (<14 distinct days OR
 * chronic28d <50 AU), the ratio is mathematically inflated even by ordinary
 * training. Returns band "BASELINE_BUILDING" instead of LOW/OPTIMAL/HIGH/DANGER.
 */
export function computeACWR(
  loads: DailyLoadEntry[],
  method: "rolling" | "ewma" = "rolling",
  today?: Date,
): { acwr: number; acute: number; chronic: number; band: ACWRBand; daysOfData: number } {
  if (loads.length === 0) {
    return { acwr: 0, acute: 0, chronic: 0, band: "BASELINE_BUILDING", daysOfData: 0 };
  }
  const sorted = [...loads].sort((a, b) => a.date.getTime() - b.date.getTime());
  const ref = today ?? sorted[sorted.length - 1].date;

  const last7 = sorted.filter((l) => isWithinDays(l.date, ref, 7));
  const last28 = sorted.filter((l) => isWithinDays(l.date, ref, 28));

  let acute: number;
  let chronic: number;
  if (method === "rolling") {
    acute = sum(last7.map((l) => l.load)) / 7;
    chronic = sum(last28.map((l) => l.load)) / 28;
  } else {
    acute = ewma(last7, EWMA_LAMBDA_ACUTE);
    chronic = ewma(last28, EWMA_LAMBDA_CHRONIC);
  }

  const acwr = chronic > 0 ? acute / chronic : 0;
  const daysOfData = countDistinctDays(last28);
  const baselineThin = daysOfData < ACWR_MIN_DAYS || chronic * 28 < ACWR_MIN_CHRONIC_AU;
  const band: ACWRBand = baselineThin ? "BASELINE_BUILDING" : classifyACWR(acwr);
  return { acwr, acute, chronic, band, daysOfData };
}

/**
 * Combined LoadOutput with both rolling and EWMA ACWR.
 * `todayLoad` is the latest day's load (already computed via sRPE×duration).
 */
export function buildLoadOutput(
  loads: DailyLoadEntry[],
  todayLoad: number,
  today?: Date,
): LoadOutput {
  const rolling = computeACWR(loads, "rolling", today);
  const ewmaResult = computeACWR(loads, "ewma", today);
  return {
    dailyLoadAu: todayLoad,
    acute7d: rolling.acute,
    chronic28d: rolling.chronic,
    acwrRolling: rolling.acwr,
    acwrEwma: ewmaResult.acwr,
    band: rolling.band, // primary band from rolling
    daysOfData: rolling.daysOfData,
  };
}

/**
 * Linear-regression-style trend over a 7-day window of a numeric metric.
 * Returns one of three buckets based on slope-to-mean ratio.
 */
export function computeTrend7d(values: { date: Date; value: number }[]): Trend7d {
  if (values.length < 3) return "stable";
  const sorted = [...values].sort((a, b) => a.date.getTime() - b.date.getTime());
  const last7 = sorted.slice(-7);
  if (last7.length < 3) return "stable";

  const n = last7.length;
  const xs = last7.map((_, i) => i);
  const ys = last7.map((v) => v.value);
  const xMean = sum(xs) / n;
  const yMean = sum(ys) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;

  if (yMean === 0) return "stable";
  const relSlope = slope / Math.abs(yMean);

  if (relSlope > 0.05) return "improving";
  if (relSlope < -0.05) return "declining";
  return "stable";
}
