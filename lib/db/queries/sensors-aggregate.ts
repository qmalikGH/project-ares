// /sensors data aggregation — read-only queries, no engine logic.
// Pure compute helpers live in `sensors-helpers.ts`.
import { db } from "@/lib/db/client";
import { dayKey } from "./sensors";
import { avg, stddev } from "./sensors-helpers";

// ============================================
// Today snapshot vs baselines
// ============================================
export interface TodaySensorSnapshot {
  date: string;
  garmin: {
    hrvRmssd: number | null;
    hrvStatus: string | null;
    sleepScore: number | null;
    sleepDurationMin: number | null;
    bodyBatteryMorning: number | null;
    rhr: number | null;
  };
  user: {
    subjectiveRecovery: number | null;
    morningStiffness: number | null;
    stairsScore: number | null;
  };
  computed: {
    readinessScore: number | null;
    readinessBand: string | null;
    kneeScore: number | null;
    therapyPhase: string | null;
  };
  baselines: {
    hrv28d: { avg: number; sd: number } | null;
    sleep28d: { avg: number } | null;
    rhr28d: { avg: number; sd: number } | null;
    readiness28d: { avg: number } | null;
  };
  lastSync: string | null;
}

export async function getTodaySensorSnapshot(
  userId: string,
  today: Date,
): Promise<TodaySensorSnapshot | null> {
  const todayKey = dayKey(today);

  const todayRow = await db.dailySensorData.findFirst({
    where: { userId, date: todayKey },
  });

  const baselineFrom = new Date(todayKey.getTime() - 28 * 86400000);
  const baselineRows = await db.dailySensorData.findMany({
    where: { userId, date: { gte: baselineFrom, lt: todayKey } },
    orderBy: { date: "asc" },
  });

  const garmin = (todayRow?.garmin as Record<string, unknown> | null) ?? {};
  const user = (todayRow?.userMorning as Record<string, unknown> | null) ?? {};

  const hrvVals: number[] = [];
  const sleepVals: number[] = [];
  const rhrVals: number[] = [];
  const readinessVals: number[] = [];

  for (const r of baselineRows) {
    const g = r.garmin as Record<string, number | string | null> | null;
    if (g) {
      if (typeof g.hrvRmssd === "number") hrvVals.push(g.hrvRmssd);
      if (typeof g.sleepScore === "number") sleepVals.push(g.sleepScore);
      if (typeof g.rhr === "number") rhrVals.push(g.rhr);
    }
    if (r.readinessScore != null) readinessVals.push(r.readinessScore);
  }

  return {
    date: todayKey.toISOString().slice(0, 10),
    garmin: {
      hrvRmssd: pickNum(garmin.hrvRmssd),
      hrvStatus: pickStr(garmin.hrvStatus),
      sleepScore: pickNum(garmin.sleepScore),
      sleepDurationMin: pickNum(garmin.sleepDurationMin),
      bodyBatteryMorning: pickNum(garmin.bodyBatteryMorning),
      rhr: pickNum(garmin.rhr),
    },
    user: {
      subjectiveRecovery: pickNum(user.subjectiveRecovery),
      morningStiffness: pickNum(user.morningStiffness),
      stairsScore: pickNum(user.stairsScore),
    },
    computed: {
      readinessScore: todayRow?.readinessScore ?? null,
      readinessBand: todayRow?.readinessBand ?? null,
      kneeScore: todayRow?.kneeScore ?? null,
      therapyPhase: todayRow?.therapyPhase ?? null,
    },
    baselines: {
      hrv28d: hrvVals.length > 0 ? { avg: avg(hrvVals), sd: stddev(hrvVals) } : null,
      sleep28d: sleepVals.length > 0 ? { avg: avg(sleepVals) } : null,
      rhr28d: rhrVals.length > 0 ? { avg: avg(rhrVals), sd: stddev(rhrVals) } : null,
      readiness28d: readinessVals.length > 0 ? { avg: avg(readinessVals) } : null,
    },
    lastSync: todayRow?.garminLastSyncAt
      ? todayRow.garminLastSyncAt.toISOString()
      : null,
  };
}

function pickNum(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function pickStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ============================================
// 28-day trend
// ============================================
export interface TrendPoint {
  date: string;
  hrv: number | null;
  sleepScore: number | null;
  sleepDurationMin: number | null;
  bodyBatteryMorning: number | null;
  rhr: number | null;
  readinessScore: number | null;
  acwr: number | null;
  acwrBand: string | null;
  dailyLoad: number | null;
  morningStiffness: number | null;
  stairsScore: number | null;
}

export async function getSensorTrend(
  userId: string,
  days = 28,
): Promise<TrendPoint[]> {
  const today = dayKey(new Date());
  const from = new Date(today.getTime() - days * 86400000);

  const rows = await db.dailySensorData.findMany({
    where: { userId, date: { gte: from, lte: today } },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => {
    const g = (r.garmin as Record<string, unknown> | null) ?? {};
    const u = (r.userMorning as Record<string, unknown> | null) ?? {};
    const lm = (r.loadMetrics as Record<string, unknown> | null) ?? {};
    return {
      date: r.date.toISOString().slice(0, 10),
      hrv: pickNum(g.hrvRmssd),
      sleepScore: pickNum(g.sleepScore),
      sleepDurationMin: pickNum(g.sleepDurationMin),
      bodyBatteryMorning: pickNum(g.bodyBatteryMorning),
      rhr: pickNum(g.rhr),
      readinessScore: r.readinessScore,
      acwr: pickNum(lm.acwrRolling),
      acwrBand: pickStr(lm.band),
      dailyLoad: pickNum(lm.dailyLoadAu),
      morningStiffness: pickNum(u.morningStiffness),
      stairsScore: pickNum(u.stairsScore),
    };
  });
}

// ============================================
// Garmin Sync Health
// ============================================
export interface SyncHealthEntry {
  syncedAt: string;
  status: string;
  hrvSyncOk: boolean;
  sleepSyncOk: boolean;
  bodyBatterySyncOk: boolean;
  rhrSyncOk: boolean;
  activitiesSyncOk: boolean;
  errorType: string | null;
  errorMessage: string | null;
}

export async function getSyncHealth(
  userId: string,
  limit = 10,
): Promise<SyncHealthEntry[]> {
  const rows = await db.garminSyncLog.findMany({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    syncedAt: r.syncedAt.toISOString(),
    status: r.status,
    hrvSyncOk: r.hrvSyncOk,
    sleepSyncOk: r.sleepSyncOk,
    bodyBatterySyncOk: r.bodyBatterySyncOk,
    rhrSyncOk: r.rhrSyncOk,
    activitiesSyncOk: r.activitiesSyncOk,
    errorType: r.errorType,
    errorMessage: r.errorMessage,
  }));
}
