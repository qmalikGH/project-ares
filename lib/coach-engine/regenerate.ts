// Plan regeneration — fills WeeklyPlan.plannedSessions from the periodization
// engine, materializes Workout rows and re-syncs Garmin.
//
// Extracted from POST /api/debug/regenerate-from-now so the same code path
// serves both the HTTP route and offline scripts (scripts/reset-to-block.ts).
// resetBlock creates WeeklyPlan rows with `plannedSessions: []`, so one of
// these callers MUST run afterwards or the athlete is left with empty weeks.
import { db } from "@/lib/db/client";
import { generateWeekRunPlan } from "@/lib/coach-engine/run-coach";
import { generateWeekStrengthPlan } from "@/lib/coach-engine/strength-coach";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import type {
  PhaseConfig,
  SessionPlan,
  WeekStrengthData,
  WeekStrengthPlan,
} from "@/lib/coach-engine/types";

export interface RegenerateSummary {
  regenerated: number;
  materialized: { created: number; updated: number; deleted: number };
  // ISO weekday numbers straight from UserSettings, or "default" when unset.
  constraints: {
    forcedRestDaysIso: number[] | "default";
    preferredLongRunDayIso: number | "default";
  };
  before: { weekNumber: number; startDate: string; sessionCount: number }[];
  garminResync: {
    considered: number;
    removed: number;
    repushed: number;
    errors: string[];
  };
}

/**
 * Regenerate every WeeklyPlan of the user's active macrocycle that has not
 * finished yet, then materialize Workout rows and re-sync Garmin.
 *
 * @param userId  — the athlete
 * @param today   — "now" boundary; rows with endDate > today are regenerated,
 *                  which deliberately includes the week currently in progress.
 * @param opts.skipGarmin — skip the Garmin re-sync (offline / dry contexts).
 */
export async function regenerateFuturePlans(
  userId: string,
  today: Date,
  opts: { skipGarmin?: boolean } = {},
): Promise<RegenerateSummary> {
  // endDate > today (not startDate >= today) so the current week is included.
  const plansToRegen = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      endDate: { gt: today },
    },
    include: { phase: true },
    orderBy: { startDate: "asc" },
  });

  const userSettings = await db.userSettings.findUnique({ where: { userId } });
  const effectiveVdot = await getEffectiveVdot(userId);
  const hrCtx =
    userSettings?.hrMax && userSettings?.hrRest
      ? { hrMax: userSettings.hrMax, hrRest: userSettings.hrRest }
      : undefined;
  const userMaxEstimates =
    (userSettings?.exerciseMaxEstimates as Record<string, number> | null) ?? null;

  const constraints = constraintsFromUserSettings({
    forcedRestDaysIso: userSettings?.forcedRestDays ?? null,
    preferredLongRunDayIso: userSettings?.preferredLongRunDay ?? null,
  });

  const before = plansToRegen.map((p) => ({
    weekNumber: p.weekNumber,
    startDate: p.startDate.toISOString().slice(0, 10),
    sessionCount: Array.isArray(p.plannedSessions)
      ? (p.plannedSessions as unknown[]).length
      : 0,
  }));

  let regenerated = 0;
  let prevWeekData: WeekStrengthData | null = null;

  for (const plan of plansToRegen) {
    const phaseConfig = plan.phase.config as unknown as PhaseConfig;
    if (!phaseConfig) continue;

    const loadOverrideWeek =
      ((plan as { loadOverrideWeek?: number | null }).loadOverrideWeek as
        | 1 | 2 | 3 | 4
        | null
        | undefined) ?? null;

    const runPlan = generateWeekRunPlan(
      phaseConfig,
      plan.weekNumber,
      effectiveVdot,
      plan.startDate,
      hrCtx,
      // Sprint v1.5 follow-up: skip the W1 calibration run when this row was
      // created via Block-Reset (athlete has known VDOT).
      loadOverrideWeek,
    );
    const strengthPlan: WeekStrengthPlan = generateWeekStrengthPlan(
      phaseConfig,
      plan.weekNumber,
      plan.startDate,
      prevWeekData,
      // Sprint v0.12: respect manual therapy-phase override.
      (userSettings?.therapyPhaseOverride as
        | "REACTIVE"
        | "DISREPAIR"
        | "REMODELING"
        | "SPORT_SPECIFIC"
        | null) ?? null,
      userMaxEstimates,
      // Sprint v1.5: W1 volume + W2 loads on a Block-Reset ramp-up.
      loadOverrideWeek,
    );

    const mergedSessions: SessionPlan[] = planWeekSchedule(
      runPlan.sessions,
      strengthPlan.sessions,
      plan.startDate,
      constraints,
    );

    await db.weeklyPlan.update({
      where: { id: plan.id },
      data: { plannedSessions: mergedSessions as unknown as object },
    });
    regenerated += 1;

    prevWeekData = {
      weekNumber: plan.weekNumber,
      sessions: strengthPlan.sessions
        .filter((s) => ["strength_a", "strength_b", "strength_c"].includes(s.type))
        .map((s) => ({ type: s.type }) as WeekStrengthData["sessions"][number]),
    };
  }

  // Sprint v1.6: Workout rows must exist before the Garmin push runs.
  const materialized = await materializeWorkouts(userId, today);

  const garminResync =
    !opts.skipGarmin && userSettings?.garminWorkoutPushEnabled
      ? await resyncFutureWorkoutsToGarmin(userId, today)
      : { considered: 0, removed: 0, repushed: 0, errors: [] };

  return {
    regenerated,
    materialized,
    constraints: {
      forcedRestDaysIso: userSettings?.forcedRestDays ?? "default",
      preferredLongRunDayIso: userSettings?.preferredLongRunDay ?? "default",
    },
    before,
    garminResync,
  };
}
