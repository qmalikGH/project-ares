// Calibration engine — Sprint v0.16 Phase B6.
// Replaces pre-calibration estimates (INITIAL_TARGETS) with rolling 14-day
// averages of Garmin-measured TDEE, grouped by nutrition day-type.
//
// Re-calibration trigger lives in the cron job (B6.2): every 14 days or
// when current weight changes by >1kg.

import { db } from "@/lib/db/client";
import { dayKey } from "@/lib/db/queries/sensors";
import { getDayType } from "./day-type";
import type { CalibrationResult, DayType } from "./types";

export const CALIBRATION_WINDOW_DAYS = 14;
export const MIN_SAMPLES_PER_DAY_TYPE = 2;
export const FIXED_PROTEIN_G = 190; // ~2g/kg for Q
export const FIXED_FAT_G = 70;

// ── Pure helpers ─────────────────────────────────────────────────────────

export type TDEERow = { date: Date; totalKilocalories: number | null };

export function groupTDEEByDayType(rows: TDEERow[]): Record<DayType, number[]> {
  const buckets: Record<DayType, number[]> = {
    strength_run: [],
    threshold: [],
    long_run: [],
    rest: [],
  };
  for (const r of rows) {
    if (r.totalKilocalories == null) continue;
    const dayType = getDayType(r.date);
    buckets[dayType].push(r.totalKilocalories);
  }
  return buckets;
}

/**
 * Per-day-type average. Only returns values for types with at least
 * MIN_SAMPLES_PER_DAY_TYPE observations — otherwise the average would be
 * dominated by a single noisy day.
 */
export function averageTDEEByDayType(
  buckets: Record<DayType, number[]>,
): Partial<Record<DayType, number>> {
  const out: Partial<Record<DayType, number>> = {};
  for (const [type, vals] of Object.entries(buckets) as [DayType, number[]][]) {
    if (vals.length < MIN_SAMPLES_PER_DAY_TYPE) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    out[type] = Math.round(sum / vals.length);
  }
  return out;
}

export function computeMacros(
  tdee: number,
  deficitKcal: number,
): { calorieTarget: number; proteinG: number; carbsG: number; fatG: number } {
  const calorieTarget = tdee - deficitKcal;
  const carbsKcal = calorieTarget - FIXED_PROTEIN_G * 4 - FIXED_FAT_G * 9;
  return {
    calorieTarget,
    proteinG: FIXED_PROTEIN_G,
    fatG: FIXED_FAT_G,
    carbsG: Math.max(0, Math.round(carbsKcal / 4)),
  };
}

// ── DB pipeline ──────────────────────────────────────────────────────────

/**
 * Pull TDEE rows for the rolling 14-day window, compute averages per
 * day-type, write them onto the active MealPlan's DayPlans, and mark the
 * MealPlan as calibrated.
 *
 * Returns insufficient_data when no day-type has enough samples or no
 * active MealPlan exists.
 */
export async function calibrateMealPlan(userId: string): Promise<CalibrationResult> {
  const cutoff = dayKey(new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - CALIBRATION_WINDOW_DAYS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await db.dailySensorData.findMany({
    where: { userId, date: { gte: cutoff } },
    select: { date: true, totalKilocalories: true },
    orderBy: { date: "asc" },
  });

  const buckets = groupTDEEByDayType(rows);
  const averages = averageTDEEByDayType(buckets);
  const daysAvailable = rows.filter((r) => r.totalKilocalories != null).length;

  if (Object.keys(averages).length === 0) {
    return {
      status: "insufficient_data",
      averages: {},
      daysAvailable,
      message: `Nicht genug TDEE-Daten (${daysAvailable} Tage). Mindestens ${MIN_SAMPLES_PER_DAY_TYPE} pro Tagestyp nötig.`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plan: any = await db.mealPlan.findFirst({
    where: { userId, status: "active" },
    select: { id: true, deficitKcal: true },
  });
  if (!plan) {
    return {
      status: "insufficient_data",
      averages,
      daysAvailable,
      message: "Kein aktiver MealPlan. Seed-Script laufen lassen.",
    };
  }

  for (const [dayType, avgTDEE] of Object.entries(averages) as [DayType, number][]) {
    const m = computeMacros(avgTDEE, plan.deficitKcal);
    await db.dayPlan.updateMany({
      where: { mealPlanId: plan.id, dayType },
      data: {
        tdeeEstimate: avgTDEE,
        calorieTarget: m.calorieTarget,
        proteinG: m.proteinG,
        carbsG: m.carbsG,
        fatG: m.fatG,
      },
    });
  }

  await db.mealPlan.update({
    where: { id: plan.id },
    data: { calibrationStatus: "calibrated", calibratedAt: new Date() },
  });

  return {
    status: "calibrated",
    averages,
    daysAvailable,
    message: `Kalibriert über ${daysAvailable} Tage. ${Object.keys(averages).length}/4 Tagestypen aktualisiert.`,
  };
}
