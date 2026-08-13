// Garmin daily sensor sync.
// Each datatype is fetched independently with its own try/catch so partial
// breakage produces a PARTIAL log entry instead of zero data.
import { toUserDateString } from "@/lib/date";
import { clearGarminSession, getGarminClient } from "./client";

const GC_API = "https://connectapi.garmin.com";

export interface GarminDailySnapshot {
  hrvStatus: string | null;
  hrvRmssd: number | null;
  sleepScore: number | null;
  sleepDurationMin: number | null;
  bodyBatteryMorning: number | null;
  rhr: number | null;

  // Sprint v0.16 Phase A2: extended wellness fields. All from the same
  // usersummary-service/usersummary/daily endpoint already used for body
  // battery — single network call, multiple fields.
  totalKilocalories: number | null;
  activeKilocalories: number | null;
  bmrKilocalories: number | null;
  bodyBatteryEnd: number | null;
  averageStress: number | null;
}

export interface SyncStatusFlags {
  hrvSyncOk: boolean;
  sleepSyncOk: boolean;
  bodyBatterySyncOk: boolean;
  rhrSyncOk: boolean;
  activitiesSyncOk: boolean;
  /** Sprint 2.8. Without this, SUCCESS said nothing about the calorie columns. */
  energySyncOk: boolean;
}

