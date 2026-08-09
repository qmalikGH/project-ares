// Full regeneration cascade: plans → Workout rows → Garmin.
//
// Composes the three steps in the only order that is correct, and is the
// helper handle-action.ts references by name after a Block reset (resetBlock
// writes `plannedSessions: []`, so one of these callers MUST run afterwards).
//
// The plan regeneration itself is NOT reimplemented here. It delegates to
// regeneratePlansFromNow, the canonical helper already used by
// /api/settings/therapy-phase, /api/coach/tm-confirm and the coach tools.
// /api/debug/regenerate-from-now used to carry its own forked copy of that
// loop, which had drifted and silently lost two shin-protection features:
//   - Sprint 2.2's greenForProgression gate (clamps the threshold ladder to
//     the 2x10 floor when shin NRS > 3 or resting HR is over baseline + 5)
//   - Sprint v1.9 #3's prevWeekData seeding from actual recent shin pain
// Routing every caller through the canonical helper removes that fork.
import { db } from "@/lib/db/client";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";
import { resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";

export interface RegenerateSummary {
  /** WeeklyPlan rows that were considered — 0 means nothing to regenerate. */
  candidates: number;
  regenerated: number;
  materialized: { created: number; updated: number; deleted: number };
  garminResync: {
    considered: number;
    removed: number;
    repushed: number;
    errors: string[];
  };
}

/**
 * Regenerate every unfinished WeeklyPlan of the active macrocycle, materialize
 * the resulting Workout rows, then re-sync Garmin.
 *
 * Order matters: materializeWorkouts must run BEFORE the Garmin re-sync, or
 * the freshly planned sessions have no Workout rows yet and the push skips
 * them. regeneratePlansFromNow is therefore called with its own Garmin step
 * disabled and the re-sync is issued here instead.
 *
 * @param userId — the athlete
 * @param today  — window start for materialization and the Garmin re-sync
 * @param opts.skipGarmin — leave the watch untouched
 */
export async function regenerateFuturePlans(
  userId: string,
  today: Date,
  opts: { skipGarmin?: boolean } = {},
): Promise<RegenerateSummary> {
  const candidates = await db.weeklyPlan.count({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      endDate: { gt: today },
    },
  });

  const { regenerated } = await regeneratePlansFromNow(userId, {
    runGarminResync: false,
  });

  const materialized = await materializeWorkouts(userId, today);

  // resyncFutureWorkoutsToGarmin returns all-zero when the user has
  // garminWorkoutPushEnabled=false, so no extra guard is needed here.
  const garminResync = opts.skipGarmin
    ? { considered: 0, removed: 0, repushed: 0, errors: [] }
    : await resyncFutureWorkoutsToGarmin(userId, today);

  return { candidates, regenerated, materialized, garminResync };
}
