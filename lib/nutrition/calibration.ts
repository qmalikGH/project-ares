// Calibration engine — Sprint v0.16 Phase B6, hardened v0.17.
// Replaces pre-calibration estimates (INITIAL_TARGETS) with rolling 14-day
// averages of Garmin-measured TDEE, grouped by nutrition day-type.
//
// Hardening (v0.17):
//   1. Illness filtering: only "clean" TDEE days (completed sessions for
//      training days, no planned sessions + TDEE > 2000 for rest days).
//   2. Coaching override protection: day-types with a recent
//      updateCalorieTargets CoachingLog entry are skipped.

import { db } from "@/lib/db/client";
import { dayKey } from "@/lib/db/queries/sensors";
import { cascadeNutritionUpdate } from "./cascade";
import { getDayType } from "./day-type";
import type { DayTypeTargets } from "./day-type";
import { buildSlotsForTargets } from "./template";
import type { CalibrationResult, DayType } from "./types";

export const CALIBRATION_WINDOW_DAYS = 14;
export const MIN_SAMPLES_PER_DAY_TYPE = 2;
export const FIXED_PROTEIN_G = 190; // ~2g/kg for Q
export const FIXED_FAT_G = 70;

const ALL_DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];

// ── Pure helpers ─────────────────────────────────────────────────────────

export type TDEERow = { date: Date; totalKilocalories: number | null };
export type WorkoutRow = { date: Date; status: string };
export type CoachingOverrideRow = { dayType: string; createdAt: Date };

/** Minimum rest-day TDEE to include in averages. Days below this are
 *  likely illness days where BMR was significantly depressed. */
export const REST_DAY_TDEE_FLOOR = 2000;

/** Maximum rest-day TDEE for calibration. Travel/outlier days above this
 *  are capped to prevent inflated rest-day targets. */
export const REST_DAY_TDEE_CAP = 2500;

/**
 * Filter TDEE rows to only include "clean" training data:
 * - Training days (strength_run, threshold, long_run): only if a Workout
 *   with status "completed" exists on that date.
 * - Rest days: only if NO Workout was planned on that date AND
 *   totalKilocalories > REST_DAY_TDEE_FLOOR.
 *
 * This excludes illness days, skipped sessions, and anomalously low
 * rest-day expenditures from the TDEE averages.
 */
export function filterCleanTDEE(
  tdeeRows: TDEERow[],
  workouts: WorkoutRow[],
): TDEERow[] {
  // Build date → statuses map (a date can have multiple workouts)
  const statusesByDate = new Map<string, string[]>();
  for (const w of workouts) {
    const key = w.date.toISOString().slice(0, 10);
    const existing = statusesByDate.get(key);
    if (existing) {
      existing.push(w.status);
    } else {
      statusesByDate.set(key, [w.status]);
    }
  }

  return tdeeRows.filter((r) => {
    if (r.totalKilocalories == null) return false;

    const dateKey = r.date.toISOString().slice(0, 10);
    const dayType = getDayType(r.date);
    const statuses = statusesByDate.get(dateKey);

    if (dayType === "rest") {
      // Rest day: no workout planned AND TDEE above illness floor
      return !statuses && r.totalKilocalories > REST_DAY_TDEE_FLOOR;
    } else {
      // Training day: at least one completed session
      return statuses != null && statuses.includes("completed");
    }
  });
}

/**
 * Return the set of day-types that have a coaching override
 * (updateCalorieTargets) more recent than the last calibration.
 * These day-types must NOT be overwritten by auto-calibration.
 */
export function dayTypesWithCoachOverride(
  overrides: CoachingOverrideRow[],
  lastCalibration: Date | null,
): Set<DayType> {
  const protected_ = new Set<DayType>();
  for (const o of overrides) {
    if (!ALL_DAY_TYPES.includes(o.dayType as DayType)) continue;
    // If never calibrated, all overrides are protected
    if (!lastCalibration || o.createdAt > lastCalibration) {
      protected_.add(o.dayType as DayType);
    }
  }
  return protected_;
}

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
 * Pull TDEE rows for the rolling 14-day window, filter for clean data,
 * compute averages per day-type, skip coaching overrides, write updates
 * onto the active MealPlan's DayPlans, and mark the MealPlan as calibrated.
 */
