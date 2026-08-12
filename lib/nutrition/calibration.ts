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
import { dayKey, getRecentWeightAverageKg } from "@/lib/db/queries/sensors";
import { cascadeNutritionUpdate } from "./cascade";
import { getDayType } from "./day-type";
import { DEFICIT_KCAL, TDEE_PLAUSIBILITY_FLOOR, gartheMaxDeficit, proteinTargetG } from "./constants";
import { resolveDeficitKcal } from "./deficit";
import { dryRunConfigChange, resolveAthleteWeightKg } from "./dry-run";
import { clampToMinIntake } from "./min-intake";
import { dbConfigToEngineConfig } from "./seed-day-type-configs";
import type { CalibrationResult, DayType } from "./types";

export const CALIBRATION_WINDOW_DAYS = 14;
export const MIN_SAMPLES_PER_DAY_TYPE = 2;
/** Fallback fat target when a config row carries no usable value. Protein is no
 *  longer fixed here — Sprint 2.7 routed it through `proteinTargetG(weight)`,
 *  ending a third competing authority that silently reset it to 190 g weekly. */
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
      // Training day: a completed session AND a plausible (non-wear) total.
      // Sprint v1.8 #4: exclude corrupt Garmin days (e.g. 1534 kcal) even when
      // a workout is marked completed — they'd otherwise poison the average.
      return (
        statuses != null &&
        statuses.includes("completed") &&
        r.totalKilocalories > TDEE_PLAUSIBILITY_FLOOR
      );
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

/**
 * Derive the macro targets for a measured TDEE.
 *
 * Sprint 2.7 (A5): protein and fat are now PARAMETERS. They used to be module
 * constants (190 g / 70 g), which meant every weekly calibration silently
 * overwrote both the static config value and the weight-derived value the
 * morning-input cascade had just computed. Carbohydrate remains the residual —
 * it is the only macro that can absorb a changing energy target — but the floor
 * that keeps that residual sane now lives in `min-intake.ts`, applied by the
 * caller before the target is written.
 */
