// Sensor + load query helpers — reads only. All writes go through API route handlers.
import { db } from "@/lib/db/client";
import type { DailySensorInputs, KneeLog } from "@/lib/coach-engine/types";

/** Strip time-of-day so we always query/write the canonical day key. */
export function dayKey(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getSensorDataOnDate(userId: string, date: Date) {
  return db.dailySensorData.findFirst({
    where: { userId, date: dayKey(date) },
  });
}

export async function getRecentSensorData(userId: string, days: number) {
  const cutoff = dayKey(new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return db.dailySensorData.findMany({
    where: { userId, date: { gte: cutoff } },
    orderBy: { date: "asc" },
  });
}

/**
 * Rolling body-mass average for the deficit controller (Sprint 2.7 A5).
 *
 * Reads the raw weigh-ins rather than `UserSettings.currentWeightKg` on purpose:
 * that cached field is only refreshed when a weight is submitted, so it can be
 * months stale and still look like a fresh number. Requires MIN_WEIGHT_SAMPLES
 * within WEIGHT_LOOKBACK_DAYS — below that the average is a single noisy day and
 * the caller must treat the weight as unknown, never as "arrived at goal".
 */
export const WEIGHT_LOOKBACK_DAYS = 10;
export const MIN_WEIGHT_SAMPLES = 3;

export async function getRecentWeightAverageKg(
  userId: string,
): Promise<{ avgKg: number | null; samples: number; latestAt: Date | null }> {
  const cutoff = dayKey(new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - WEIGHT_LOOKBACK_DAYS);

  const rows = await db.dailySensorData.findMany({
    where: { userId, bodyWeightKg: { not: null }, date: { gte: cutoff } },
    orderBy: { date: "desc" },
    take: 7,
    select: { bodyWeightKg: true, date: true },
  });

  if (rows.length < MIN_WEIGHT_SAMPLES) {
    return { avgKg: null, samples: rows.length, latestAt: rows[0]?.date ?? null };
  }

  const sum = rows.reduce((acc, r) => acc + (r.bodyWeightKg ?? 0), 0);
  return {
    avgKg: Math.round((sum / rows.length) * 10) / 10,
    samples: rows.length,
    latestAt: rows[0].date,
  };
}

/** Map DB rows → engine inputs for baseline computation. */
export function rowsToSensorInputs(rows: Awaited<ReturnType<typeof getRecentSensorData>>): DailySensorInputs[] {
  const result: DailySensorInputs[] = [];
  for (const r of rows) {
    const userMorning = r.userMorning as unknown as DailySensorInputs["userMorning"] | null;
    if (!userMorning) continue;
    const garmin = r.garmin as unknown as DailySensorInputs["garmin"] | null;
    result.push({
      date: r.date,
      garmin: garmin ?? undefined,
      userMorning,
    });
  }
  return result;
}

/** Map DB rows → KneeLog[] for limitations module. */
export function rowsToKneeLogs(rows: Awaited<ReturnType<typeof getRecentSensorData>>): KneeLog[] {
  const result: KneeLog[] = [];
  for (const r of rows) {
    const userMorning = r.userMorning as unknown as { morningStiffness: number; stairsScore: number } | null;
    if (!userMorning) continue;
    result.push({
      date: r.date,
      morningStiffness: userMorning.morningStiffness,
      stairsScore: userMorning.stairsScore,
    });
  }
  return result;
}

/**
 * Recent daily loads (sRPE × duration) for ACWR.
 * Sourced from completed workouts in the last `days`.
 */
export async function getRecentDailyLoads(userId: string, days: number) {
  const cutoff = dayKey(new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const workouts = await db.workout.findMany({
    where: {
      userId,
      status: "completed",
      date: { gte: cutoff },
      rpe: { not: null },
      durationActualMin: { not: null },
    },
    select: { date: true, rpe: true, durationActualMin: true },
  });
  return workouts
    .filter((w) => w.rpe != null && w.durationActualMin != null)
    .map((w) => ({ date: w.date, load: (w.rpe as number) * (w.durationActualMin as number) }));
}