export async function calibrateMealPlan(userId: string): Promise<CalibrationResult> {
  const cutoff = dayKey(new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - CALIBRATION_WINDOW_DAYS);

  // ── Fetch TDEE + workout data in parallel ──
  const [rawRows, workouts] = await Promise.all([
    db.dailySensorData.findMany({
      where: { userId, date: { gte: cutoff } },
      select: { date: true, totalKilocalories: true },
      orderBy: { date: "asc" },
    }),
    db.workout.findMany({
      where: { userId, date: { gte: cutoff } },
      select: { date: true, status: true },
    }),
  ]);

  // ── Filter: only clean training days ──
  const cleanRows = filterCleanTDEE(rawRows, workouts);
  const buckets = groupTDEEByDayType(cleanRows);
  const averages = averageTDEEByDayType(buckets);
  const daysAvailable = cleanRows.filter((r) => r.totalKilocalories != null).length;

  if (Object.keys(averages).length === 0) {
    return {
      status: "insufficient_data",
      averages: {},
      daysAvailable,
      message: `Nicht genug bereinigte TDEE-Daten (${daysAvailable} saubere Tage). Mindestens ${MIN_SAMPLES_PER_DAY_TYPE} pro Tagestyp nötig.`,
    };
  }

  // ── Load MealPlan ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plan: any = await db.mealPlan.findFirst({
    where: { userId, status: "active" },
    select: { id: true, deficitKcal: true, calibratedAt: true },
  });
  if (!plan) {
    return {
      status: "insufficient_data",
      averages,
      daysAvailable,
      message: "Kein aktiver MealPlan. Seed-Script laufen lassen.",
    };
  }

  // ── Coaching override protection ──
  const overrideLogs = await db.coachingLog.findMany({
    where: { userId, action: "updateCalorieTargets" },
    select: { data: true, createdAt: true },
  });
  const mapped: CoachingOverrideRow[] = overrideLogs.map((l) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dayType: (l.data as any)?.dayType as string,
    createdAt: l.createdAt,
  }));
  const protectedTypes = dayTypesWithCoachOverride(mapped, plan.calibratedAt);
  const skippedCoachingOverride: string[] = [];

  // ── Update loop ──
  let anyConfigUpdated = false;
  for (const [dayType, rawTDEE] of Object.entries(averages) as [DayType, number][]) {
    if (protectedTypes.has(dayType)) {
      skippedCoachingOverride.push(dayType);
      continue;
    }

    // v1.2: Cap rest-day TDEE to avoid travel-inflated targets
    const avgTDEE = dayType === "rest" ? Math.min(rawTDEE, REST_DAY_TDEE_CAP) : rawTDEE;

    const m = computeMacros(avgTDEE, plan.deficitKcal);
    const targets: DayTypeTargets = {
      tdeeEstimate: avgTDEE,
      calorieTarget: m.calorieTarget,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
    };

    // Cascade: rebuild meal slots from calibrated targets so portions
    // always match the new calorie target (protein-first, carbs fill rest).
    const slots = buildSlotsForTargets(dayType, targets);

    const dayPlans = await db.dayPlan.findMany({
      where: { mealPlanId: plan.id, dayType },
      select: { id: true },
    });
    for (const dp of dayPlans) {
      await db.dayPlan.update({
        where: { id: dp.id },
        data: {
          tdeeEstimate: avgTDEE,
          calorieTarget: m.calorieTarget,
          proteinG: m.proteinG,
          carbsG: m.carbsG,
          fatG: m.fatG,
          slots: slots as unknown as object,
        },
      });
    }

    // v1.2: Also update DayTypeConfig (tdeeEstimate + recalculated calorieTarget)
    const existingConfig = await db.dayTypeConfig.findUnique({
      where: { planId_dayType: { planId: plan.id, dayType } },
    });
    if (existingConfig) {
      await db.dayTypeConfig.update({
        where: { id: existingConfig.id },
        data: {
          tdeeEstimate: avgTDEE,
          calorieTarget: m.calorieTarget,
          proteinG: m.proteinG,
          carbsG: m.carbsG,
          fatG: m.fatG,
        },
      });
      anyConfigUpdated = true;
    }
  }

  // v1.2: Cascade recompute ComputedMealSlots after all config updates
  if (anyConfigUpdated) {
    await cascadeNutritionUpdate(plan.id, "calibration", "Auto-calibration from Garmin TDEE");
  }

  await db.mealPlan.update({
    where: { id: plan.id },
    data: { calibrationStatus: "calibrated", calibratedAt: new Date() },
  });

  const updatedCount = Object.keys(averages).length - skippedCoachingOverride.length;
  const skipMsg = skippedCoachingOverride.length > 0
    ? ` ${skippedCoachingOverride.join(", ")} übersprungen (Coaching-Override).`
    : "";

  return {
    status: "calibrated",
    averages,
    daysAvailable,
    skippedCoachingOverride,
    message: `Kalibriert über ${daysAvailable} bereinigte Tage. ${updatedCount}/${Object.keys(averages).length} Tagestypen aktualisiert.${skipMsg}`,
  };
}
