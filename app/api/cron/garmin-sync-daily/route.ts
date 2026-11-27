// GET /api/cron/garmin-sync-daily
// Vercel Cron: 0 5 * * * (daily at 05:00 UTC).
// Pulls Garmin data for the prior day for every active user.
//
// Sprint 3.4 (#28): order and budget.
//   1. Raw activities of the last 14 days → GarminActivity (+ run details).
//      Raw data first: an activity is never lost because a later step failed.
//   2. Wellness/energy for yesterday.
//   3. Session auto-import.
//   4. Gap sweep over 14 days — bounded per run, newest first, each day at
//      most once per ~20 h (GarminSyncLog.targetDate).
//   5. Weekly recalibrations — only while time is left.
// Every Garmin call has a 15 s limit (timeout.ts) and the run has a wall-clock
// budget below maxDuration, so a slow Garmin skips work instead of getting the
// function killed without a log.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { userTodayForUser } from "@/lib/date";
import { syncGarminForDate } from "@/lib/garmin/sync";
import { persistGarminSync, writeGarminSyncFailureLog } from "@/lib/garmin/persist";
import { autoImportRecent } from "@/lib/garmin/auto-import";
import { syncRecentActivities } from "@/lib/garmin/activity-store";
import { sweepRecentGaps } from "@/lib/garmin/gap-sweep";
import { createDeadline, type Deadline } from "@/lib/garmin/timeout";
import { createNotificationIfNew } from "@/lib/notifications/create";
import { calibrateMealPlan } from "@/lib/nutrition/calibration";
import { recalibrateHrRest } from "@/lib/coach-engine/hr-calibration";
import { recalibrateVdot } from "@/lib/coach-engine/vdot-recalibration";

/** Sprint v1.8 #4: damp dynamic-deficit recompute to ~once per week. */
const RECALIBRATION_INTERVAL_MS = 7 * 86400000;

/** Sprint 3.4 (#28): raw activities of the last 14 days are fetched each run. */
const ACTIVITY_SYNC_DAYS = 14;

/**
 * Sprint 2.9: how far back the session auto-import looks. Wider than the old
 * gap sweep because a missed import is not self-healing the way a missed
 * sensor row is.
 */
const AUTO_IMPORT_DAYS = 7;

export const maxDuration = 60;
/** Wall-clock budget per invocation, below maxDuration. */
const RUN_BUDGET_MS = 50_000;
/** Below this much time left, a recalibration (which may regenerate) is skipped. */
const RECALIBRATION_RESERVE_MS = 15_000;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return process.env.CRON_SECRET ? auth === expected : false;
}

