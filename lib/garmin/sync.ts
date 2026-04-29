// Garmin daily sensor sync.
// Each datatype is fetched independently with its own try/catch so partial
// breakage produces a PARTIAL log entry instead of zero data.
import { toUserDateString } from "@/lib/date";
import { getGarminClient } from "./client";

const GC_API = "https://connectapi.garmin.com";

export interface GarminDailySnapshot {
  hrvStatus: string | null;
  hrvRmssd: number | null;
  sleepScore: number | null;
  sleepDurationMin: number | null;
  bodyBatteryMorning: number | null;
  rhr: number | null;
}

export interface SyncStatusFlags {
  hrvSyncOk: boolean;
  sleepSyncOk: boolean;
  bodyBatterySyncOk: boolean;
  rhrSyncOk: boolean;
  activitiesSyncOk: boolean;
}

export interface SyncResult {
  status: "SUCCESS" | "PARTIAL" | "FAILURE";
  flags: SyncStatusFlags;
  snapshot: GarminDailySnapshot;
  activitiesCount: number;
  errors: { datatype: string; message: string }[];
}

function dateKey(date: Date): string {
  return toUserDateString(date);
}

interface ApiClient {
  get<T>(url: string): Promise<T>;
  getSleepData(date?: Date): Promise<unknown>;
  getHeartRate(date?: Date): Promise<unknown>;
  getActivities(start?: number, limit?: number): Promise<unknown[]>;
  getUserProfile(): Promise<{ displayName?: string }>;
}

/**
 * Pull all 5 datatypes for `date`. Per spec section 9.4, every datatype gets
 * its own ok/fail flag for the GarminSyncLog row.
 */
