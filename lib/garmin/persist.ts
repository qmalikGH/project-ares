// The single writer for Garmin sync results — Sprint 2.8.
//
// WHY THIS EXISTS
//
// There were two writers: the daily cron and the manual/UI sync route. They
// drifted, and every consequence was invisible from the sync status:
//
//   - The manual route never persisted the five v0.16 energy columns at all.
//     They were added to the cron and never back-ported. Result: a SUCCESS log
//     next to NULL calories (2026-08-12, 2026-08-13).
//   - On an auth failure `syncGarminForDate` RETURNS an all-null snapshot
//     rather than throwing, and the cron happily wrote it over a populated row
//     — with a fresh `garminLastSyncAt`. A 403 did not merely fail to add data,
//     it deleted data that was already there (2026-08-12 lost rhr/hrv/sleep/bb).
//
// Both are structurally impossible from here on: one function writes, and it
// never lets an absent value overwrite a present one.
//
// This module imports the db by design — one implementation, no second copy to
// drift.

import { db } from "@/lib/db/client";
import { userTodayForUser } from "@/lib/date";
import { createNotificationIfNew } from "@/lib/notifications/create";
import { classifyError, type SyncResult } from "./sync";

/** Cumulative, end-of-day columns. Meaningless before the day is over. */
const DAY_TOTAL_COLUMNS = [
  "totalKilocalories",
  "activeKilocalories",
  "bmrKilocalories",
  "bodyBatteryEnd",
  "averageStress",
] as const;

type DayTotalColumn = (typeof DAY_TOTAL_COLUMNS)[number];

export interface PersistOutcome {
  syncLogId: string;
  /** false when the write was deliberately skipped (a failed sync). */
  wrote: boolean;
  skippedReason?: string;
  /** Fields carried over from the existing row because the sync had none. */
  preserved: string[];
  /** Day-total columns withheld because the day is still running. */
  withheldDayTotals: string[];
}

/**
 * Merge rule: **incoming wins unless incoming is null.**
 *
 * Deliberately NOT `existing ?? incoming` — that is the freeze bug in the
 * backfill script, where a mid-morning partial value could never be replaced by
 * the real one. A later, fuller reading must be allowed to correct an earlier
 * one; that is what repairs a day that was first synced while still running.
 *
 * There is exactly one case where a null is the truth (the athlete deletes an
 * activity in Garmin Connect, so "no data" becomes correct). No consumer can
 * tell that apart from "not synced yet", and an automatic null write is the
 * failure this module exists to prevent — so it is never automatic. The escape
 * hatch is the operator-run backfill with --force.
 */
export function mergeNonNull<T extends Record<string, unknown>>(
  existing: T | null | undefined,
  incoming: T,
): { merged: T; preserved: string[] } {
  const merged = { ...(existing ?? {}) } as T;
  const preserved: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (value != null) {
      (merged as Record<string, unknown>)[key] = value;
    } else if (existing && (existing as Record<string, unknown>)[key] != null) {
      preserved.push(key);
    }
  }
  return { merged, preserved };
}

/** Column patch for the five day-total columns: null-valued keys are omitted. */
export function mergeEnergyColumns(
  existing: Partial<Record<DayTotalColumn, number | null>> | null | undefined,
  incoming: Partial<Record<DayTotalColumn, number | null>>,
  opts: { force?: boolean } = {},
): { patch: Partial<Record<DayTotalColumn, number>>; preserved: string[] } {
  const patch: Partial<Record<DayTotalColumn, number>> = {};
  const preserved: string[] = [];
  for (const col of DAY_TOTAL_COLUMNS) {
    const value = incoming[col];
    const current = existing?.[col];
    if (value == null) {
      if (current != null) preserved.push(col);
      continue;
    }
    // Without --force an already-populated column is left alone: that is the
    // backfill's "don't re-fetch what we have" contract. The sync path always
    // passes force, because a fresher reading is by definition better.
    if (!opts.force && current != null) {
      preserved.push(col);
      continue;
    }
    patch[col] = value;
  }
  return { patch, preserved };
}

/**
 * Write one sync result: the log row, the notification on failure, and the
 * merged sensor snapshot. Exactly one log row per call.
 */
