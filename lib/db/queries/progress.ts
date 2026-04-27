// /progress data aggregation — read-only queries, no engine logic.
// Pure compute helpers live in `progress-helpers.ts`.
import { db } from "@/lib/db/client";
import { dayKey } from "./sensors";
import type { SessionPlan } from "@/lib/coach-engine/types";
import {
  computeAdherenceBand,
  computeAdherenceScore,
  computeWeightedTID,
  isRunType,
  zoneMinutesToTID,
  type AdherenceBand,
  type TIDDistribution,
} from "./progress-helpers";

// ============================================
// Goal Progress
// ============================================
export interface GoalProgress {
  primaryType: string;
  currentValue: { time: string; date?: string };
  targetValue: { time: string; date?: string };
  daysRemaining: number;
  daysToFirstTimeTrial: number | null;
  totalWeeksInPlan: number;
  weeksElapsed: number;
}

export async function getGoalProgress(
  userId: string,
  today: Date,
): Promise<GoalProgress | null> {
  const goal = await db.goal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!goal) return null;

  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: { phases: { orderBy: { blockNumber: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  if (!macro) return null;

  const today0 = dayKey(today);
  const targetDate = goal.targetDate;
  const daysRemaining = Math.max(
    0,
    Math.floor((targetDate.getTime() - today0.getTime()) / 86400000),
  );

  // First Time Trial = start of W18 = startDate(Block5) + 7 days
  const block5 = macro.phases.find((p) => p.blockNumber === 5);
  let daysToFirstTimeTrial: number | null = null;
  if (block5) {
    const tt1 = dayKey(block5.startDate);
    tt1.setUTCDate(tt1.getUTCDate() + 7);
    daysToFirstTimeTrial = Math.max(
      0,
      Math.floor((tt1.getTime() - today0.getTime()) / 86400000),
    );
  }

  const weeksElapsed = Math.max(
    0,
    Math.floor((today0.getTime() - dayKey(macro.startDate).getTime()) / (7 * 86400000)),
  );

  return {
    primaryType: goal.primaryType,
    currentValue: goal.currentValue as GoalProgress["currentValue"],
    targetValue: goal.targetValue as GoalProgress["targetValue"],
    daysRemaining,
    daysToFirstTimeTrial,
    totalWeeksInPlan: macro.totalWeeks,
    weeksElapsed,
  };
}

// ============================================
// VDOT history
// ============================================
export interface VdotHistoryPoint {
  date: string; // ISO yyyy-mm-dd for JSON-friendly
  vdot: number;
  source:
    | "INITIAL"
    | "W1_CALIBRATION"
    | "BLOCK_REVIEW_TEST"
    | "TIME_TRIAL_1"
    | "TIME_TRIAL_2"
    | "PLANNED";
  note?: string;
}

export async function getVdotHistory(userId: string): Promise<VdotHistoryPoint[]> {
  const goal = await db.goal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!goal) return [];

  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
        include: { blockReview: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!macro) return [];

  const points: VdotHistoryPoint[] = [];

  // Initial = macrocycle startDate, vdotTarget of Block 1
  const block1 = macro.phases.find((p) => p.blockNumber === 1);
  const initialVdot =
    (block1?.config as { vdotTarget?: number } | null)?.vdotTarget ?? 42;
  points.push({
    date: macro.startDate.toISOString().slice(0, 10),
    vdot: initialVdot,
    source: "INITIAL",
    note: `Initial: ${(goal.currentValue as { time?: string }).time ?? "—"}`,
  });

  // Block-review-tests + planned per-block targets
  for (const phase of macro.phases) {
    if (phase.blockReview) {
      const review = phase.blockReview.performanceMarkerResult as {
        achieved?: { vdot?: number; time?: string };
      } | null;
      if (review?.achieved?.vdot) {
        const date = (phase.actualEndDate ?? phase.plannedEndDate)
          .toISOString()
          .slice(0, 10);
        points.push({
          date,
          vdot: review.achieved.vdot,
          source: phase.blockNumber === 5 ? "TIME_TRIAL_1" : "BLOCK_REVIEW_TEST",
          note: `Block ${phase.blockNumber} Test${review.achieved.time ? `: ${review.achieved.time}` : ""}`,
        });
      }
    }
    const planned = (phase.config as { vdotTarget?: number } | null)?.vdotTarget;
    if (planned !== undefined) {
      points.push({
        date: phase.plannedEndDate.toISOString().slice(0, 10),
        vdot: planned,
        source: "PLANNED",
        note: `Block ${phase.blockNumber} Plan-Ziel`,
      });
    }
  }

  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ============================================
// Block Status
// ============================================
export interface BlockStatus {
  currentBlockNumber: number;
  currentPhaseName: string;
  currentPhaseId: string;
  weekInBlock: number;
  weeksTotal: number;
  blockStartDate: string;
  blockEndDatePlanned: string;
  daysToBlockReview: number;
  blockReviewType: string;
  blocksTotal: number;
  blocksCompleted: number;
}

const BLOCK_REVIEW_TYPES: Record<number, string> = {
  1: "Long Run progressive 60min mit Threshold-Segment",
  2: "5k Tempo Test",
  3: "5k Tempo Test (zweiter Versuch)",
  4: "5k Tempo Test (Pre-Peak)",
  5: "5k Time Trial #1 (W18) und #2 (W20)",
};

export async function getBlockStatus(
  userId: string,
  today: Date,
): Promise<BlockStatus | null> {
  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: { phases: { orderBy: { blockNumber: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  if (!macro) return null;

  const today0 = dayKey(today);
  const currentPhase = macro.phases.find(
    (p) =>
      dayKey(p.startDate).getTime() <= today0.getTime() &&
      today0.getTime() < dayKey(p.plannedEndDate).getTime(),
  );
  if (!currentPhase) return null;

  const weekInBlock =
    Math.floor(
      (today0.getTime() - dayKey(currentPhase.startDate).getTime()) /
        (7 * 86400000),
    ) + 1;
  const daysToBlockReview = Math.max(
    0,
    Math.floor(
      (dayKey(currentPhase.plannedEndDate).getTime() - today0.getTime()) /
        86400000,
    ),
  );
  const blocksCompleted = macro.phases.filter((p) => p.status === "completed").length;

  return {
    currentBlockNumber: currentPhase.blockNumber,
    currentPhaseName: currentPhase.name,
    currentPhaseId: currentPhase.id,
    weekInBlock,
    weeksTotal: currentPhase.durationWeeks,
    blockStartDate: currentPhase.startDate.toISOString().slice(0, 10),
    blockEndDatePlanned: currentPhase.plannedEndDate.toISOString().slice(0, 10),
    daysToBlockReview,
    blockReviewType:
      BLOCK_REVIEW_TYPES[currentPhase.blockNumber] ?? "Block-Review-Test",
    blocksTotal: macro.phases.length,
    blocksCompleted,
  };
}

// ============================================
// Adherence
// ============================================
export interface AdherenceStats {
  scope: string;
  totalSessions: number;
  completed: number;
  modified: number;
  skipped: number;
  pending: number;
  adherenceScore: number;
  band: AdherenceBand;
}

export type AdherenceScope = "today" | "this_week" | "this_block";

export async function getAdherenceStats(
  userId: string,
  scope: AdherenceScope,
  today: Date,
): Promise<AdherenceStats> {
  const today0 = dayKey(today);
  let from: Date;
  let to: Date;

  if (scope === "today") {
    from = today0;
    to = new Date(from.getTime() + 86400000);
  } else if (scope === "this_week") {
    // Monday of current week (UTC)
    const dayOfWeek = today0.getUTCDay() || 7; // Sun = 7
    from = new Date(today0.getTime() - (dayOfWeek - 1) * 86400000);
    to = new Date(from.getTime() + 7 * 86400000);
  } else {
    const macro = await db.macrocycle.findFirst({
      where: { userId, status: "active" },
      include: { phases: { orderBy: { blockNumber: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    const currentPhase = macro?.phases.find(
      (p) =>
        dayKey(p.startDate).getTime() <= today0.getTime() &&
        today0.getTime() < dayKey(p.plannedEndDate).getTime(),
    );
    if (!currentPhase) {
      return {
        scope,
        totalSessions: 0,
        completed: 0,
        modified: 0,
        skipped: 0,
        pending: 0,
        adherenceScore: 0,
        band: "alarm",
      };
    }
    from = dayKey(currentPhase.startDate);
    const phaseEnd = dayKey(currentPhase.plannedEndDate);
    // Count up to today (inclusive of today, but we use exclusive < to)
    to = today0.getTime() < phaseEnd.getTime() ? new Date(today0.getTime() + 86400000) : phaseEnd;
  }

  const workouts = await db.workout.findMany({
    where: { userId, date: { gte: from, lt: to } },
  });

  let completed = 0;
  let modified = 0;
  let skipped = 0;
  let pending = 0;
  for (const w of workouts) {
    if (w.type === "rest") continue;
    if (w.status === "completed" && !w.modulationApplied) completed++;
    else if (w.status === "completed" && w.modulationApplied) modified++;
    else if (w.status === "skipped") skipped++;
    else pending++;
  }

  const totalSessions = completed + modified + skipped + pending;
  const adherenceScore = computeAdherenceScore({
    completed,
    modified,
    skipped,
    pending,
  });
  return {
    scope,
    totalSessions,
    completed,
    modified,
    skipped,
    pending,
    adherenceScore,
    band: computeAdherenceBand(adherenceScore),
  };
}

// ============================================
// TID Distribution (Plan vs Actual)
// ============================================
export interface TIDComparison {
  plan: TIDDistribution;
  actual: TIDDistribution;
  driftPP: { z1: number; z2: number; z3: number };
  totalRunMin: number;
}

export type TIDScope = "this_block" | "all";

export async function getTIDDistribution(
  userId: string,
  scope: TIDScope,
  today: Date,
): Promise<TIDComparison | null> {
  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: { phases: { orderBy: { blockNumber: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  if (!macro) return null;

  const today0 = dayKey(today);
  let from: Date;
  let planTID: TIDDistribution;

  if (scope === "this_block") {
    const currentPhase = macro.phases.find(
      (p) =>
        dayKey(p.startDate).getTime() <= today0.getTime() &&
        today0.getTime() < dayKey(p.plannedEndDate).getTime(),
    );
    if (!currentPhase) return null;
    from = dayKey(currentPhase.startDate);
    const config = currentPhase.config as
      | { enduranceTID?: TIDDistribution }
      | null;
    planTID = config?.enduranceTID ?? { z1: 78, z2: 20, z3: 2 };
  } else {
    from = dayKey(macro.startDate);
    planTID = computeWeightedTID(
      macro.phases.map((p) => {
        const cfg = p.config as { enduranceTID?: TIDDistribution } | null;
        const t = cfg?.enduranceTID ?? { z1: 0, z2: 0, z3: 0 };
        return { ...t, durationWeeks: p.durationWeeks };
      }),
    );
  }

  const to = new Date(today0.getTime() + 86400000);
  const runWorkouts = await db.workout.findMany({
    where: {
      userId,
      date: { gte: from, lt: to },
      status: "completed",
    },
  });

  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  for (const w of runWorkouts) {
    if (!isRunType(w.type)) continue;
    const planned = w.plannedSession as unknown as SessionPlan;
    const zone = planned?.intensityZone ?? 1;
    const dur = w.durationActualMin ?? planned?.durationMin ?? 0;
    if (zone === 1) z1 += dur;
    else if (zone === 2) z2 += dur;
    else if (zone === 3) z3 += dur;
  }
  const totalRunMin = z1 + z2 + z3;
  const actual = zoneMinutesToTID({ z1, z2, z3 });

  return {
    plan: planTID,
    actual,
    driftPP: {
      z1: Math.round((actual.z1 - planTID.z1) * 10) / 10,
      z2: Math.round((actual.z2 - planTID.z2) * 10) / 10,
      z3: Math.round((actual.z3 - planTID.z3) * 10) / 10,
    },
    totalRunMin,
  };
}