type UserResult = {
  userId: string;
  status: string;
  errors: number;
  syncedFor?: string;
  wrote?: boolean;
  skippedReason?: string;
  preserved?: string[];
  activities?: { fetched: number; created: number; details: number; complete: boolean };
  gapsRepaired?: string[];
  gapsDeferred?: number;
  autoImported?: string[];
  needsConfirmation?: number;
  recalibrated?: string;
  hrRecalibrated?: string;
  vdotRecalibrated?: string;
  /** Sprint 3.4 (#28): every non-fatal error of the run, prefixed by step. */
  errorDetails?: string[];
};

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deadline = createDeadline(RUN_BUDGET_MS);

  // For v0.1 single-user mode this is just Q. Once multi-user lands, iterate.
  const users = await db.user.findMany({
    where: { goals: { some: { status: "active" } } },
    select: { id: true },
  });

  const results: UserResult[] = [];

  for (const user of users) {
    // Per-user "yesterday" — respects each user's persisted timezone.
    const today = await userTodayForUser(user.id);
    const yesterday = new Date(today.getTime() - 86400000);
    const errorDetails: string[] = [];
    const noteError = (step: string, message: string) => {
      const line = `${step}: ${message}`;
      errorDetails.push(line);
      console.error(`[cron garmin-sync-daily] ${line}`);
    };
    let loggedThisRun = false;
    try {
      // 1. Raw activities — before anything that can fail the run.
      const acts = await syncRecentActivities(user.id, today, ACTIVITY_SYNC_DAYS, deadline);
      for (const e of acts.errors) noteError("activities", e);

      // 2. Wellness/energy for yesterday.
      let result = await syncGarminForDate(yesterday);
      // Sprint 2.8: one in-process retry after an auth failure. syncGarminForDate
      // drops the cached session on its way out, so the retry re-authenticates
      // instead of hammering the same dead 30-minute session.
      if (result.authFailed) {
        result = await syncGarminForDate(yesterday);
      }

      // One writer for both routes: log row, merge-write, failure notification.
      const outcome = await persistGarminSync({ userId: user.id, date: yesterday, result });
      loggedThisRun = true;
      for (const e of result.errors) noteError(`sync ${e.datatype}`, e.message);

      const activities = {
        fetched: acts.fetched,
        created: acts.created.length,
        details: acts.details,
        complete: acts.complete,
      };

      // Sprint 2.8: a failed sync leaves nothing new to calibrate against.
      if (result.status === "FAILURE") {
        results.push({
          userId: user.id,
          status: result.status,
          errors: result.errors.length,
          syncedFor: yesterday.toISOString().slice(0, 10),
          wrote: outcome.wrote,
          skippedReason: outcome.skippedReason,
          activities,
          errorDetails,
        });
        continue;
      }

      // 3. Session auto-import. Best-effort: a failure here must not cost us
      // the sensor sync that already succeeded.
      let autoImported: string[] | undefined;
      let needsConfirmation: number | undefined;
      try {
        const imp = await autoImportRecent(user.id, yesterday, AUTO_IMPORT_DAYS);
        if (imp.imported.length > 0) {
          autoImported = imp.imported.map((i) => `${i.date} ${i.type}`);
        }
        if (imp.needsConfirmation.length > 0) needsConfirmation = imp.needsConfirmation.length;
        // Sprint 3.4 (#28): these were dropped on the floor before.
        for (const e of imp.errors) noteError("auto-import", e);

        // Sprint 3.0: nudge toward /confirm.
        const awaiting = imp.imported.length + imp.needsConfirmation.length;
        if (awaiting > 0) {
          await createNotificationIfNew(
            {
              userId: user.id,
              type: "SESSIONS_AWAITING_CONFIRMATION",
              title: `${awaiting} Einheit${awaiting === 1 ? "" : "en"} unbestätigt`,
              message:
                "Die Uhr hat Dauer, Strecke und Puls geliefert. Es fehlen nur RPE und Schienbein — " +
                "solange die fehlen, bleibt die Volumen-Bremse auf hold.",
              severity: "INFO",
              actionUrl: "/confirm",
            },
            20 * 60, // once a day at most
          );
        }
      } catch (impErr) {
        noteError("auto-import", impErr instanceof Error ? impErr.message : String(impErr));
      }

      // 4. Gap sweep.
      const sweep = await sweepRecentGaps(user.id, yesterday, deadline);
      for (const e of sweep.errors) noteError("sweep", e);

      // 5. Weekly recalibrations, only while time is left.
      const recalibrated = await runIfTime(deadline, async () => {
        const plan = await db.mealPlan.findFirst({
          where: { userId: user.id, status: "active" },
          select: { calibratedAt: true },
        });
        const lastCal = plan?.calibratedAt?.getTime() ?? 0;
        if (Date.now() - lastCal < RECALIBRATION_INTERVAL_MS) return undefined;
        const cal = await calibrateMealPlan(user.id);
        return cal.status;
      });

      // Sprint v1.9 #4 — HRrest recalibration from the rolling 28d RHR median.
      const hrRecalibrated = await runIfTime(deadline, async () => {
        const us = await db.userSettings.findUnique({
          where: { userId: user.id },
          select: { hrZonesUpdatedAt: true },
        });
        const lastHr = us?.hrZonesUpdatedAt?.getTime() ?? 0;
        if (Date.now() - lastHr < RECALIBRATION_INTERVAL_MS) return undefined;
        const hr = await recalibrateHrRest(user.id);
        return hr.status === "updated" ? `updated:${hr.hrRest}` : hr.status;
      });

      // Sprint 2.6 (A6) — VDOT recalibration; applying regenerates + materializes.
      const vdotRecalibrated = await runIfTime(deadline, async () => {
        const vs = await db.userSettings.findUnique({
          where: { userId: user.id },
          select: { vdotOverrideAt: true },
        });
        const lastVdot = vs?.vdotOverrideAt?.getTime() ?? 0;
        if (Date.now() - lastVdot < RECALIBRATION_INTERVAL_MS) return undefined;
        const v = await recalibrateVdot(user.id);
        return v.status === "applied" ? `applied:${v.decision?.newVdot}` : v.status;
      });

      results.push({
        userId: user.id,
        status: result.status,
        errors: result.errors.length,
        syncedFor: yesterday.toISOString().slice(0, 10),
        wrote: outcome.wrote,
        preserved: outcome.preserved.length > 0 ? outcome.preserved : undefined,
        activities,
        gapsRepaired: sweep.repaired.length > 0 ? sweep.repaired : undefined,
        gapsDeferred: sweep.deferred > 0 ? sweep.deferred : undefined,
        autoImported,
        needsConfirmation,
        recalibrated,
        hrRecalibrated,
        vdotRecalibrated,
        errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      noteError("run", message);
      // Only log here if persist didn't already — otherwise a throw after a
      // successful persist wrote TWO failure rows for one run and inflated the
      // consecutive-failure count that drives alerting.
      if (!loggedThisRun) {
        await writeGarminSyncFailureLog(user.id, message, yesterday);
      }
      results.push({ userId: user.id, status: "FAILURE", errors: 1, errorDetails });
    }
  }

  // Sprint 2.8: 500 only when every user failed; a PARTIAL (a night without the
  // watch) is not an incident.
  const allFailed = results.length > 0 && results.every((r) => r.status === "FAILURE");
  return NextResponse.json(
    { ranAt: new Date().toISOString(), results },
    { status: allFailed ? 500 : 200 },
  );
}

/** Run a recalibration only while enough budget is left; errors become a status string. */
async function runIfTime(
  deadline: Deadline,
  fn: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (deadline.isNear(RECALIBRATION_RESERVE_MS)) return "skipped: time budget";
  try {
    return await fn();
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
