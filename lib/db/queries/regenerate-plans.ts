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
import {
  generateWeekRunPlan,
  thresholdLadderIndexOf,
  timeTrialRun,
} from "@/lib/coach-engine/run-coach";
import {
  generateWeekStrengthPlan,
} from "@/lib/coach-engine/strength-coach";
import { weekInBlockOf } from "@/lib/coach-engine/strength-coach/periodization";
import {
  isTimeTrialWeek,
  nextThresholdIndex,
  runCapForWeek,
  RUN_CAP_WINDOW_DAYS,
  THRESHOLD_HISTORY_DAYS,
  type CompletedThreshold,
  type CountedRun,
} from "@/lib/coach-engine/run-progression";
import { isRunType } from "@/lib/db/queries/progress-helpers";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { comebackWeekFor, detectLayoff } from "@/lib/coach-engine/comeback";
import { deriveVolumeGate, type VolumeGate } from "@/lib/db/queries/regenerate-plans-helpers";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import { pushWindowEnd, resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";
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
async function loadRecentShinSignal(
  userId: string,
  before: Date,
): Promise<{ data: WeekStrengthData | null; completedInWindow: number; attestedInWindow: number }> {
  const cutoff = new Date(before.getTime() - 10 * 86400000);
  const workouts = await db.workout.findMany({
    where: { userId, status: "completed", date: { gte: cutoff, lte: before } },
    orderBy: { date: "desc" },
    select: { type: true, executedSession: true, rpe: true },
  });
  let shin: number | undefined;
  // Sprint 2.9: sessions the nightly Garmin import completed carry no shin
  // score, so "how many sessions exist" and "how many were rated" are now two
  // different numbers. Only the second one is evidence about the athlete.
  let attestedInWindow = 0;
  const rpeByType = new Map<string, number>();
  for (const w of workouts) {
    const parsed = ExecutedSessionSchema.safeParse(w.executedSession);
    if (parsed.success) {
      const s = (parsed.data as { shinPainNrs?: number }).shinPainNrs;
      if (typeof s === "number") {
        shin = shin === undefined ? s : Math.max(shin, s);
        attestedInWindow++;
      }
    }
    if (["strength_a", "strength_b", "strength_c"].includes(w.type) && !rpeByType.has(w.type) && w.rpe != null) {
      rpeByType.set(w.type, w.rpe);
    }
  }
  const completedInWindow = workouts.length;
  if (shin === undefined && rpeByType.size === 0) {
    return { data: null, completedInWindow, attestedInWindow };
  }
  const types = ["strength_a", "strength_b", "strength_c"] as const;
  return {
    data: {
      weekNumber: 0,
      sessions: types.map((t) => ({ type: t, shinPainNrs: shin, rpeReported: rpeByType.get(t) })),
    },
    completedInWindow,
    attestedInWindow,
  };
}

/**
 * Sprint 3.3 (B1/B2/B5): what the athlete has actually run, as the progression
 * rules read it. Only measured or typed-in minutes (Workout.durationActualMin);
 * a confirmation without a duration is no evidence (Sprint 3.2a).
 */
async function loadRunHistory(
  userId: string,
  firstWeekStart: Date,
  today0: Date,
): Promise<{ runs: CountedRun[]; thresholds: CompletedThreshold[]; lastTestDate: Date | null }> {
  const lookbackDays = Math.max(RUN_CAP_WINDOW_DAYS, THRESHOLD_HISTORY_DAYS);
  const rows = await db.workout.findMany({
    where: {
      userId,
      status: "completed",
      date: { gte: new Date(firstWeekStart.getTime() - lookbackDays * 86400000), lte: today0 },
    },
    select: { date: true, type: true, durationActualMin: true, plannedSession: true },
  });
  const runs: CountedRun[] = [];
  const thresholds: CompletedThreshold[] = [];
  for (const w of rows) {
    if (!isRunType(w.type) || w.durationActualMin == null) continue;
    runs.push({ date: w.date, minutes: w.durationActualMin });
    if (w.type === "threshold_run") {
      const index = thresholdLadderIndexOf((w.plannedSession as SessionPlan | null)?.structure);
      if (index != null) thresholds.push({ date: w.date, index });
    }
  }
  // A test counts once done, however long ago — it spaces the next one.
  const lastTest = await db.workout.findFirst({
    where: { userId, status: "completed", type: "time_trial_5k" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return { runs, thresholds, lastTestDate: lastTest?.date ?? null };
}

export interface RegenerateOptions {
  runGarminResync?: boolean;
  /**
   * Sprint 3.3: regenerate only this many weeks, starting with the current one.
   * The 19:00 push cron uses 2 (this week + next) so the cap reacts to what was
   * run without rewriting the whole horizon every evening.
   */
  horizonWeeks?: number;
}

/** Sprint 3.3: what the progression rules decided per regenerated week. */
export interface WeekProgression {
  weekStart: string;
  capMin: number;
  thresholdIndex: number;
  timeTrial: boolean;
}

export interface RegenerateResult {
  regenerated: number;
  /** Sprint 2.4 — what the run/strength brakes were set to, so the caller
   *  (script, route, test) can assert the plan was generated braked. */
  gate: VolumeGate;
  gateReason: string;
  layoff: { active: boolean; gapDays: number; restartWeekStart: Date | null };
  progression: WeekProgression[];
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
    ...(opts.horizonWeeks ? { take: opts.horizonWeeks } : {}),
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
  const shinSignal = await loadRecentShinSignal(userId, today0);
  let prevWeekData: WeekStrengthData | null = shinSignal.data;

  // Sprint 2.4 — Comeback ramp. Derived from the completed-session history, so
  // it activates and expires on its own; nothing to set or unset by hand.
  const completedHistory = await db.workout.findMany({
    where: {
      userId,
      status: "completed",
      date: { gte: new Date(today0.getTime() - 180 * 86400000), lte: today0 },
      NOT: { type: { in: ["rest", "active_recovery"] } },
    },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const layoff = detectLayoff(
    completedHistory.map((w) => w.date),
    today0,
    plansToRegen[0]?.startDate ?? null,
  );

  // Sprint 2.3: graded run-volume pain governor from the worst recent shin-NRS
  // (composes the Sprint 2.2 threshold structure-floor gate — ONE signal):
  //   ≤2 → "progress" (full),
  //   3  → "hold" (threshold clamped to 2×10 floor, volume normal),
  //   ≥4 → "regress" (−20% run volume + quality session replaced by easy).
  // RHR secondary: a calm shin but elevated RHR (> hrRest+5) downgrades
  // progress → hold. Applied to the IMMINENT week ONLY (index 0); later weeks
  // re-gate on the next regeneration so a current flare doesn't flatten the
  // whole horizon. greenForProgression (structure floor) = (gate === progress).
  // Sprint 2.4 — the RHR query used to be unbounded (`take: 5`, no date filter),
  // so a months-old row was read as "the latest RHR" and passed the gate.
  const rhrRows = await db.dailySensorData.findMany({
    where: { userId, date: { gte: new Date(today0.getTime() - 14 * 86400000) } },
    orderBy: { date: "desc" },
    take: 5,
    select: { garmin: true },
  });
  let latestRhr: number | null = null;
  for (const r of rhrRows) {
    const v = (r.garmin as { rhr?: number } | null)?.rhr;
    if (typeof v === "number") { latestRhr = v; break; }
  }

  // Sprint 2.4 — decision extracted to a pure helper so it is testable without
  // a DB. Crucially it no longer treats "no data" as green (see helper docs).
  const gateDecision = deriveVolumeGate({
    recentShin: prevWeekData?.sessions?.[0]?.shinPainNrs ?? null,
    completedInWindow: shinSignal.completedInWindow,
    attestedInWindow: shinSignal.attestedInWindow,
    latestRhr,
    baselineRhr: userSettings?.hrRest ?? null,
  });
  const shinVolumeGate = gateDecision.gate;

  // Sprint 3.3: progression from completed sessions. Each generated week is fed
  // back in (from today on) before the next one is planned — that is what turns
  // the cap into a +10 % staircase and moves the threshold one rung per week.
  const history = plansToRegen[0]
    ? await loadRunHistory(userId, plansToRegen[0].startDate, today0)
    : { runs: [], thresholds: [], lastTestDate: null };
  const testDurationMin =
    timeTrialRun(today0, effectiveVdot).durationMin ?? 0;
  const progression: WeekProgression[] = [];

  const imminentPlanId = plansToRegen[0]?.id;
  for (const plan of plansToRegen) {
    const phaseConfig = plan.phase.config as unknown as PhaseConfig;
    if (!phaseConfig) continue;

    const capMin = runCapForWeek(history.runs, plan.startDate);
    const weekProgression = {
      capMin,
      thresholdIndex: nextThresholdIndex(history.thresholds, plan.startDate),
      timeTrial: isTimeTrialWeek({
        testDate: new Date(plan.startDate.getTime() + 86400000),
        isDeloadWeek: weekInBlockOf(plan.weekNumber, phaseConfig.durationWeeks) === 4,
        lastTestDate: history.lastTestDate,
        capMin,
        testDurationMin,
      }),
    };

    // Modulate only the imminent (soonest) week; later weeks default to full.
    const weekGate: "progress" | "hold" | "regress" =
      plan.id === imminentPlanId ? shinVolumeGate : "progress";
    const weekGreen = weekGate === "progress";
    // Sprint 2.4: the ramp, unlike the pain gate, spans several weeks — a
    // return to training is a known multi-week state, not a reaction to one
    // flare, so it is applied to every plan week inside the ramp window.
    const weekComeback = layoff.active
      ? comebackWeekFor(plan.startDate, layoff.restartWeekStart)
      : null;

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
      weekComeback,
      weekProgression,
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
      weekComeback,
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

    // Projection: what is planned from today on counts as done for the weeks
    // after it. Past sessions nobody confirmed stay out — no data, no progress.
    let plannedTest = false;
    for (const s of mergedSessions) {
      const date = s.date instanceof Date ? s.date : new Date(s.date);
      if (date.getTime() < today0.getTime() || !isRunType(s.type) || !s.durationMin) continue;
      history.runs.push({ date, minutes: s.durationMin });
      if (s.type === "threshold_run") {
        const index = thresholdLadderIndexOf(s.structure);
        if (index != null) history.thresholds.push({ date, index });
      }
      if (s.type === "time_trial_5k" && s.structure?.workIntervals?.some((iv) => iv.distanceM)) {
        history.lastTestDate = date;
        plannedTest = true;
      }
    }
    progression.push({
      weekStart: plan.startDate.toISOString().slice(0, 10),
      capMin: weekProgression.capMin,
      thresholdIndex: weekProgression.thresholdIndex,
      // What actually got planned — the generator may still refuse the test
      // (ramp week, held gate).
      timeTrial: plannedTest,
    });

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

  const result: RegenerateResult = {
    regenerated,
    gate: shinVolumeGate,
    gateReason: gateDecision.reason,
    layoff: {
      active: layoff.active,
      gapDays: layoff.gapDays,
      restartWeekStart: layoff.restartWeekStart,
    },
    progression,
  };

  if (opts.runGarminResync && userSettings?.garminWorkoutPushEnabled) {
    // Sprint 3.3: the watch only carries this week + next.
    result.garminResync = await resyncFutureWorkoutsToGarmin(userId, today0, undefined, pushWindowEnd(today0));
  }

  return result;
}