export async function persistGarminSync(input: {
  userId: string;
  date: Date;
  result: SyncResult;
  /** Injectable for tests; defaults to the user's local "today". */
  todayOverride?: Date;
}): Promise<PersistOutcome> {
  const { userId, date, result } = input;

  const syncLog = await db.garminSyncLog.create({
    data: {
      userId,
      status: result.status,
      hrvSyncOk: result.flags.hrvSyncOk,
      sleepSyncOk: result.flags.sleepSyncOk,
      bodyBatterySyncOk: result.flags.bodyBatterySyncOk,
      rhrSyncOk: result.flags.rhrSyncOk,
      activitiesSyncOk: result.flags.activitiesSyncOk,
      energySyncOk: result.flags.energySyncOk,
      // Pick the most severe error, not the first one: an auth failure that
      // surfaces second used to be recorded as whatever failed before it.
      errorType: pickErrorType(result.errors),
      errorMessage: result.errors.length > 0
        ? result.errors.map((e) => `${e.datatype}: ${e.message}`).join(" | ")
        : null,
    },
    select: { id: true },
  });

  if (result.status === "FAILURE") {
    await maybeNotifyOnGarminFailures(userId);
    // The primary guard. A failed sync carries an all-null snapshot; writing it
    // would erase the row, and stamping garminLastSyncAt would destroy the only
    // staleness signal the UI has.
    return {
      syncLogId: syncLog.id,
      wrote: false,
      skippedReason: result.authFailed ? "auth_failure" : "sync_failure",
      preserved: [],
      withheldDayTotals: [],
    };
  }

  const today = input.todayOverride ?? (await userTodayForUser(userId));
  const dayStillRunning = date.getTime() >= today.getTime();

  const existing = await db.dailySensorData.findFirst({ where: { userId, date } });

  const wellness = {
    hrvStatus: result.snapshot.hrvStatus,
    hrvRmssd: result.snapshot.hrvRmssd,
    sleepScore: result.snapshot.sleepScore,
    sleepDurationMin: result.snapshot.sleepDurationMin,
    bodyBatteryMorning: result.snapshot.bodyBatteryMorning,
    rhr: result.snapshot.rhr,
  };
  const { merged: garminPayload, preserved: preservedWellness } = mergeNonNull(
    (existing?.garmin as Record<string, unknown> | null) ?? null,
    wellness as unknown as Record<string, unknown>,
  );

  // Day totals are cumulative; a reading taken while the day is still running is
  // a fraction, not a measurement. Writing those fractions is what left an
  // impossible BMR of 847 permanently on 2026-08-10. Nothing reads today's TDEE
  // (the calibration and the export both average past days only), so withholding
  // them costs nothing — the caller still gets the live values in the response.
  const { patch: energyPatch, preserved: preservedEnergy } = dayStillRunning
    ? { patch: {}, preserved: [] as string[] }
    : mergeEnergyColumns(existing, {
        totalKilocalories: result.snapshot.totalKilocalories,
        activeKilocalories: result.snapshot.activeKilocalories,
        bmrKilocalories: result.snapshot.bmrKilocalories,
        bodyBatteryEnd: result.snapshot.bodyBatteryEnd,
        averageStress: result.snapshot.averageStress,
      }, { force: true });

  if (existing) {
    await db.dailySensorData.update({
      where: { id: existing.id },
      data: {
        garmin: garminPayload as object,
        ...energyPatch,
        garminLastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    });
  } else {
    await db.dailySensorData.create({
      data: {
        userId,
        date,
        garmin: garminPayload as object,
        ...energyPatch,
        garminLastSyncAt: new Date(),
      },
    });
  }

  return {
    syncLogId: syncLog.id,
    wrote: true,
    preserved: [...preservedWellness, ...preservedEnergy],
    withheldDayTotals: dayStillRunning ? [...DAY_TOTAL_COLUMNS] : [],
  };
}

/** Log a sync that threw before it could produce a result. */
export async function writeGarminSyncFailureLog(userId: string, message: string): Promise<void> {
  await db.garminSyncLog.create({
    data: {
      userId,
      status: "FAILURE",
      hrvSyncOk: false,
      sleepSyncOk: false,
      bodyBatterySyncOk: false,
      rhrSyncOk: false,
      activitiesSyncOk: false,
      energySyncOk: false,
      errorType: classifyError(message),
      errorMessage: message,
    },
  });
  await maybeNotifyOnGarminFailures(userId);
}

/**
 * Raise a notification on a failure streak. Moved out of the manual sync route
 * so the cron gets it too — until Sprint 2.8 the cron raised nothing at all, and
 * the 2026-08-13 auth failure was completely silent.
 */
export async function maybeNotifyOnGarminFailures(userId: string): Promise<void> {
  const recent = await db.garminSyncLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { status: true },
  });
  let consecutive = 0;
  for (const r of recent) {
    if (r.status === "FAILURE") consecutive++;
    else break;
  }
  // Was `=== 2`, which meant failures 3 and 4 in a row were silent. The
  // ≥5 case keeps its own harder wording; createNotificationIfNew dedupes.
  if (consecutive >= 5) {
    await createNotificationIfNew({
      userId,
      type: "GARMIN_SYNC_FAILURE",
      title: "Garmin-Sync seit Tagen defekt",
      message: `${consecutive} Fehlversuche in Folge. Wahrscheinlich abgelaufene Zugangsdaten — bitte Garmin-Login prüfen.`,
      severity: "CRITICAL",
      actionUrl: "/settings",
    }, 24 * 60);
  } else if (consecutive >= 2) {
    await createNotificationIfNew({
      userId,
      type: "GARMIN_SYNC_FAILURE",
      title: "Garmin-Sync fehlgeschlagen",
      message: `${consecutive} Fehlversuche in Folge. Readiness, Ruhepuls und TDEE laufen ohne frische Daten weiter.`,
      severity: "WARNING",
      actionUrl: "/settings",
    }, 12 * 60);
  }
}

const ERROR_SEVERITY = ["AUTH_FAILURE", "RATE_LIMIT", "NETWORK", "PARSE_ERROR", "API_CHANGED"];

function pickErrorType(errors: { message: string }[]): string | null {
  if (errors.length === 0) return null;
  const types = errors.map((e) => classifyError(e.message));
  for (const candidate of ERROR_SEVERITY) {
    if (types.includes(candidate)) return candidate;
  }
  return types[0];
}
