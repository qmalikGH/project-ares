// POST /api/garmin/push-workout
// Body: { workoutId: string }
//
// Pushes a single Workout DB row to Garmin Connect. Idempotent
// (workout-sync.ts replaces a prior push). Used by the UI to drive a
// per-item progress UI ("1/7 Easy Run pushed ✓").
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import { getEffectiveVdot, getOrCreateUserSettings } from "@/lib/db/queries/settings";
import { pushWorkoutToGarmin } from "@/lib/garmin/workout-sync";
import type { SessionPlan } from "@/lib/coach-engine/types";

const Schema = z.object({ workoutId: z.string().min(1) });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  const settings = await getOrCreateUserSettings(userId);
  if (!settings.garminWorkoutPushEnabled) {
    return NextResponse.json(
      { status: "DISABLED", error: "Garmin Workout Push not enabled" },
      { status: 400 },
    );
  }

  const w = await db.workout.findFirst({
    where: { id: parsed.data.workoutId, userId },
  });
  if (!w) {
    return NextResponse.json(
      { status: "NOT_FOUND", error: "Workout not found" },
      { status: 404 },
    );
  }

  const effectiveVdot = await getEffectiveVdot(userId);
  let paces;
  try {
    paces = vdotToPaces(effectiveVdot);
  } catch (e) {
    return NextResponse.json(
      {
        status: "VDOT_ERROR",
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const session = w.plannedSession as unknown as SessionPlan;
  const result = await pushWorkoutToGarmin(w.id, session, paces, w.date);

  return NextResponse.json({
    status: "ok",
    workoutId: w.id,
    type: w.type,
    date: w.date.toISOString().slice(0, 10),
    ...result,
  });
}
