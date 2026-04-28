// GET /api/garmin/pushable-workouts
//
// Returns the list of PLANNED workouts in the next 7 days, with a flag for
// each indicating whether it's pushable (run-style + has hrTarget) or skipped
// (strength / rest / time-trial / no HR).
//
// UI uses this to render a checklist before the actual push, so each push
// step can show real progress (1/7, 2/7, …) instead of one big "Syncing…" toast.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { isPushableSessionType } from "@/lib/garmin/workout-builder";
import type { SessionPlan } from "@/lib/coach-engine/types";

export async function GET() {
  const userId = await getCurrentUserId();
  const today0 = dayKey(new Date());
  const sevenDaysOut = new Date(today0.getTime() + 7 * 86400000);

  const planned = await db.workout.findMany({
    where: {
      userId,
      date: { gte: today0, lt: sevenDaysOut },
      status: "planned",
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      type: true,
      date: true,
      plannedSession: true,
      garminPushStatus: true,
      garminWorkoutId: true,
    },
  });

  const items = planned.map((w) => {
    const session = w.plannedSession as unknown as SessionPlan | null;
    const hasHr = !!session?.hrTarget;
    const pushable = isPushableSessionType(w.type) && hasHr;
    return {
      id: w.id,
      type: w.type,
      date: w.date.toISOString().slice(0, 10),
      durationMin: session?.durationMin ?? null,
      pushable,
      reasonNotPushable: !isPushableSessionType(w.type)
        ? ("non_pushable_session" as const)
        : !hasHr
          ? ("missing_hr_target" as const)
          : null,
      currentStatus: w.garminPushStatus, // "synced" | "failed" | "removed" | null
      garminWorkoutId: w.garminWorkoutId,
    };
  });

  return NextResponse.json({
    status: "ok",
    items,
    pushable: items.filter((i) => i.pushable).length,
    skipped: items.filter((i) => !i.pushable).length,
  });
}
