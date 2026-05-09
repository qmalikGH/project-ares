// Daily adjustment engine — Sprint v0.16 Phase B5.
// Reads yesterday's Garmin TDEE + planned intake, computes today's
// compensation. Three levers in priority order:
//   1. Drop Skyr  (postMealDessert)  ≈ -130 kcal
//   2. Reduce snack (afternoonSnack) ≈ -375 kcal (hummus → just carrots)
//   3. Smaller dinner               ≈ -150 kcal
// Total max compensation ≈ -655 kcal.
//
// Negative deltas (Q under-planned vs actual TDEE) currently produce no
// adjustment — adding calories back requires more nuance than this engine
// has, and the static plan already includes flex Skyr buffer.

import { db } from "@/lib/db/client";
import { dayKey } from "@/lib/db/queries/sensors";
import { getDayType } from "./day-type";
import type { DailyAdjustment, DayType, SlotAdjustment } from "./types";

export const DEFICIT_KCAL = 500;
export const ADJUSTMENT_THRESHOLD_KCAL = 100;

const SKYR_KCAL = 130;
const SNACK_REDUCTION_KCAL = 375;
const DINNER_REDUCTION_KCAL = 150;

// ── Pure helpers (testable in isolation) ─────────────────────────────────

/**
 * Apply the three reduction levers in order until `delta` is consumed.
 * Pure — no DB. Deltas below the threshold produce no adjustments.
 */
export function computeAdjustments(delta: number): SlotAdjustment[] {
  if (Math.abs(delta) < ADJUSTMENT_THRESHOLD_KCAL) return [];
  if (delta < 0) return []; // Under-planned: skip for now (see file header)

  const out: SlotAdjustment[] = [];
  let remaining = delta;

  if (remaining > ADJUSTMENT_THRESHOLD_KCAL) {
    out.push({
      slot: "postMealDessert",
      action: "remove",
      kcalEffect: -SKYR_KCAL,
      reason: "Skyr weglassen",
    });
    remaining -= SKYR_KCAL;
  }

  if (remaining > 200) {
    out.push({
      slot: "afternoonSnack",
      action: "reduce",
      kcalEffect: -SNACK_REDUCTION_KCAL,
      reason: "Hummus weglassen, nur Karotten",
    });
    remaining -= SNACK_REDUCTION_KCAL;
  }

  if (remaining > ADJUSTMENT_THRESHOLD_KCAL) {
    out.push({
      slot: "dinner",
      action: "reduce",
      kcalEffect: -DINNER_REDUCTION_KCAL,
      reason: "Dinner kleiner",
    });
    remaining -= DINNER_REDUCTION_KCAL;
  }

  return out;
}

/**
 * Build the human-readable adjustment message for the UI / push notification.
 */
export function buildAdjustmentMessage(
  yesterdayTDEE: number,
  yesterdayPlannedIntake: number,
  adjustments: SlotAdjustment[],
): string {
  const target = yesterdayTDEE - DEFICIT_KCAL;
  const delta = yesterdayPlannedIntake - target;
  const head = `Gestern TDEE ${yesterdayTDEE} kcal, Plan war ${yesterdayPlannedIntake} (Ziel ${target}). Delta ${
    delta > 0 ? "+" : ""
  }${delta} kcal.`;
  if (adjustments.length === 0) return `${head} Heute: kein Adjustment nötig.`;
  const actions = adjustments.map((a) => a.reason ?? `${a.slot} ${a.action}`).join(", ");
  return `${head} Heute: ${actions}.`;
}

// ── Async pipeline (DB reads + persistence) ──────────────────────────────

interface YesterdayData {
  date: Date;
  tdee: number;
  plannedIntake: number;
  dayType: DayType;
}

async function getYesterdayContext(userId: string, today: Date): Promise<YesterdayData | null> {
  const yesterday = new Date(today.getTime() - 86400000);
  const yKey = dayKey(yesterday);

  // 1. Yesterday's Garmin TDEE — must be present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sensor: any = await db.dailySensorData.findFirst({
    where: { userId, date: yKey },
    select: { totalKilocalories: true },
  });
  const tdee: number | null = sensor?.totalKilocalories ?? null;
  if (tdee == null) return null;

  // 2. Yesterday's planned intake. Prefer DailyNutritionLog when present
  //    (already written for that day); fall back to the active MealPlan's
  //    DayPlan for yesterday's weekday.
  const dayType = getDayType(yesterday);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const log: any = await db.dailyNutritionLog.findUnique({
    where: { userId_date: { userId, date: yKey } },
    select: { calorieTarget: true },
  });

  let plannedIntake: number | null = log?.calorieTarget ?? null;
  if (plannedIntake == null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan: any = await db.mealPlan.findFirst({
      where: { userId, status: "active" },
      include: {
        dayPlans: {
          where: { dayType },
          select: { calorieTarget: true },
        },
      },
    });
    plannedIntake = plan?.dayPlans?.[0]?.calorieTarget ?? null;
  }

  if (plannedIntake == null) return null;

  return { date: yesterday, tdee, plannedIntake, dayType };
}

/**
 * Compute today's compensation based on yesterday's TDEE-vs-plan delta.
 * Returns null when there's no data to act on.
 *
 * Read-only — does NOT persist. Call `persistDailyAdjustment` to write to
 * DailyNutritionLog (the cron job orchestrates both).
 */
export async function calculateDailyAdjustment(
  userId: string,
  today: Date,
): Promise<DailyAdjustment | null> {
  const ctx = await getYesterdayContext(userId, today);
  if (!ctx) return null;

  const targetIntake = ctx.tdee - DEFICIT_KCAL;
  const delta = ctx.plannedIntake - targetIntake;
  const adjustments = computeAdjustments(delta);
  if (adjustments.length === 0) return null;

  return {
    date: today.toISOString().slice(0, 10),
    delta,
    yesterdayTDEE: ctx.tdee,
    yesterdayPlannedIntake: ctx.plannedIntake,
    yesterdayTargetIntake: targetIntake,
    adjustments,
    message: buildAdjustmentMessage(ctx.tdee, ctx.plannedIntake, adjustments),
  };
}

/**
 * Upsert a DailyNutritionLog row for `date` with the computed adjustment.
 * Cron job calls this after `calculateDailyAdjustment` returns non-null.
 */
export async function persistDailyAdjustment(
  userId: string,
  date: Date,
  adjustment: DailyAdjustment | null,
  ctx: { dayType: DayType; calorieTarget: number; garminTDEE: number | null },
): Promise<void> {
  const dKey = dayKey(date);
  await db.dailyNutritionLog.upsert({
    where: { userId_date: { userId, date: dKey } },
    create: {
      userId,
      date: dKey,
      dayType: ctx.dayType,
      calorieTarget: ctx.calorieTarget,
      garminTDEE: ctx.garminTDEE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adjustment: adjustment as any,
    },
    update: {
      garminTDEE: ctx.garminTDEE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adjustment: adjustment as any,
    },
  });
}