export interface SyncResult {
  status: "SUCCESS" | "PARTIAL" | "FAILURE";
  flags: SyncStatusFlags;
  snapshot: GarminDailySnapshot;
  activitiesCount: number;
  errors: { datatype: string; message: string }[];
  /**
   * Sprint 2.8: set when the failure was authentication. Callers need to branch
   * on this (clear the session, alert) and string-matching the message is how
   * that kind of branch rots.
   */
  authFailed?: boolean;
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
export async function syncGarminForDate(
  date: Date,
  deps?: { client?: ApiClient },
): Promise<SyncResult> {
  const flags: SyncStatusFlags = {
    hrvSyncOk: false,
    sleepSyncOk: false,
    bodyBatterySyncOk: false,
    rhrSyncOk: false,
    activitiesSyncOk: false,
    energySyncOk: false,
  };
  const snapshot: GarminDailySnapshot = {
    hrvStatus: null,
    hrvRmssd: null,
    sleepScore: null,
    sleepDurationMin: null,
    bodyBatteryMorning: null,
    rhr: null,
    totalKilocalories: null,
    activeKilocalories: null,
    bmrKilocalories: null,
    bodyBatteryEnd: null,
    averageStress: null,
  };
  const errors: { datatype: string; message: string }[] = [];
  let activitiesCount = 0;

  let client: ApiClient;
  try {
    client = (deps?.client ?? (await getGarminClient())) as unknown as ApiClient;
  } catch (e) {
    // Sprint 2.8: drop the cached session before giving up. It lives for 30
    // minutes (client.ts), so without this a single 403 kept every subsequent
    // attempt pointed at the same dead session until the TTL expired.
    clearGarminSession();
    return {
      status: "FAILURE",
      flags,
      snapshot,
      activitiesCount: 0,
      errors: [{ datatype: "auth", message: e instanceof Error ? e.message : String(e) }],
      authFailed: true,
    };
  }

  // Profile (used to scope a few endpoints)
  let displayName = "";
  try {
    const profile = await client.getUserProfile();
    displayName = profile?.displayName ?? "";
  } catch {
    /* non-fatal — see the fallback below */
  }
  // Sprint 2.8: a profile hiccup used to take the whole daily-summary block with
  // it (the throw at the top of that try), i.e. body battery AND all three
  // calorie fields, reported under the wrong datatype. The env fallback keeps
  // the block alive; if both are empty we now say so honestly instead.
  if (!displayName) displayName = process.env.GARMIN_DISPLAY_NAME ?? "";

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
      // Sprint 2.8: the flag used to be set merely because the DTO existed, so
      // "sleepSyncOk" could be true with a null score. A flag that says the call
      // succeeded rather than that data arrived is what made SUCCESS meaningless.
      flags.sleepSyncOk = score != null;
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
      flags.hrvSyncOk = snapshot.hrvRmssd != null; // same reasoning as sleep above
    }
  } catch (e) {
    errors.push({ datatype: "hrv", message: e instanceof Error ? e.message : String(e) });
  }

  // Daily user-summary -----------------------------------------------------
  // One endpoint, many fields: body battery (morning + end), TDEE / calorie
  // breakdown, average stress. Sprint v0.16 Phase A2.2.
  try {
    if (!displayName) {
      errors.push({
        datatype: "profile",
        message: "No Garmin displayName (profile call failed and GARMIN_DISPLAY_NAME unset) — daily summary skipped",
      });
      throw new SkipSummary();
    }
    const url = `${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${dateKey(date)}`;
    const summary = (await client.get<{
      bodyBatteryMostRecentValue?: number;
      bodyBatteryAtWakeTime?: number;
      bodyBatteryLowestValue?: number;
      totalKilocalories?: number;
      activeKilocalories?: number;
      bmrKilocalories?: number;
      averageStressLevel?: number;
    }>(url)) ?? {};

    // Body battery morning — prefer at-wake-time, fall back to most-recent.
    if (typeof summary.bodyBatteryAtWakeTime === "number") {
      snapshot.bodyBatteryMorning = summary.bodyBatteryAtWakeTime;
      flags.bodyBatterySyncOk = true;
    } else if (typeof summary.bodyBatteryMostRecentValue === "number") {
      snapshot.bodyBatteryMorning = summary.bodyBatteryMostRecentValue;
      flags.bodyBatterySyncOk = true;
    }

    // Body battery end — most-recent for a day in the past = end-of-day value.
    if (typeof summary.bodyBatteryMostRecentValue === "number") {
      snapshot.bodyBatteryEnd = summary.bodyBatteryMostRecentValue;
    }

    // TDEE breakdown
    if (typeof summary.totalKilocalories === "number") {
      snapshot.totalKilocalories = Math.round(summary.totalKilocalories);
    }
    if (typeof summary.activeKilocalories === "number") {
      snapshot.activeKilocalories = Math.round(summary.activeKilocalories);
    }
    if (typeof summary.bmrKilocalories === "number") {
      snapshot.bmrKilocalories = Math.round(summary.bmrKilocalories);
    }
    // Sprint 2.8: active is intentionally not required — a genuine rest day can
    // be 0, and the value is derivable from total − bmr anyway.
    if (snapshot.totalKilocalories != null && snapshot.bmrKilocalories != null) {
      flags.energySyncOk = true;
    }

    // Stress (0-100, daily average; -1 / -2 in Garmin = no data)
    if (
      typeof summary.averageStressLevel === "number" &&
      summary.averageStressLevel >= 0
    ) {
      snapshot.averageStress = summary.averageStressLevel;
    }
  } catch (e) {
    // The skip already recorded its own, more specific error.
    if (!(e instanceof SkipSummary)) {
      // One endpoint feeds body battery, energy and stress — attributing its
      // failure to "body_battery" mislabelled every energy outage as a body
      // battery one. The flags say which fields actually landed.
      errors.push({ datatype: "daily_summary", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Activities (last 5; we only count, not parse details here)
  try {
    const recent = await client.getActivities(0, 5);
    activitiesCount = Array.isArray(recent) ? recent.length : 0;
    flags.activitiesSyncOk = true;
  } catch (e) {
    errors.push({ datatype: "activities", message: e instanceof Error ? e.message : String(e) });
  }

  // Sprint 2.8: derive the ceiling from the flag set instead of a literal. The
  // hardcoded 5 is why adding a sixth flag would silently have made SUCCESS
  // unreachable.
  const okCount = Object.values(flags).filter(Boolean).length;
  const flagCount = Object.keys(flags).length;
  const status = okCount === flagCount ? "SUCCESS" : okCount === 0 ? "FAILURE" : "PARTIAL";

  // An auth error surfacing mid-run leaves the cached session dead too.
  const authFailed = errors.some((e) => classifyError(e.message) === "AUTH_FAILURE");
  if (authFailed) clearGarminSession();

  return { status, flags, snapshot, activitiesCount, errors, authFailed };
}

/** Internal sentinel: skip the daily-summary block without logging a second error. */
class SkipSummary extends Error {}

/** Classify a thrown error from sync into the spec's errorType buckets. */
export function classifyError(message: string): string {
  const lower = message.toLowerCase();
  // Sprint 2.8: bare status codes added. A Garmin 403 often carries only
  // "Forbidden" as its body, which classified as API_CHANGED — so nothing that
  // keys off AUTH_FAILURE (session clear, alerting) would ever have fired.
  if (/auth|unauthor|login|credential|password|forbidden|\b401\b|\b403\b/.test(lower)) return "AUTH_FAILURE";
  if (/rate.?limit|429|throttl/.test(lower)) return "RATE_LIMIT";
  if (/parse|json|unexpected token/.test(lower)) return "PARSE_ERROR";
  if (/network|fetch|timeout|econnreset|enotfound/.test(lower)) return "NETWORK";
  return "API_CHANGED";
}
