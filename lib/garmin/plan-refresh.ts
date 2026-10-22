// Sprint 3.3 (B1) — keep the next two weeks current before the evening push.
//
// The single-session cap reacts to what was actually run, so the plan for the
// coming days can change every evening. The 19:00 cron used to push only
// tomorrow, from Workout rows nobody had regenerated — and every workout pushed
// on an earlier evening stayed on the watch in its old shape. Coach decision
// (#21): the watch and the plan must not drift apart. So, per user:
//
//   1. snapshot what is on the watch for tomorrow … end of next week
//   2. regenerate this week + next (regeneratePlansFromNow, horizonWeeks 2)
//   3. materialize those days; orphans are taken off the watch first
//   4. re-push every previously pushed workout whose plannedSession changed —
//      a diff, not everything every evening
//
// Tomorrow is left to the cron's own loop, which pushes it as before.
//
// THE PUSH WINDOW
// Nothing beyond the end of next week is kept on the watch. The projection
// re-plans every later week whenever a run went differently than projected, so
// anything pushed further ahead would drift from the plan by the next evening.
// resyncFutureWorkoutsToGarmin honours the same window (`pushWindowEnd`).
import { db } from "@/lib/db/client";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import { pushWindowEnd, pushWorkoutToGarmin, removeWorkoutFromGarmin } from "@/lib/garmin/workout-sync";
import type { VdotPaceLookup } from "@/lib/garmin/workout-builder";
import type { SessionPlan } from "@/lib/coach-engine/types";

const DAY_MS = 86400000;

export interface PlanRefreshDeps {
  regenerate: typeof regeneratePlansFromNow;
  materialize: typeof materializeWorkouts;
  push: typeof pushWorkoutToGarmin;
  remove: typeof removeWorkoutFromGarmin;
}

const DEFAULT_DEPS: PlanRefreshDeps = {
  regenerate: regeneratePlansFromNow,
  materialize: materializeWorkouts,
  push: pushWorkoutToGarmin,
  remove: removeWorkoutFromGarmin,
};

export interface PlanRefreshResult {
  regenerated: number;
  materialized: { created: number; updated: number; deleted: number };
  /** Previously pushed workouts that changed and were replaced on the watch. */
  repushed: number;
  errors: string[];
}

/** Stable comparison key for a stored plannedSession. */
function fingerprint(planned: unknown): string {
  return JSON.stringify(planned ?? null);
}

export async function refreshUpcomingPlan(
  userId: string,
  tomorrowKey: Date,
  paces: VdotPaceLookup,
  deps: PlanRefreshDeps = DEFAULT_DEPS,
): Promise<PlanRefreshResult> {
  // Tomorrow … Sunday of next week.
  const windowEnd = pushWindowEnd(new Date(tomorrowKey.getTime() - DAY_MS));
  const dayAfterTomorrow = new Date(tomorrowKey.getTime() + DAY_MS);

  const before = await db.workout.findMany({
    where: {
      userId,
      status: "planned",
      date: { gte: tomorrowKey, lt: windowEnd },
      garminWorkoutId: { not: null },
    },
    select: { id: true, plannedSession: true },
  });
  const pushedBefore = new Map(before.map((w) => [w.id, fingerprint(w.plannedSession)]));

  const regen = await deps.regenerate(userId, { horizonWeeks: 2 });
  const materialized = await deps.materialize(userId, tomorrowKey, windowEnd, {
    removeFromGarmin: deps.remove,
  });

  const after = await db.workout.findMany({
    where: { userId, status: "planned", date: { gte: dayAfterTomorrow, lt: windowEnd } },
    select: { id: true, date: true, plannedSession: true },
  });

  let repushed = 0;
  const errors: string[] = [];
  for (const w of after) {
    const old = pushedBefore.get(w.id);
    if (old === undefined || old === fingerprint(w.plannedSession)) continue;
    const r = await deps.push(w.id, w.plannedSession as unknown as SessionPlan, paces, w.date);
    if (r.pushed) repushed++;
    else if (r.error) errors.push(`${w.id}: ${r.error}`);
  }

  return { regenerated: regen.regenerated, materialized, repushed, errors };
}
