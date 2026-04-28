// POST /api/garmin/sync-week
//
// Manual backfill: pushes every PLANNED run-style workout for the next 7 days
// to Garmin. Used by the Settings "Diese Woche jetzt syncen" button when the
// user enables push mid-week (vorabend cron only catches tomorrow).
//
// Best-effort per workout: returns a summary { synced, failed, skipped, errors[] }.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import { pushWorkoutToGarmin } from "@/lib/garmin/workout-sync";
import {
  getOrCreateUserSettings,
  getEffectiveVdot,
} from "@/lib/db/queries/settings";
import type { SessionPlan } from "@/lib/coach-engine/types";

export async function POST() {
  const userId = await getCurrentUserId();
  const settings = await getOrCreateUserSettings(userId);

  if (!settings.garminWorkoutPushEnabled) {
    return NextResponse.json(
      { status: "DISABLED", message: "Garmin Workout Push is not enabled in settings." },
      { status: 400 },
    );
  }

  const today0 = dayKey(new Date());
  const sevenDaysOut = new Date(today0.getTime() + 7 * 86400000);

  const plannedWorkouts = await db.workout.findMany({
    where: {
      userId,
      date: { gte: today0, lt: sevenDaysOut },
      status: "planned",
    },
    orderBy: { date: "asc" },
  });

  if (plannedWorkouts.length === 0) {
    return NextResponse.json({
      status: "ok",
      synced: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    });
  }

  const effectiveVdot = await getEffectiveVdot(userId);
  let paces;
  try {
    paces = vdotToPaces(effectiveVdot);
  } catch (e) {
    return NextResponse.json(
      {
        status: "error",
        error: `VDOT ${effectiveVdot} out of supported pace range`,
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ workoutId: string; type: string; error: string }> = [];

  for (const w of plannedWorkouts) {
    const session = w.plannedSession as unknown as SessionPlan;
    const result = await pushWorkoutToGarmin(w.id, session, paces, w.date);
    if (result.pushed) {
      synced += 1;
    } else if (result.skipReason) {
      skipped += 1;
    } else {
      failed += 1;
      errors.push({
        workoutId: w.id,
        type: w.type,
        error: result.error ?? "unknown",
      });
    }
  }

  return NextResponse.json({
    status: "ok",
    synced,
    failed,
    skipped,
    errors,
  });
}
