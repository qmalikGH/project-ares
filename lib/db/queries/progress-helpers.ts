// Pure helpers for /progress aggregation. No DB access. Easy to test.

export type AdherenceBand = "good" | "warning" | "alarm";

export function computeAdherenceBand(score: number): AdherenceBand {
  if (score >= 80) return "good";
  if (score >= 60) return "warning";
  return "alarm";
}

export interface AdherenceCounts {
  completed: number;
  modified: number;
  skipped: number;
  pending: number;
}

export function computeAdherenceScore(c: AdherenceCounts): number {
  // v1.3: Exclude pending (future planned sessions) from denominator
  const total = c.completed + c.modified + c.skipped;
  if (total === 0) return 0;
  return Math.round(((c.completed + c.modified) / total) * 100);
}

export interface PhaseTID {
  z1: number;
  z2: number;
  z3: number;
  durationWeeks: number;
}

export interface TIDDistribution {
  z1: number;
  z2: number;
  z3: number;
}

/**
 * Weighted-average TID across multiple phases (weighted by durationWeeks).
 * Returns {z1:0, z2:0, z3:0} when no input phases.
 */
export function computeWeightedTID(phases: PhaseTID[]): TIDDistribution {
  let totalWeeks = 0;
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  for (const p of phases) {
    z1 += p.z1 * p.durationWeeks;
    z2 += p.z2 * p.durationWeeks;
    z3 += p.z3 * p.durationWeeks;
    totalWeeks += p.durationWeeks;
  }
  if (totalWeeks === 0) return { z1: 0, z2: 0, z3: 0 };
  return {
    z1: Math.round((z1 / totalWeeks) * 10) / 10,
    z2: Math.round((z2 / totalWeeks) * 10) / 10,
    z3: Math.round((z3 / totalWeeks) * 10) / 10,
  };
}

export interface ZoneMinutes {
  z1: number;
  z2: number;
  z3: number;
}

/**
 * Convert raw zone-minutes into a percentage TID. Returns 0/0/0 when no minutes.
 */
export function zoneMinutesToTID(min: ZoneMinutes): TIDDistribution {
  const total = min.z1 + min.z2 + min.z3;
  if (total === 0) return { z1: 0, z2: 0, z3: 0 };
  return {
    z1: Math.round((min.z1 / total) * 1000) / 10,
    z2: Math.round((min.z2 / total) * 1000) / 10,
    z3: Math.round((min.z3 / total) * 1000) / 10,
  };
}

export interface VdotPoint {
  date: Date;
  vdot: number;
  source: string;
  note?: string;
}

/** Sort by date ascending — used for chart rendering. */
export function sortVdotPoints(points: VdotPoint[]): VdotPoint[] {
  return [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Run-session types that count toward TID. Strength does not. */
export const RUN_SESSION_TYPES = [
  "easy_run",
  "threshold_run",
  "tempo_run",
  "vo2max_intervals",
  "long_run",
  "calibration_run",
  "time_trial_5k",
] as const;

/** Strength session types. */
export const STRENGTH_SESSION_TYPES = [
  "strength_a",
  "strength_b",
  "strength_c",
] as const;

export function isRunType(type: string): boolean {
  return (RUN_SESSION_TYPES as readonly string[]).includes(type);
}

export function isStrengthType(type: string): boolean {
  return (STRENGTH_SESSION_TYPES as readonly string[]).includes(type);
}
