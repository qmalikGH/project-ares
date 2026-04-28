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
import { dayKey } from "@/lib/db/queries/sensors";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import { pushWorkoutToGarmin } from "@/lib/garmin/workout-sync";
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

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dayKey(tomorrow);
  const dayAfter = new Date(tomorrowKey.getTime() + 86400000);

  const usersWithPush = await db.userSettings.findMany({
    where: { garminWorkoutPushEnabled: true },
    select: {
      userId: true,
      vdotOverride: true,
    },
  });

  const results: Array<{
    userId: string;
    workoutId?: string;
    type?: string;
    status: string;
    error?: string;
  }> = [];

  for (const settings of usersWithPush) {
    try {
      // Each user can have multiple sessions per day (run AM + strength PM).
      // Push every PLANNED run-style session — buildGarminWorkout filters
      // strength/rest/etc to null automatically.
      const tomorrowWorkouts = await db.workout.findMany({
        where: {
          userId: settings.userId,
          date: { gte: tomorrowKey, lt: dayAfter },
          status: "planned",
        },
      });

      if (tomorrowWorkouts.length === 0) {
        results.push({ userId: settings.userId, status: "no_workout_tomorrow" });
        continue;
      }

      const effectiveVdot = settings.vdotOverride ?? 40;
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
    targetDate: tomorrowKey.toISOString().slice(0, 10),
    usersConsidered: usersWithPush.length,
    results,
  });
}