export function computeMacros(
  tdee: number,
  deficitKcal: number,
  proteinG: number,
  fatG: number = FIXED_FAT_G,
): { calorieTarget: number; proteinG: number; carbsG: number; fatG: number } {
  const calorieTarget = tdee - deficitKcal;
  const carbsKcal = calorieTarget - proteinG * 4 - fatG * 9;
  return {
    calorieTarget,
    proteinG,
    fatG,
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

  // ── Deficit resolution (Sprint 2.7 A5, replaces the Garthe-only clamp) ──
  // The old block only ever ratcheted the deficit DOWN when the Garthe rate
  // ceiling was breached, and never restored it — and it had no notion of the
  // goal weight at all, so the cut had no end condition. `resolveDeficitKcal`
  // composes both: taper toward maintenance near the target, capped by Garthe.
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { targetWeightKg: true },
  });
  const weightKg = await resolveAthleteWeightKg(userId);
  const weightAvg = await getRecentWeightAverageKg(userId);

  const resolvedDeficit = resolveDeficitKcal({
    avg7dWeightKg: weightAvg.avgKg,
    targetWeightKg: settings?.targetWeightKg ?? null,
    currentDeficitKcal: plan.deficitKcal,
    // Base is the CONSTANT, never the stored value: tapering from the stored
    // value would compound week over week (300 → 200 → 130 → …) and walk the
    // deficit to zero on its own. A manual `adjustDeficit` therefore holds
    // until the next calibration — the same lifetime a hand-edited
    // calorieTarget has had since v0.16.
    baseDeficitKcal: DEFICIT_KCAL,
    gartheCapKcal: gartheMaxDeficit(weightKg),
  });
  if (resolvedDeficit.deficitKcal !== plan.deficitKcal) {
    await db.mealPlan.update({
      where: { id: plan.id },
      data: { deficitKcal: resolvedDeficit.deficitKcal },
    });
    plan.deficitKcal = resolvedDeficit.deficitKcal;
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

  // ── Plan the writes (Sprint 2.7 A5: compute everything BEFORE writing) ──
  // The old loop wrote each DayTypeConfig row and only then called the
  // all-or-nothing cascade. When the cascade rejected the values the rows were
  // already updated and never rolled back — that is precisely how DayTypeConfig
  // came to hold rest=1558 for two months while DayPlan/ComputedMealSlot kept
  // the old values. Now: plan → dry-run → write → cascade → roll back on failure.
  const existingConfigs = await db.dayTypeConfig.findMany({ where: { planId: plan.id } });
  const configById = new Map(existingConfigs.map((c) => [c.dayType, c]));
  const clampNotes: string[] = [];

  type PlannedWrite = {
    id: string;
    dayType: DayType;
    data: { tdeeEstimate: number; calorieTarget: number; proteinG: number; carbsG: number; fatG: number };
  };
  const plannedWrites: PlannedWrite[] = [];

  for (const [dayType, rawTDEE] of Object.entries(averages) as [DayType, number][]) {
    if (protectedTypes.has(dayType)) {
      skippedCoachingOverride.push(dayType);
      continue;
    }

    const existingConfig = configById.get(dayType);
    if (!existingConfig) continue;

    // v1.2: Cap rest-day TDEE to avoid travel-inflated targets
    const avgTDEE = dayType === "rest" ? Math.min(rawTDEE, REST_DAY_TDEE_CAP) : rawTDEE;

    // Clamp FIRST, then derive the macros from the clamped target — otherwise
    // carbsG would describe a target that is not the one being written.
    const clamp = clampToMinIntake(
      avgTDEE - plan.deficitKcal,
      dbConfigToEngineConfig(existingConfig),
      weightKg,
    );
    if (clamp.note) clampNotes.push(clamp.note);

    const m = computeMacros(
      avgTDEE,
      avgTDEE - clamp.calorieTarget,
      proteinTargetG(weightKg),
      existingConfig.fatG || FIXED_FAT_G,
    );

    plannedWrites.push({
      id: existingConfig.id,
      dayType,
      data: {
        tdeeEstimate: avgTDEE,
        calorieTarget: m.calorieTarget,
        proteinG: m.proteinG,
        carbsG: m.carbsG,
        fatG: m.fatG,
      },
    });
  }

  const failMessage = (errors: string[]) =>
    `Kalibrierung berechnet, aber nicht angewendet — die Zielwerte sind nicht baubar: ${errors.join("; ")}`;

  if (plannedWrites.length === 0) {
    // Nothing to write (all protected / no matching configs) — still a success,
    // but do not touch calibratedAt for a no-op either.
    return {
      status: "calibrated",
      averages,
      daysAvailable,
      skippedCoachingOverride,
      clampNotes,
      deficitKcal: plan.deficitKcal,
      message: `Kalibriert über ${daysAvailable} bereinigte Tage. Keine Tagestypen aktualisiert (alle geschützt).`,
    };
  }

  // ── Dry-run: does the engine accept these targets? ──
  const byDayType = new Map(plannedWrites.map((w) => [w.dayType as string, w]));
  const dry = await dryRunConfigChange(plan.id, userId, (configs) => {
    for (let i = 0; i < configs.length; i++) {
      const w = byDayType.get(configs[i].dayType);
      if (!w) continue;
      configs[i] = {
        ...configs[i],
        calorieTarget: w.data.calorieTarget,
        tdeeEstimate: w.data.tdeeEstimate,
        macroTargets: { proteinG: w.data.proteinG, carbsG: w.data.carbsG, fatG: w.data.fatG },
      };
    }
    return null;
  });
  if (!dry.ok) {
    return {
      status: "cascade_failed",
      averages,
      daysAvailable,
      skippedCoachingOverride,
      clampNotes,
      deficitKcal: plan.deficitKcal,
      message: failMessage(dry.errors),
    };
  }

  // ── Write + cascade, with a snapshot to roll back to ──
  const snapshot = new Map(
    plannedWrites.map((w) => {
      const prev = configById.get(w.dayType)!;
      return [
        w.id,
        {
          tdeeEstimate: prev.tdeeEstimate,
          calorieTarget: prev.calorieTarget,
          proteinG: prev.proteinG,
          carbsG: prev.carbsG,
          fatG: prev.fatG,
        },
      ];
    }),
  );

  for (const w of plannedWrites) {
    await db.dayTypeConfig.update({ where: { id: w.id }, data: w.data });
  }

  const cascade = await cascadeNutritionUpdate(
    plan.id,
    "calibration",
    "Auto-calibration from Garmin TDEE",
  );

  if (!cascade.success) {
    // The dry run passed but the cascade did not — a recipe template changed
    // under us, or the weight moved between the two. Put the configs back so
    // the stores cannot diverge, and leave calibratedAt alone so the daily cron
    // retries instead of pretending this ran.
    for (const [id, prev] of snapshot) {
      await db.dayTypeConfig.update({ where: { id }, data: prev });
    }
    return {
      status: "cascade_failed",
      averages,
      daysAvailable,
      skippedCoachingOverride,
      clampNotes,
      deficitKcal: plan.deficitKcal,
      message: failMessage(cascade.errors),
    };
  }

  await db.mealPlan.update({
    where: { id: plan.id },
    data: { calibrationStatus: "calibrated", calibratedAt: new Date() },
  });

  const updatedCount = Object.keys(averages).length - skippedCoachingOverride.length;
  const skipMsg = skippedCoachingOverride.length > 0
    ? ` ${skippedCoachingOverride.join(", ")} übersprungen (Coaching-Override).`
    : "";
  const clampMsg = clampNotes.length > 0 ? ` Untergrenze griff: ${clampNotes.join("; ")}.` : "";
  const deficitMsg =
    resolvedDeficit.mode === "full" ? "" : ` Defizit ${resolvedDeficit.deficitKcal} kcal — ${resolvedDeficit.reason}.`;

  return {
    status: "calibrated",
    averages,
    daysAvailable,
    skippedCoachingOverride,
    clampNotes,
    deficitKcal: plan.deficitKcal,
    message:
      `Kalibriert über ${daysAvailable} bereinigte Tage. ${updatedCount}/${Object.keys(averages).length} ` +
      `Tagestypen aktualisiert.${skipMsg}${clampMsg}${deficitMsg}`,
  };
}
