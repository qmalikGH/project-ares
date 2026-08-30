// GET /api/cron/garmin-workout-push
// Vercel Cron: 0 19 * * * (daily 19:00 UTC = 21:00 Berlin in summer / 20:00 winter).
//
// For every user with garminWorkoutPushEnabled=true: find tomorrow's PLANNED
// run-workout, push it to Garmin Connect (creates + schedules), and persist
// the resulting IDs on the Workout row. Best-effort: per-user failures are
// captured into garminPushStatus / garminPushError without crashing the cron.
//
// Pushed at vorabend so the FR165 has 12+ hours to bluetooth-sync via Garmin
// Connect Mobile (the iPhone needs to be near the watch — sync latency is
// 15-60min in practice).
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { userTomorrowForUser } from "@/lib/date";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import { pushWorkoutToGarmin } from "@/lib/garmin/workout-sync";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";
import type { SessionPlan } from "@/lib/coach-engine/types";

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return process.env.CRON_SECRET ? auth === expected : false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const usersWithPush = await db.userSettings.findMany({
    where: { garminWorkoutPushEnabled: true },
    select: {
      userId: true,
    },
  });

  const results: Array<{
    userId: string;
    workoutId?: string;
    type?: string;
    status: string;
    error?: string;
    targetDate?: string;
  }> = [];

  for (const settings of usersWithPush) {
    try {
      // Per-user tomorrow: respects UserSettings.timezone (populated from
      // the userTz cookie by TimezoneCookieSetter). Crons have no request
      // context, so reading the persisted zone is the only travel-aware path.
      const tomorrowKey = await userTomorrowForUser(settings.userId);
      const dayAfter = new Date(tomorrowKey.getTime() + 86400000);

      // Each user can have multiple sessions per day (run AM + strength PM).
      // Push every PLANNED session — buildGarminWorkout returns null for the
      // ones that do not belong on a watch (rest, mobility, the 5k time trial).
      // Sprint 3.1: strength IS pushed now, as a plain timed block, so the
      // activity comes back carrying our workout id.
      let tomorrowWorkouts = await db.workout.findMany({
        where: {
          userId: settings.userId,
          date: { gte: tomorrowKey, lt: dayAfter },
          status: "planned",
        },
      });

      // Sprint v1.6: fallback — materialize Workout rows if none found.
      // This handles the case where regenerate-from-now updated the
      // WeeklyPlan JSON but no Workout rows were created yet.
      if (tomorrowWorkouts.length === 0) {
        await materializeWorkouts(settings.userId, tomorrowKey, dayAfter);
        tomorrowWorkouts = await db.workout.findMany({
          where: {
            userId: settings.userId,
            date: { gte: tomorrowKey, lt: dayAfter },
            status: "planned",
          },
        });
      }

      if (tomorrowWorkouts.length === 0) {
        results.push({
          userId: settings.userId,
          status: "no_workout_tomorrow",
          targetDate: tomorrowKey.toISOString().slice(0, 10),
        });
        continue;
      }

      // Sprint 2.6 (A6): was `settings.vdotOverride ?? 40` — a second, private
      // resolution of the same number with a different default (40) than the
      // engine's (35 since A6, 42 before). The watch could be handed paces the
      // app never showed. One resolver for one number.
      const effectiveVdot = await getEffectiveVdot(settings.userId);
      let paces;
      try {
        paces = vdotToPaces(effectiveVdot);
      } catch (e) {
        results.push({
          userId: settings.userId,
          status: "vdot_error",
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      for (const w of tomorrowWorkouts) {
        const session = w.plannedSession as unknown as SessionPlan;
        const result = await pushWorkoutToGarmin(
          w.id,
          session,
          paces,
          w.date,
        );
        results.push({
          userId: settings.userId,
          workoutId: w.id,
          type: w.type,
          status: result.pushed
            ? "synced"
            : result.skipReason ?? "failed",
          error: result.error,
          targetDate: tomorrowKey.toISOString().slice(0, 10),
        });
      }
    } catch (e) {
      results.push({
        userId: settings.userId,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ts: new Date().toISOString(),
    usersConsidered: usersWithPush.length,
    results,
  });
}
