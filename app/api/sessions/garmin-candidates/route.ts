// GET /api/sessions/garmin-candidates?workoutId=xxx
// Returns Garmin activity match candidates for the given workout's planned date.
// Triggered when the user clicks "Session abschließen" for a run.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { listActivitiesForDate } from "@/lib/garmin/activities";
import { matchSessionToActivity } from "@/lib/garmin/match";
import type { SessionPlan } from "@/lib/coach-engine/types";

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const workoutId = url.searchParams.get("workoutId");
  if (!workoutId) {
    return NextResponse.json({ error: "workoutId required" }, { status: 400 });
  }

  const workout = await db.workout.findFirst({ where: { id: workoutId, userId } });
  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  const planned = workout.plannedSession as unknown as SessionPlan;

  try {
    const candidates = await listActivitiesForDate(workout.date);
    const match = matchSessionToActivity(planned.type, candidates);
    return NextResponse.json({
      status: "ok",
      match,
      plannedType: planned.type,
      workoutDate: workout.date.toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        status: "GARMIN_ERROR",
        error: message,
        hint: "Garmin sync may have failed. Try manual completion.",
      },
      { status: 502 },
    );
  }
}
