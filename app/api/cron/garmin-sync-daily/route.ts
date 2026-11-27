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
import { autoImportFromStore } from "@/lib/garmin/auto-import";
import { refreshAfterImport } from "@/lib/garmin/plan-refresh";
import { NON_TRAINING_TYPES } from "@/lib/coach-engine/prevention";
import { syncRecentActivities } from "@/lib/garmin/activity-store";
import { sweepRecentGaps } from "@/lib/garmin/gap-sweep";
import { createDeadline, type Deadline } from "@/lib/garmin/timeout";
import { createNotificationIfNew } from "@/lib/notifications/create";
import { calibrateMealPlan } from "@/lib/nutrition/calibration";
import { recalibrateHrRest } from "@/lib/coach-engine/hr-calibration";
import { recalibrateVdot } from "@/lib/coach-engine/vdot-recalibration";

/** Sprint v1.8 #4: damp dynamic-deficit recompute to ~once per week. */
const RECALIBRATION_INTERVAL_MS = 7 * 86400000;

/**
 * Sprint 3.4 (#28): raw activities of the last 14 days are fetched each run,
 * and the auto-import links within the same window (was 7 days).
 */
const ACTIVITY_SYNC_DAYS = 14;
/** Open planned sessions this far back raise the /confirm notification. */
const MISSING_SESSION_LOOKBACK_DAYS = 7;

export const maxDuration = 60;
/** Wall-clock budget per invocation, below maxDuration. */
const RUN_BUDGET_MS = 50_000;
/** Below this much time left, a recalibration (which may regenerate) is skipped. */
const RECALIBRATION_RESERVE_MS = 15_000;
/** Below this much time left, the post-import refresh waits for the 19:00 cron. */
const PLAN_REFRESH_RESERVE_MS = 20_000;

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
  /** Activities left as raw data, by reason (e.g. under_15_min: 2). */
  rawOnly?: Record<string, number>;
  planRefresh?: string;
  /** Planned sessions of the last week with no recording. */
  missingSessions?: number;
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

      // 3. Session auto-import — three passes over the raw store (no Garmin
      // call), so it runs even when the wellness sync failed. Best-effort.
      const imp = await runAutoImport(user.id, today, yesterday, deadline, noteError);

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
          ...imp,
          errorDetails,
        });
        continue;
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
        ...imp,
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

/**
 * Sprint 3.4 (#28, B1/B2): link stored activities, refresh the plan when
 * something was imported, and nudge toward /confirm only for sessions that
 * have no recording at all — an auto-completed session needs nothing more.
 */
async function runAutoImport(
  userId: string,
  today: Date,
  yesterday: Date,
  deadline: Deadline,
  noteError: (step: string, message: string) => void,
): Promise<Pick<UserResult, "autoImported" | "rawOnly" | "planRefresh" | "missingSessions">> {
  const out: Pick<UserResult, "autoImported" | "rawOnly" | "planRefresh" | "missingSessions"> = {};
  try {
    const from = new Date(today.getTime() - ACTIVITY_SYNC_DAYS * 86400000);
    const imp = await autoImportFromStore(userId, { from, to: yesterday });
    for (const e of imp.errors) noteError("auto-import", e);
    if (imp.imported.length > 0) {
      out.autoImported = imp.imported.map((i) => `${i.date} ${i.type} (${i.match})`);
    }
    if (imp.rawOnly.length > 0) {
      out.rawOnly = {};
      for (const r of imp.rawOnly) out.rawOnly[r.reason] = (out.rawOnly[r.reason] ?? 0) + 1;
    }

    // B2: a new session can lift the cap and close a layoff gap — the plan and
    // the watch follow at once, through the same path as the 19:00 cron.
    if (imp.imported.length > 0) {
      if (deadline.isNear(PLAN_REFRESH_RESERVE_MS)) {
        out.planRefresh = "deferred: time budget (19:00 cron)";
      } else {
        try {
          const r = await refreshAfterImport(userId);
          out.planRefresh = `regenerated ${r.regenerated}, repushed ${r.repushed}`;
          for (const e of r.errors) noteError("plan-refresh", e);
        } catch (e) {
          noteError("plan-refresh", e instanceof Error ? e.message : String(e));
        }
      }
    }
  } catch (e) {
    noteError("auto-import", e instanceof Error ? e.message : String(e));
  }

  try {
    const missing = await db.workout.count({
      where: {
        userId,
        status: "planned",
        date: { gte: new Date(today.getTime() - MISSING_SESSION_LOOKBACK_DAYS * 86400000), lt: today },
        type: { notIn: ["rest", ...NON_TRAINING_TYPES] },
      },
    });
    if (missing > 0) {
      out.missingSessions = missing;
      await createNotificationIfNew(
        {
          userId,
          type: "SESSIONS_AWAITING_CONFIRMATION",
          title: `${missing} Einheit${missing === 1 ? "" : "en"} ohne Aufzeichnung`,
          message:
            "Ohne Uhr trainiert? In /confirm mit Minuten eintragen — sonst zählt die Einheit als verpasst.",
          severity: "INFO",
          actionUrl: "/confirm",
        },
        20 * 60, // once a day at most
      );
    }
  } catch (e) {
    noteError("missing-sessions", e instanceof Error ? e.message : String(e));
  }
  return out;
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
