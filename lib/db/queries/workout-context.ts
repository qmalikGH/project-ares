// WorkoutContext loader — single source of truth for AI-Coach workout knowledge.
// One DB-aware aggregator that all coach endpoints (free-chat, daily-explanation,
// block-review) call into. The formatter at lib/ai-coach/prompts/workout-context
// stays pure; this file does the I/O.

import { db } from "@/lib/db/client";
import { dayKey } from "@/lib/db/queries/sensors";
import { getCurrentPhaseRow } from "@/lib/db/queries/plans";
import type {
  FinalSession,
  SessionPlan,
} from "@/lib/coach-engine/types";
import type {
  WorkoutContextInput,
  WorkoutContextRecentCompleted,
} from "@/lib/ai-coach/prompts/workout-context";

/**
 * Build full workout context for the user as of `today`.
 * Returns null when the user has no active macrocycle (pre-onboarding).
 */
export async function loadWorkoutContext(
  userId: string,
  today: Date = new Date(),
): Promise<WorkoutContextInput | null> {
  const phaseRow = await getCurrentPhaseRow(userId, today);
  if (!phaseRow) return null;

  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: { phases: { orderBy: { blockNumber: "asc" } } },
  });
  if (!macro) return null;

  const today0 = dayKey(today);
  const phaseStart = dayKey(phaseRow.startDate);
  const weekInBlock = Math.floor((today0.getTime() - phaseStart.getTime()) / (7 * 86400000)) + 1;

  // Time-trial countdown: TT1 sits at the start of week 2 of Block 5 (W18 of macro).
  // Returns null while we're in Block 5 itself (TT happens "now-ish", UI handles it).
  let daysToNextTimeTrial: number | null = null;
  if (phaseRow.blockNumber < 5) {
    const block5 = macro.phases.find((p) => p.blockNumber === 5);
    if (block5) {
      const tt1 = dayKey(block5.startDate);
      tt1.setUTCDate(tt1.getUTCDate() + 7);
      daysToNextTimeTrial = Math.max(0, Math.floor((tt1.getTime() - today0.getTime()) / 86400000));
    }
  }

  // Today's plan (raw)
  const weekPlan = phaseRow.weeklyPlans.find(
    (w) =>
      dayKey(w.startDate).getTime() <= today0.getTime() &&
      today0.getTime() < dayKey(w.endDate).getTime(),
  );

  const todayKey = today0.toISOString().slice(0, 10);
  const plannedSessions: SessionPlan[] = weekPlan
    ? extractSessionsForKey(weekPlan.plannedSessions, todayKey)
    : [];

  // Today's modulated sessions: pull from Workout rows (set after morning-input
  // when sessions/today runs the modulator). If absent, signal null so the
  // formatter renders "Morning Check-in noch nicht abgeschlossen".
  const todayStart = today0;
  const todayEnd = new Date(today0.getTime() + 86400000);
  const todayWorkouts = await db.workout.findMany({
    where: { userId, date: { gte: todayStart, lt: todayEnd } },
    orderBy: { date: "asc" },
  });

  let finalSessions: FinalSession[] | null = null;
  // Modulator only writes Workout rows after morning-input → presence of ANY
  // workout row signals finalSessions are valid. We then iterate the PLANNED
  // list (source of truth for "what was scheduled today") and overlay the
  // workout-row modulation data when types match. This guarantees two-a-days
  // are shown in full even if only one workout-row exists yet (e.g. user hit
  // Start on AM Easy but hasn't touched PM Strength).
  if (todayWorkouts.length > 0) {
    finalSessions = plannedSessions.map((p) => {
      const matchingWorkout = todayWorkouts.find((w) => w.type === p.type);
      return {
        ...p,
        wasModified: matchingWorkout?.modulationApplied ?? false,
        modifications: ((matchingWorkout?.modulations as unknown) as string[] | null) ?? [],
        confidence: 100, // not yet persisted on Workout — tracked in v0.4
        explanation: matchingWorkout?.modulationReason ?? "",
      };
    });
  }

  // Upcoming: next 7 calendar days from all weekly plans in the active phase
  // (and the immediately following phase, since week-7 lookup may cross blocks).
  const sevenDaysOut = new Date(today0.getTime() + 7 * 86400000);
  const allPhasesWithPlans = await db.phase.findMany({
    where: { macrocycleId: macro.id },
    include: { weeklyPlans: true },
  });
  const upcoming: SessionPlan[] = [];
  for (const ph of allPhasesWithPlans) {
    for (const wp of ph.weeklyPlans) {
      const sessions = (wp.plannedSessions as unknown) as SessionPlan[];
      if (!Array.isArray(sessions)) continue;
      for (const s of sessions) {
        const sDate = s.date instanceof Date ? s.date : new Date(s.date as unknown as string);
        const sKey = dayKey(sDate);
        if (sKey.getTime() > today0.getTime() && sKey.getTime() <= sevenDaysOut.getTime()) {
          upcoming.push({ ...s, date: sKey });
        }
      }
    }
  }
  upcoming.sort((a, b) => {
    const ta = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
    const tb = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
    return ta - tb;
  });

  // Recent completed: 5 most recent
  const recentRaw = await db.workout.findMany({
    where: { userId, status: "completed" },
    orderBy: { date: "desc" },
    take: 5,
  });
  const recentCompleted: WorkoutContextRecentCompleted[] = recentRaw.map((w) => ({
    date: w.date,
    type: w.type,
    rpe: w.rpe,
    durationActualMin: w.durationActualMin,
    notes: w.notes,
    wasModified: w.modulationApplied,
    modifications: ((w.modulations as unknown) as string[] | null) ?? [],
  }));

  return {
    today: { plannedSessions, finalSessions },
    recentCompleted,
    upcoming,
    blockPosition: {
      blockNumber: phaseRow.blockNumber,
      phaseName: phaseRow.name,
      weekInBlock,
      weeksTotal: phaseRow.durationWeeks,
      daysToNextTimeTrial,
    },
  };
}

/**
 * Block-context loader — for /api/coach/block-review. Returns ALL workouts
 * since block start, not just the recent 5.
 */
export async function loadBlockContext(userId: string, phaseId: string) {
  const phase = await db.phase.findFirst({
    where: { id: phaseId, macrocycle: { userId } },
    include: { macrocycle: true },
  });
  if (!phase) return null;

  const workouts = await db.workout.findMany({
    where: {
      userId,
      date: { gte: phase.startDate, lt: phase.plannedEndDate },
    },
    orderBy: { date: "asc" },
  });

  return {
    phase: {
      blockNumber: phase.blockNumber,
      name: phase.name,
      startDate: phase.startDate,
      plannedEndDate: phase.plannedEndDate,
    },
    workouts: workouts.map((w) => ({
      date: w.date,
      type: w.type,
      status: w.status,
      rpe: w.rpe,
      durationActualMin: w.durationActualMin,
      notes: w.notes,
      wasModified: w.modulationApplied,
      modifications: ((w.modulations as unknown) as string[] | null) ?? [],
    })),
  };
}

function extractSessionsForKey(json: unknown, dateKeyStr: string): SessionPlan[] {
  if (!Array.isArray(json)) return [];
  const out: SessionPlan[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as SessionPlan & { date: string | Date };
    const sDate = s.date instanceof Date ? s.date : new Date(s.date);
    const key = sDate.toISOString().slice(0, 10);
    if (key === dateKeyStr) {
      out.push({ ...s, date: sDate });
    }
  }
  return out;
}
