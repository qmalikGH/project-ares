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
 *
 * Sprint 3.2a: this is the ONE place a planned duration may stand in for an
 * actual one. A session confirmed in /confirm without watch data or typed-in
 * minutes keeps `durationActualMin` null — it is not a measurement, and the
 * block review, history and coaching export must not read it as one. ACWR
 * still needs a load for it, or exactly the sessions /confirm exists to
 * capture would vanish from the acute window. So the estimate lives here.
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
    },
    select: { date: true, rpe: true, durationActualMin: true, plannedSession: true },
  });
  return dailyLoadsFrom(workouts);
}

/** Pure core of getRecentDailyLoads — measured duration first, plan as the
 *  documented fallback, rows with neither dropped. */
export function dailyLoadsFrom(
  workouts: ReadonlyArray<{
    date: Date;
    rpe: number | null;
    durationActualMin: number | null;
    plannedSession: unknown;
  }>,
): { date: Date; load: number }[] {
  const out: { date: Date; load: number }[] = [];
  for (const w of workouts) {
    if (w.rpe == null) continue;
    const planned = (w.plannedSession as { durationMin?: number } | null)?.durationMin;
    const minutes = w.durationActualMin ?? (typeof planned === "number" ? planned : null);
    if (minutes == null) continue;
    out.push({ date: w.date, load: w.rpe * minutes });
  }
  return out;
}
