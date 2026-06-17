// Sprint v0.12: shared plan-regeneration helper. Both
// /api/settings/exercise-max, /api/settings/therapy-phase, the coach tools
// (`setTherapyPhase`, `adjustRunVolume`, `substituteExercise`), and the
// existing /api/debug/regenerate-from-now drive the same loop:
//
//   1. find every WeeklyPlan in the active macrocycle whose endDate is in
//      the future (the current week + everything after);
//   2. re-run generateWeekRunPlan + generateWeekStrengthPlan + planWeekSchedule
//      with the latest user state (1RM map, therapy phase override, etc.)
//      and persist the merged sessions back to plannedSessions.
//
// Garmin re-sync is OPTIONAL — callers decide. 1RM-only changes don't move
// run workouts, but therapy-phase changes can swap Wall Sit in/out and
// volume changes shorten/lengthen long runs. Pass `runGarminResync = true`
// when the change touches anything pushed to the watch.
import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";
import { generateWeekRunPlan } from "@/lib/coach-engine/run-coach";
import {
  generateWeekStrengthPlan,
} from "@/lib/coach-engine/strength-coach";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import { resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";
import { ExecutedSessionSchema } from "@/lib/coach-engine/types";
import type {
  PhaseConfig,
  SessionPlan,
  TherapyPhase,
  WeekStrengthData,
  WeekStrengthPlan,
} from "@/lib/coach-engine/types";

/**
 * Sprint v1.9 #3: seed prevWeekData from ACTUAL recent completed sessions so the
 * shin-pain HSR override finally fires (it was previously rebuilt from PLANNED
 * sessions → always undefined). Shin splints flare after RUNS, so we take the
 * WORST recent shin-NRS across ALL completed sessions (run + strength) and apply
 * it to every strength session type; per-type RPE comes from strength sessions.
 */
async function loadRecentShinSignal(userId: string, before: Date): Promise<WeekStrengthData | null> {
  const cutoff = new Date(before.getTime() - 10 * 86400000);
  const workouts = await db.workout.findMany({
    where: { userId, status: "completed", date: { gte: cutoff, lte: before } },
    orderBy: { date: "desc" },
    select: { type: true, executedSession: true, rpe: true },
  });
  let shin: number | undefined;
  const rpeByType = new Map<string, number>();
  for (const w of workouts) {
    const parsed = ExecutedSessionSchema.safeParse(w.executedSession);
    if (parsed.success) {
      const s = (parsed.data as { shinPainNrs?: number }).shinPainNrs;
      if (typeof s === "number") shin = shin === undefined ? s : Math.max(shin, s);
    }
    if (["strength_a", "strength_b", "strength_c"].includes(w.type) && !rpeByType.has(w.type) && w.rpe != null) {
      rpeByType.set(w.type, w.rpe);
    }
  }
  if (shin === undefined && rpeByType.size === 0) return null;
  const types = ["strength_a", "strength_b", "strength_c"] as const;
  return {
    weekNumber: 0,
    sessions: types.map((t) => ({ type: t, shinPainNrs: shin, rpeReported: rpeByType.get(t) })),
  };
}

export interface RegenerateOptions {
  runGarminResync?: boolean;
}

export interface RegenerateResult {
  regenerated: number;
  garminResync?: {
    considered: number;
    removed: number;
    repushed: number;
    errors: string[];
  };
}

const VALID_PHASES: ReadonlyArray<TherapyPhase> = [
  "REACTIVE",
  "DISREPAIR",
  "REMODELING",
  "SPORT_SPECIFIC",
];

function isTherapyPhase(value: unknown): value is TherapyPhase {
  return typeof value === "string" && (VALID_PHASES as readonly string[]).includes(value);
}

/**
 * Regenerate the current week + every future WeeklyPlan in the user's active
 * macrocycle. Pulls 1RM map and therapy-phase override from UserSettings so
 * any Settings update is picked up automatically.
 */
export async function regeneratePlansFromNow(
  userId: string,
  opts: RegenerateOptions = {},
): Promise<RegenerateResult> {
  const today0 = userToday();

  const plansToRegen = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      endDate: { gt: today0 },
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

  const constraints = constraintsFromUserSettings({
    forcedRestDaysIso: userSettings?.forcedRestDays ?? null,
    preferredLongRunDayIso: userSettings?.preferredLongRunDay ?? null,
  });

  const userMaxEstimates =
    (userSettings?.exerciseMaxEstimates as Record<string, number> | null) ??
    null;

  // Sprint v0.12: therapy-phase manual override — wins over the daily
  // limitations-derived value at plan-generation time.
  const therapyPhaseOverride: TherapyPhase | null = isTherapyPhase(
    userSettings?.therapyPhaseOverride,
  )
    ? (userSettings!.therapyPhaseOverride as TherapyPhase)
    : null;

  let regenerated = 0;
  // Sprint v1.9 #3: seed from actual recent shin pain so the next week's HSR
  // progression reacts to it (the dead-wiring fix).
  let prevWeekData: WeekStrengthData | null = await loadRecentShinSignal(userId, today0);

  // Sprint 2.3: graded run-volume pain governor from the worst recent shin-NRS
  // (composes the Sprint 2.2 threshold structure-floor gate — ONE signal):
  //   ≤2 → "progress" (full),
  //   3  → "hold" (threshold clamped to 2×10 floor, volume normal),
  //   ≥4 → "regress" (−20% run volume + quality session replaced by easy).
  // RHR secondary: a calm shin but elevated RHR (> hrRest+5) downgrades
  // progress → hold. Applied to the IMMINENT week ONLY (index 0); later weeks
  // re-gate on the next regeneration so a current flare doesn't flatten the
  // whole horizon. greenForProgression (structure floor) = (gate === progress).
  const recentShin = prevWeekData?.sessions?.[0]?.shinPainNrs ?? null;
  let shinVolumeGate: "progress" | "hold" | "regress" = "progress";
  if (recentShin != null) {
    if (recentShin >= 4) shinVolumeGate = "regress";
    else if (recentShin === 3) shinVolumeGate = "hold";
  }
  const rhrRows = await db.dailySensorData.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 5,
    select: { garmin: true },
  });
  let latestRhr: number | null = null;
  for (const r of rhrRows) {
    const v = (r.garmin as { rhr?: number } | null)?.rhr;
    if (typeof v === "number") { latestRhr = v; break; }
  }
  const baselineRhr = userSettings?.hrRest ?? null;
  const rhrOk = latestRhr == null || baselineRhr == null || latestRhr <= baselineRhr + 5;
  if (shinVolumeGate === "progress" && !rhrOk) shinVolumeGate = "hold";

  const imminentPlanId = plansToRegen[0]?.id;
  for (const plan of plansToRegen) {
    const phaseConfig = plan.phase.config as unknown as PhaseConfig;
    if (!phaseConfig) continue;

    // Modulate only the imminent (soonest) week; later weeks default to full.
    const weekGate: "progress" | "hold" | "regress" =
      plan.id === imminentPlanId ? shinVolumeGate : "progress";
    const weekGreen = weekGate === "progress";

    const runPlan = generateWeekRunPlan(
      phaseConfig,
      plan.weekNumber,
      effectiveVdot,
      plan.startDate,
      hrCtx,
      // Sprint v1.5 follow-up: skip the W1 calibration run when this row
      // was created via Block-Reset (athlete has known VDOT).
      (plan as { loadOverrideWeek?: number | null }).loadOverrideWeek as
        | 1 | 2 | 3 | 4 | null
        | undefined ?? null,
      weekGreen,
      weekGate,
    );
    const strengthPlan: WeekStrengthPlan = generateWeekStrengthPlan(
      phaseConfig,
      plan.weekNumber,
      plan.startDate,
      prevWeekData,
      therapyPhaseOverride,
      userMaxEstimates,
      // Sprint v1.5: respect loadOverrideWeek when row was created via
      // Block-Reset (W1 volume + W2 loads ramp-up scenario).
      (plan as { loadOverrideWeek?: number | null }).loadOverrideWeek as
        | 1 | 2 | 3 | 4 | null
        | undefined ?? null,
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
        .filter((s) =>
          ["strength_a", "strength_b", "strength_c"].includes(s.type),
        )
        .map(
          (s) =>
            ({
              type: s.type,
            }) as WeekStrengthData["sessions"][number],
        ),
    };
  }

  const result: RegenerateResult = { regenerated };

  if (opts.runGarminResync && userSettings?.garminWorkoutPushEnabled) {
    result.garminResync = await resyncFutureWorkoutsToGarmin(userId, today0);
  }

  return result;
}
