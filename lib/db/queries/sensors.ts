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
  // Sprint 3.4 (#28, C2): no `rpe: { not: null }` any more — an unrated
  // session with HR zones from the watch carries a load too (see below).
  const workouts = await db.workout.findMany({
    where: {
      userId,
      status: "completed",
      date: { gte: cutoff },
    },
    select: { date: true, rpe: true, durationActualMin: true, plannedSession: true, executedSession: true },
  });
  return dailyLoadsFrom(workouts);
}

/**
 * Sprint 3.4 (#28, C2): RPE equivalent per Garmin HR zone, for sessions nobody
 * rated. Garmin's five %HRmax zones mapped to the CR-10 anchors of the
 * session-RPE scale (Foster et al. 2001): Z1 very easy 2 · Z2 easy 3 ·
 * Z3 moderate/somewhat hard 5 · Z4 hard 7 · Z5 very hard 9.
 *
 * Load = Σ minutes in zone × anchor — the same arbitrary units as sRPE ×
 * minutes, so rated and unrated sessions share one ACWR scale (a TRIMP would
 * not). Computed on read and never stored: no RPE is invented on the row.
 */
export const ZONE_RPE_EQUIVALENT = [2, 3, 5, 7, 9] as const;

export function loadFromHrZones(executedSession: unknown): number | null {
  const zones = (executedSession as { garminHrZones?: Record<string, unknown> | null } | null)?.garminHrZones;
  if (!zones) return null;
  let load = 0;
  let seconds = 0;
  ZONE_RPE_EQUIVALENT.forEach((rpe, i) => {
    const sec = zones[`zone${i + 1}Sec`];
    if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) {
      load += (sec / 60) * rpe;
      seconds += sec;
    }
  });
  return seconds > 0 ? Math.round(load) : null;
}

/** Pure core of getRecentDailyLoads — measured duration first, plan as the
 *  documented fallback, rows with neither dropped. Sprint 3.4: an unrated row
 *  falls back to its HR zones; without RPE and zones it is still dropped. */
export function dailyLoadsFrom(
  workouts: ReadonlyArray<{
    date: Date;
    rpe: number | null;
    durationActualMin: number | null;
    plannedSession: unknown;
    executedSession?: unknown;
  }>,
): { date: Date; load: number }[] {
  const out: { date: Date; load: number }[] = [];
  for (const w of workouts) {
    if (w.rpe == null) {
      const zoneLoad = loadFromHrZones(w.executedSession);
      if (zoneLoad != null) out.push({ date: w.date, load: zoneLoad });
      continue;
    }
    const planned = (w.plannedSession as { durationMin?: number } | null)?.durationMin;
    const minutes = w.durationActualMin ?? (typeof planned === "number" ? planned : null);
    if (minutes == null) continue;
    out.push({ date: w.date, load: w.rpe * minutes });
  }
  return out;
}
