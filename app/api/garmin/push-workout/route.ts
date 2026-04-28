// POST /api/garmin/push-workout
// Body: { date: "YYYY-MM-DD", type: string }
//
// Pushes ONE planned session to Garmin Connect. Idempotent — relies on
// workout-sync.pushWorkoutToGarmin which deletes any prior push first.
//
// Materialises the Workout row on demand: planned sessions live as JSON in
// WeeklyPlan.plannedSessions, and a Workout row only exists once a session
// has been started/completed. To push, we need a row to attach the Garmin
// IDs to — so we upsert from the plannedSessions JSON.
//
// Used by the Settings UI to drive the per-workout progress UI ("1/N · Easy
// Run pushed ✓").
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import {
  getHrTargetForSession,
  vdotToPaces,
} from "@/lib/coach-engine/run-coach";
import {
  getEffectiveVdot,
  getOrCreateUserSettings,
} from "@/lib/db/queries/settings";
import { pushWorkoutToGarmin } from "@/lib/garmin/workout-sync";
import type { SessionPlan, SessionType } from "@/lib/coach-engine/types";

const Schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.string().min(1).max(50),
});

interface PlannedSessionRaw {
  date?: string | Date;
  type?: string;
}

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

  const targetDate = dayKey(new Date(parsed.data.date));
  const targetType = parsed.data.type;

  // 1. Find the planned session in the user's ACTIVE macrocycle's WeeklyPlan.
  // Filtering on macrocycle.status guards against duplicates from abandoned
  // older plans (re-onboarding aftermath).
  const weeklyPlans = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      AND: [
        { startDate: { lte: targetDate } },
        { endDate: { gt: targetDate } },
      ],
    },
    select: { plannedSessions: true },
  });

  let matchedSession: SessionPlan | null = null;
  for (const wp of weeklyPlans) {
    if (!Array.isArray(wp.plannedSessions)) continue;
    for (const raw of wp.plannedSessions as unknown as PlannedSessionRaw[]) {
      if (!raw || typeof raw !== "object" || raw.type !== targetType) continue;
      const sDate = raw.date instanceof Date ? raw.date : raw.date ? new Date(raw.date) : null;
      if (!sDate) continue;
      if (dayKey(sDate).getTime() === targetDate.getTime()) {
        matchedSession = { ...(raw as unknown as SessionPlan), date: sDate };
        break;
      }
    }
    if (matchedSession) break;
  }

  if (!matchedSession) {
    return NextResponse.json(
      {
        status: "NOT_FOUND",
        error: `No planned session matches ${targetType} on ${parsed.data.date}`,
      },
      { status: 404 },
    );
  }

  // 1b. HR-Target fallback for pre-v0.7 plans without hrTarget in the JSON.
  // Derive from UserSettings.hrMax/hrRest via Karvonen so the watch still
  // gets a HR-zone targeted workout instead of being skipped silently.
  if (
    !matchedSession.hrTarget &&
    typeof settings.hrMax === "number" &&
    typeof settings.hrRest === "number"
  ) {
    const derived = getHrTargetForSession({
      sessionType: matchedSession.type as SessionType,
      hrMax: settings.hrMax,
      hrRest: settings.hrRest,
    });
    if (derived) {
      matchedSession = {
        ...matchedSession,
        hrTarget: derived,
        controlMethod: "hr_first",
      };
    }
  }

  // 2. Find existing Workout row OR create one (so the Garmin IDs have a home).
  let workout = await db.workout.findFirst({
    where: { userId, date: targetDate, type: targetType },
    orderBy: { createdAt: "desc" },
  });
  if (!workout) {
    workout = await db.workout.create({
      data: {
        userId,
        date: targetDate,
        type: targetType,
        plannedSession: matchedSession as unknown as object,
        status: "planned",
      },
    });
  } else if (workout.status === "planned") {
    // Refresh plannedSession in case it changed since the row was created.
    workout = await db.workout.update({
      where: { id: workout.id },
      data: { plannedSession: matchedSession as unknown as object },
    });
  }

  // 3. Effective VDOT → paces → push.
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

  const result = await pushWorkoutToGarmin(
    workout.id,
    matchedSession,
    paces,
    targetDate,
  );

  return NextResponse.json({
    status: "ok",
    workoutId: workout.id,
    type: targetType,
    date: parsed.data.date,
    ...result,
  });
}
