// GET /api/cron/garmin-sync-daily
// Vercel Cron: 0 5 * * * (daily at 05:00 UTC).
// Pulls Garmin data for the prior day for every active user.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { userTodayForUser } from "@/lib/date";
import { syncGarminForDate } from "@/lib/garmin/sync";
import { persistGarminSync, writeGarminSyncFailureLog } from "@/lib/garmin/persist";
import { calibrateMealPlan } from "@/lib/nutrition/calibration";
import { recalibrateHrRest } from "@/lib/coach-engine/hr-calibration";
import { recalibrateVdot } from "@/lib/coach-engine/vdot-recalibration";

/** Sprint v1.8 #4: damp dynamic-deficit recompute to ~once per week. */
const RECALIBRATION_INTERVAL_MS = 7 * 86400000;

/** Sprint 2.8: how far back the gap sweep looks for days worth re-syncing. */
const GAP_SWEEP_DAYS = 3;

// Sync + up to three recalibrations, one of which regenerates AND materializes.
// The route never declared a duration.
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return process.env.CRON_SECRET ? auth === expected : false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For v0.1 single-user mode this is just Q. Once multi-user lands, iterate.
  const users = await db.user.findMany({
    where: { goals: { some: { status: "active" } } },
    select: { id: true },
  });

  const results: Array<{
    userId: string;
    status: string;
    errors: number;
    syncedFor?: string;
    wrote?: boolean;
    skippedReason?: string;
    preserved?: string[];
    gapsRepaired?: string[];
    recalibrated?: string;
    hrRecalibrated?: string;
    vdotRecalibrated?: string;
  }> = [];

  for (const user of users) {
    // Per-user "yesterday" — respects each user's persisted timezone.
    const today = await userTodayForUser(user.id);
    const yesterday = new Date(today.getTime() - 86400000);
    let loggedThisRun = false;
    try {
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

      // Sprint 2.8: a failed sync leaves nothing new to calibrate against, and
      // these three are the expensive part of the invocation.
      if (result.status === "FAILURE") {
        results.push({
          userId: user.id,
          status: result.status,
          errors: result.errors.length,
          syncedFor: yesterday.toISOString().slice(0, 10),
          wrote: outcome.wrote,
          skippedReason: outcome.skippedReason,
        });
        continue;
      }

      // Gap sweep: re-sync recent days that are still incomplete and whose last
      // attempt did not succeed. This is what would have healed 2026-08-12 on its
      // own instead of needing a person to notice.
      const gapsRepaired = await sweepRecentGaps(user.id, yesterday);

      // Sprint v1.8 #4 — Dynamic deficit: weekly damped re-calibration. Recompute
      // rolling Garmin-TDEE targets only if ≥7 days since last calibration, so
      // targets track measured TDEE without day-to-day jitter. calibrateMealPlan
      // routes through the unified cascade (all 4 deficit stores stay consistent).
      let recalibrated: string | undefined;
      try {
        const plan = await db.mealPlan.findFirst({
          where: { userId: user.id, status: "active" },
          select: { calibratedAt: true },
        });
        const lastCal = plan?.calibratedAt?.getTime() ?? 0;
        if (Date.now() - lastCal >= RECALIBRATION_INTERVAL_MS) {
          const cal = await calibrateMealPlan(user.id);
          recalibrated = cal.status;
        }
      } catch (calErr) {
        recalibrated = `error: ${calErr instanceof Error ? calErr.message : String(calErr)}`;
      }

      // Sprint v1.9 #4 — HRrest recalibration: weekly damped, from the rolling
      // 28d Garmin RHR median. Karvonen zones recompute downstream. Skips manual
      // overrides; HRmax untouched (→ Sprint 2.0).
      let hrRecalibrated: string | undefined;
      try {
        const us = await db.userSettings.findUnique({
          where: { userId: user.id },
          select: { hrZonesUpdatedAt: true },
        });
        const lastHr = us?.hrZonesUpdatedAt?.getTime() ?? 0;
        if (Date.now() - lastHr >= RECALIBRATION_INTERVAL_MS) {
          const hr = await recalibrateHrRest(user.id);
          hrRecalibrated = hr.status === "updated" ? `updated:${hr.hrRest}` : hr.status;
        }
      } catch (hrErr) {
        hrRecalibrated = `error: ${hrErr instanceof Error ? hrErr.message : String(hrErr)}`;
      }

      // Sprint 2.6 (A6) — VDOT recalibration: same weekly damping, same shape.
      // Asymmetric by construction (see vdot-autocalibration.ts): it may lower
      // freely but only raises on a trustworthy measurement, outside the comeback
      // ramp, with the shin gate green. Applying also regenerates + materializes,
      // because paces are baked into sessions rather than derived on read.
      let vdotRecalibrated: string | undefined;
      try {
        const vs = await db.userSettings.findUnique({
          where: { userId: user.id },
          select: { vdotOverrideAt: true },
        });
        const lastVdot = vs?.vdotOverrideAt?.getTime() ?? 0;
        if (Date.now() - lastVdot >= RECALIBRATION_INTERVAL_MS) {
          const v = await recalibrateVdot(user.id);
          vdotRecalibrated =
            v.status === "applied" ? `applied:${v.decision?.newVdot}` : v.status;
        }
      } catch (vdotErr) {
        vdotRecalibrated = `error: ${vdotErr instanceof Error ? vdotErr.message : String(vdotErr)}`;
      }

      results.push({
        userId: user.id,
        status: result.status,
        errors: result.errors.length,
        syncedFor: yesterday.toISOString().slice(0, 10),
        wrote: outcome.wrote,
        preserved: outcome.preserved.length > 0 ? outcome.preserved : undefined,
        gapsRepaired: gapsRepaired.length > 0 ? gapsRepaired : undefined,
        recalibrated,
        hrRecalibrated,
        vdotRecalibrated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Only log here if persist didn't already — otherwise a throw after a
      // successful persist wrote TWO failure rows for one run and inflated the
      // consecutive-failure count that drives alerting.
      if (!loggedThisRun) {
        await writeGarminSyncFailureLog(user.id, message);
      }
      results.push({ userId: user.id, status: "FAILURE", errors: 1 });
    }
  }

  // Sprint 2.8: the route used to answer 200 unconditionally, so a total outage
  // looked green in Vercel's cron dashboard for two months. Vercel does not
  // retry a failed invocation — this is purely about being visible. A PARTIAL
  // stays 200: a night without the watch is not an incident.
  const allFailed = results.length > 0 && results.every((r) => r.status === "FAILURE");
  return NextResponse.json(
    { ranAt: new Date().toISOString(), results },
    { status: allFailed ? 500 : 200 },
  );
}

/**
 * Re-sync recent days that look incomplete and whose last attempt did not
 * succeed. Bounded to GAP_SWEEP_DAYS and only reached after a successful primary
 * sync, so a broken Garmin connection cannot turn this into a retry storm.
 */
async function sweepRecentGaps(userId: string, primaryDate: Date): Promise<string[]> {
  const repaired: string[] = [];
  const lastLog = await db.garminSyncLog.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (!lastLog || lastLog.status === "FAILURE") return repaired;

  for (let i = 1; i <= GAP_SWEEP_DAYS; i++) {
    const day = new Date(primaryDate.getTime() - i * 86400000);
    const row = await db.dailySensorData.findFirst({
      where: { userId, date: day },
      select: { garmin: true, totalKilocalories: true },
    });
    const g = (row?.garmin ?? null) as { rhr?: number | null; sleepScore?: number | null } | null;
    const incomplete = !row || g?.rhr == null || g?.sleepScore == null || row.totalKilocalories == null;
    if (!incomplete) continue;

    try {
      const res = await syncGarminForDate(day);
      if (res.status === "FAILURE") break; // connection went bad — stop sweeping
      const out = await persistGarminSync({ userId, date: day, result: res });
      if (out.wrote) repaired.push(day.toISOString().slice(0, 10));
    } catch {
      break;
    }
  }
  return repaired;
}
