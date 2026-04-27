// Garmin profile + run-history pulls used by VDOT calibration (Sprint v0.7).
//
// I/O layer only. The pure VDOT math lives in lib/coach-engine/vdot-calculator.ts.
// We keep this thin so a Garmin outage degrades gracefully — every caller of
// getGarminProfileMetrics / getRecentRunSummaries must handle nulls + empty arrays.
import { getGarminClient } from "./client";

const GC_API = "https://connectapi.garmin.com";

interface RawHttpClient {
  get: <T>(url: string) => Promise<T>;
}

function rawClientFor(client: unknown): RawHttpClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  const raw: RawHttpClient = c.client ?? c._client ?? c.http;
  if (!raw || typeof raw.get !== "function") {
    throw new Error("Could not access authenticated http client on GarminConnect instance");
  }
  return raw;
}

// ============================================
// Profile metrics (HR zones + VO2max + LT)
// ============================================
export interface GarminProfileMetrics {
  hrMax: number | null;
  hrRest: number | null;
  /** Lactate Threshold HR (often null for Q's account / no LT-detection run). */
  ltHr: number | null;
  /** Lactate Threshold Speed in m/s, often null. */
  ltSpeed: number | null;
  /** Garmin's Firstbeat estimate — known to overestimate for new runners. */
  vo2MaxRunning: number | null;
  /** Garmin's own 5-zone floors (BPM). */
  garminFiveZones: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
}

/**
 * Pull HR zones, personal info, and user-settings in parallel.
 * Each subcall is wrapped in try/catch — partial failures return partial data.
 */
export async function getGarminProfileMetrics(): Promise<GarminProfileMetrics> {
  const client = await getGarminClient();
  const raw = rawClientFor(client);

  const result: GarminProfileMetrics = {
    hrMax: null,
    hrRest: null,
    ltHr: null,
    ltSpeed: null,
    vo2MaxRunning: null,
    garminFiveZones: null,
  };

  // HR zones (biometric-service)
  try {
    const zones = await raw.get<
      Array<{
        maxHeartRateUsed: number;
        restingHeartRateUsed: number;
        lactateThresholdHeartRateUsed: number | null;
        zone1Floor: number;
        zone2Floor: number;
        zone3Floor: number;
        zone4Floor: number;
        zone5Floor: number;
      }>
    >(`${GC_API}/biometric-service/heartRateZones`);
    if (zones[0]) {
      result.hrMax = zones[0].maxHeartRateUsed;
      result.hrRest = zones[0].restingHeartRateUsed;
      result.ltHr = zones[0].lactateThresholdHeartRateUsed;
      result.garminFiveZones = {
        z1: zones[0].zone1Floor,
        z2: zones[0].zone2Floor,
        z3: zones[0].zone3Floor,
        z4: zones[0].zone4Floor,
        z5: zones[0].zone5Floor,
      };
    }
  } catch (e) {
    console.error("[garmin-profile] HR zones fetch failed:", e);
  }

  // Personal info (VO2max, LTHR fallback)
  try {
    const profile = await raw.get<{
      biometricProfile?: {
        vo2Max?: number;
        lactateThresholdHeartRate?: number | null;
      };
    }>(`${GC_API}/userprofile-service/userprofile/personal-information`);
    if (typeof profile.biometricProfile?.vo2Max === "number") {
      result.vo2MaxRunning = profile.biometricProfile.vo2Max;
    }
    if (result.ltHr === null) {
      result.ltHr = profile.biometricProfile?.lactateThresholdHeartRate ?? null;
    }
  } catch (e) {
    console.error("[garmin-profile] personal info fetch failed:", e);
  }

  // User settings (LT speed)
  try {
    const settings = await raw.get<{
      userData?: { lactateThresholdSpeed?: number | null };
    }>(`${GC_API}/userprofile-service/userprofile/user-settings`);
    result.ltSpeed = settings.userData?.lactateThresholdSpeed ?? null;
  } catch (e) {
    console.error("[garmin-profile] user-settings fetch failed:", e);
  }

  return result;
}

// ============================================
// Run summaries for VDOT calibration
// ============================================
export interface RunSummary {
  activityId: number;
  date: string;
  distanceM: number;
  durationSec: number;
  avgHr: number;
  maxHr: number;
  avgPaceSecPerKm: number;
  velocityMperMin: number;
}

const RUN_TYPE_KEYS = new Set([
  "running",
  "street_running",
  "trail_running",
  "indoor_running",
  "treadmill_running",
  "track_running",
]);

/**
 * Pull all running activities from the last `daysBack` days.
 * Filters out walks/cycling/strength, and sub-500m / sub-60s noise.
 * Returns ascending by date (oldest first).
 */
export async function getRecentRunSummaries(daysBack = 90): Promise<RunSummary[]> {
  const client = await getGarminClient();
  const raw = rawClientFor(client);

  let all: Array<{
    activityId: number;
    activityType?: { typeKey?: string };
    startTimeLocal: string;
    distance?: number;
    duration?: number;
    averageHR?: number;
    maxHR?: number;
  }> = [];

  try {
    all = await raw.get(
      `${GC_API}/activitylist-service/activities/search/activities?start=0&limit=100`,
    );
  } catch (e) {
    console.error("[garmin-profile] activities list fetch failed:", e);
    return [];
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  return all
    .filter((a) => RUN_TYPE_KEYS.has(a.activityType?.typeKey ?? ""))
    .filter((a) => new Date(a.startTimeLocal) > cutoff)
    .filter(
      (a) =>
        (a.distance ?? 0) > 500 &&
        (a.duration ?? 0) > 60 &&
        (a.averageHR ?? 0) > 0,
    )
    .map((a) => ({
      activityId: a.activityId,
      date: a.startTimeLocal,
      distanceM: a.distance ?? 0,
      durationSec: Math.round(a.duration ?? 0),
      avgHr: Math.round(a.averageHR ?? 0),
      maxHr: Math.round(a.maxHR ?? 0),
      avgPaceSecPerKm: Math.round((a.duration ?? 0) / ((a.distance ?? 0) / 1000)),
      velocityMperMin: ((a.distance ?? 0) / (a.duration ?? 1)) * 60,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