export async function syncGarminForDate(date: Date): Promise<SyncResult> {
  const flags: SyncStatusFlags = {
    hrvSyncOk: false,
    sleepSyncOk: false,
    bodyBatterySyncOk: false,
    rhrSyncOk: false,
    activitiesSyncOk: false,
  };
  const snapshot: GarminDailySnapshot = {
    hrvStatus: null,
    hrvRmssd: null,
    sleepScore: null,
    sleepDurationMin: null,
    bodyBatteryMorning: null,
    rhr: null,
  };
  const errors: { datatype: string; message: string }[] = [];
  let activitiesCount = 0;

  let client: ApiClient;
  try {
    client = (await getGarminClient()) as unknown as ApiClient;
  } catch (e) {
    return {
      status: "FAILURE",
      flags,
      snapshot,
      activitiesCount: 0,
      errors: [{ datatype: "auth", message: e instanceof Error ? e.message : String(e) }],
    };
  }

  // Profile (used to scope a few endpoints)
  let displayName = "";
  try {
    const profile = await client.getUserProfile();
    displayName = profile?.displayName ?? "";
  } catch {
    /* non-fatal */
  }

  // Sleep ------------------------------------------------------------------
  // Garmin returns multiple score fields with subtle differences:
  //   - sleepScores.overall.value     — current "official" score (Q's UI shows this)
  //   - sleepScores.totalScore        — legacy field, sometimes lags by sync
  //   - dailySleepDTO.sleepQualityTypeName — categorical label
  // We prefer overall.value but fall back to totalScore. The 70 vs 72 delta Q
  // observed is most likely a sync race: Connect-App re-fetches and updates the
  // score after the watch finishes uploading detailed phases (~1h post-wake).
  try {
    const sleep = (await client.getSleepData(date)) as
      | {
          dailySleepDTO?: {
            sleepScores?: {
              overall?: { value?: number };
              totalScore?: number;
            };
            sleepTimeSeconds?: number;
            sleepQualityTypeName?: string;
          };
        }
      | null;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[garmin-sync] Sleep raw scores:",
        JSON.stringify(sleep?.dailySleepDTO?.sleepScores ?? null),
      );
    }
    if (sleep?.dailySleepDTO) {
      const overall = sleep.dailySleepDTO.sleepScores?.overall?.value;
      const total = sleep.dailySleepDTO.sleepScores?.totalScore;
      const score = typeof overall === "number" ? overall : typeof total === "number" ? total : null;
      const seconds = sleep.dailySleepDTO.sleepTimeSeconds;
      snapshot.sleepScore = score;
      snapshot.sleepDurationMin = typeof seconds === "number" ? Math.round(seconds / 60) : null;
      flags.sleepSyncOk = true;
    }
  } catch (e) {
    errors.push({ datatype: "sleep", message: e instanceof Error ? e.message : String(e) });
  }

  // Heart rate (resting HR) ------------------------------------------------
  try {
    const hr = (await client.getHeartRate(date)) as { restingHeartRate?: number } | null;
    if (hr?.restingHeartRate != null) {
      snapshot.rhr = hr.restingHeartRate;
      flags.rhrSyncOk = true;
    }
  } catch (e) {
    errors.push({ datatype: "rhr", message: e instanceof Error ? e.message : String(e) });
  }

  // HRV --------------------------------------------------------------------
  try {
    const hrvUrl = `${GC_API}/hrv-service/hrv/${dateKey(date)}`;
    const hrv = (await client.get<{
      hrvSummary?: { lastNightAvg?: number; status?: string; weeklyAvg?: number };
    }>(hrvUrl)) ?? {};
    if (hrv.hrvSummary) {
      snapshot.hrvRmssd = hrv.hrvSummary.lastNightAvg ?? hrv.hrvSummary.weeklyAvg ?? null;
      snapshot.hrvStatus = hrv.hrvSummary.status ?? null;
      flags.hrvSyncOk = true;
    }
  } catch (e) {
    errors.push({ datatype: "hrv", message: e instanceof Error ? e.message : String(e) });
  }

  // Body Battery ------------------------------------------------------------
  // Use the user-summary endpoint for body battery start-of-day.
  try {
    if (!displayName) throw new Error("Missing displayName for body battery endpoint");
    const url = `${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${dateKey(date)}`;
    const summary = (await client.get<{
      bodyBatteryMostRecentValue?: number;
      bodyBatteryAtWakeTime?: number;
    }>(url)) ?? {};
    if (typeof summary.bodyBatteryAtWakeTime === "number") {
      snapshot.bodyBatteryMorning = summary.bodyBatteryAtWakeTime;
      flags.bodyBatterySyncOk = true;
    } else if (typeof summary.bodyBatteryMostRecentValue === "number") {
      snapshot.bodyBatteryMorning = summary.bodyBatteryMostRecentValue;
      flags.bodyBatterySyncOk = true;
    }
  } catch (e) {
    errors.push({ datatype: "body_battery", message: e instanceof Error ? e.message : String(e) });
  }

  // Activities (last 5; we only count, not parse details here)
  try {
    const recent = await client.getActivities(0, 5);
    activitiesCount = Array.isArray(recent) ? recent.length : 0;
    flags.activitiesSyncOk = true;
  } catch (e) {
    errors.push({ datatype: "activities", message: e instanceof Error ? e.message : String(e) });
  }

  const okCount = Object.values(flags).filter(Boolean).length;
  const status = okCount === 5 ? "SUCCESS" : okCount === 0 ? "FAILURE" : "PARTIAL";

  return { status, flags, snapshot, activitiesCount, errors };
}

/** Classify a thrown error from sync into the spec's errorType buckets. */
export function classifyError(message: string): string {
  const lower = message.toLowerCase();
  if (/auth|unauthor|login|credential|password/.test(lower)) return "AUTH_FAILURE";
  if (/rate.?limit|429|throttl/.test(lower)) return "RATE_LIMIT";
  if (/parse|json|unexpected token/.test(lower)) return "PARSE_ERROR";
  if (/network|fetch|timeout|econnreset|enotfound/.test(lower)) return "NETWORK";
  return "API_CHANGED";
}
