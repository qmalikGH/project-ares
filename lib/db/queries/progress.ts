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
import {
  computeHrZones,
  computeHrTID,
  type SplitForTID,
} from "@/lib/coach-engine/hr-zones";
import {
  detectPaceDrift,
  type DriftDetectionResult,
  type DriftEasyRunSample,
} from "@/lib/coach-engine/pace-drift";

function paceStringToSec(pace: string): number {
  const [m, s] = pace.split(":").map(Number);
  return (Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0);
}

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

// Shared macro loader — one DB call, reused by getBlockStatus / getBlockWeeks / getPhasesSummary
export async function loadActiveMacrocycle(userId: string) {
  return db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
        include: { weeklyPlans: { orderBy: { startDate: "asc" } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

type LoadedMacro = NonNullable<Awaited<ReturnType<typeof loadActiveMacrocycle>>>;

export async function getBlockStatus(
  userId: string,
  today: Date,
  preloadedMacro?: LoadedMacro | null,
): Promise<BlockStatus | null> {
  const macro = preloadedMacro ?? (await loadActiveMacrocycle(userId));
  if (!macro) return null;

  const today0 = dayKey(today);
  const currentPhase = macro.phases.find(
    (p) =>
      dayKey(p.startDate).getTime() <= today0.getTime() &&
      today0.getTime() < dayKey(p.plannedEndDate).getTime(),
  );
  if (!currentPhase) return null;

  // Find which WeeklyPlan covers today (resilient to illness gaps)
  const currentWp = currentPhase.weeklyPlans
    .filter(
      (wp) =>
        dayKey(wp.startDate).getTime() <= today0.getTime() &&
        today0.getTime() < dayKey(wp.endDate).getTime() + 86400000,
    )
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

  let weekInBlock: number;
  if (currentWp) {
    // Position of this plan among all plans in the block, sorted by date
    const sorted = [...currentPhase.weeklyPlans].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime(),
    );
    weekInBlock = sorted.findIndex((wp) => wp.id === currentWp.id) + 1;
  } else {
    // Fallback: date-diff if between plans (gap week / illness)
    weekInBlock =
      Math.floor(
        (today0.getTime() - dayKey(currentPhase.startDate).getTime()) /
          (7 * 86400000),
      ) + 1;
  }
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
// Phase Summary (for block-detail phase tabs)
// ============================================
const PHASE_SHORT_LABELS: Record<string, string> = {
  ACCUMULATION_AEROBIC_BASE: "BASE",
  ACCUMULATION_THRESHOLD_INTRO: "BUILD",
  TRANSMUTATION_THRESHOLD: "THRESHOLD",
  TRANSMUTATION_VO2MAX: "VO2MAX",
  REALIZATION_PEAK_PERFORMANCE: "PEAK",
};

export interface PhaseSummary {
  blockNumber: number;
  name: string;
  shortLabel: string;
  status: string;
  startDate: string;
  endDate: string;
  durationWeeks: number;
}

export function getPhasesSummary(macro: LoadedMacro): PhaseSummary[] {
  return macro.phases.map((p) => ({
    blockNumber: p.blockNumber,
    name: p.name,
    shortLabel: PHASE_SHORT_LABELS[p.name] ?? p.name.slice(0, 5),
    status: p.status,
    startDate: p.startDate.toISOString().slice(0, 10),
    endDate: p.plannedEndDate.toISOString().slice(0, 10),
    durationWeeks: p.durationWeeks,
  }));
}

// ============================================
// Block Weeks (per-week summaries for current block)
// ============================================
const RUN_TYPES = new Set([
  "easy_run", "threshold_run", "tempo_run", "long_run",
  "vo2max_intervals", "calibration_run", "time_trial_5k", "active_recovery",
]);

function estimateKmFromSession(s: SessionPlan): number {
  if (!RUN_TYPES.has(s.type) || !s.durationMin) return 0;
  if (s.paceTarget?.to) {
    const avgSec = (paceStringToSec(s.paceTarget.from) + paceStringToSec(s.paceTarget.to)) / 2;
    if (avgSec > 0) return s.durationMin / (avgSec / 60);
  }
  // Fallback: 6:00/km
  return s.durationMin / 6;
}

const SESSION_SHORT_LABELS: Record<string, string> = {
  easy_run: "Easy",
  threshold_run: "Schwelle",
  tempo_run: "Tempo",
  long_run: "Long",
  vo2max_intervals: "VO2max",
  calibration_run: "Kalibr.",
  time_trial_5k: "TT 5k",
  active_recovery: "Recovery",
  strength_a: "Kraft",
  strength_b: "Kraft",
  strength_c: "Kraft",
  rest: "Rest",
};

function generateWeekTitle(
  sessions: SessionPlan[],
  weekIdx: number,
  weeksTotal: number,
): string {
  if (weekIdx === weeksTotal - 1) return "Deload";
  const types = sessions.filter((s) => s.type !== "rest").map((s) => s.type);
  if (types.includes("time_trial_5k")) return "Time Trial";
  if (types.includes("vo2max_intervals")) return "VO2max-Intervalle";
  if (types.includes("threshold_run") && types.includes("tempo_run"))
    return "LT + Race Pace";
  if (types.includes("threshold_run")) return "Schwellen-Anker";
  if (types.includes("tempo_run")) return "Tempo-Fokus";
  return "Aufbau";
}

function generateWeekDescription(sessions: SessionPlan[]): string {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    if (s.type === "rest") continue;
    const label = SESSION_SHORT_LABELS[s.type] ?? s.type;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, n]) => `${n}× ${label}`)
    .join(", ");
}

export interface BlockWeekSummary {
  weekNumber: number;
  title: string;
  description: string;
  totalKm: number;
  totalMin: number;
  isCurrent: boolean;
}

/** Returns weeks for ALL blocks in the macrocycle, keyed by blockNumber. */
export function getAllBlockWeeks(
  macro: LoadedMacro,
  today: Date,
): Record<number, BlockWeekSummary[]> {
  const today0 = dayKey(today);
  const result: Record<number, BlockWeekSummary[]> = {};

  for (const phase of macro.phases) {
    const sorted = [...phase.weeklyPlans].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime(),
    );

    result[phase.blockNumber] = sorted.map((wp, idx) => {
      const sessions = (wp.plannedSessions as SessionPlan[] | null) ?? [];
      const totalKm = Math.round(
        sessions.reduce((sum, s) => sum + estimateKmFromSession(s), 0),
      );
      const totalMin = sessions.reduce(
        (sum, s) => sum + (s.durationMin ?? 0),
        0,
      );
      const isCurrent =
        dayKey(wp.startDate).getTime() <= today0.getTime() &&
        today0.getTime() < dayKey(wp.endDate).getTime() + 86400000;

      return {
        weekNumber: idx + 1,
        title: generateWeekTitle(sessions, idx, sorted.length),
        description: generateWeekDescription(sessions),
        totalKm,
        totalMin,
        isCurrent,
      };
    });
  }

  return result;
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
    else if (w.status === "skipped" || w.status === "skipped_illness") skipped++;
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

// ============================================
// HR-based TID (Karvonen — Sprint v0.6)
// ============================================
export interface HrBasedTID {
  source: "hr";
  zones: { z1Max: number; z2Max: number; hrMax: number; hrRest: number };
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
  totalSec: number;
  unclassifiedSec: number;
  sessionsWithHr: number;
  sessionsWithoutHr: number;
  /** Drift vs planned TID, percentage points. */
  driftPP: { z1: number; z2: number; z3: number };
}

/**
 * Compute HR-zone-based TID across completed run workouts in scope.
 * Returns null when user has no HR thresholds configured (caller falls back to plan TID).
 *
 * Why HR-based not plan-based: planned `intensityZone` reflects intent, not actual
 * effort. HR splits show the *real* TID — surfaces "Mitteltempo-Falle" (Z2 too high)
 * that plan-based aggregation can't see when the athlete drifts.
 */
export async function getHrBasedTIDDistribution(
  userId: string,
  scope: TIDScope,
  today: Date,
): Promise<HrBasedTID | null> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  if (!settings?.hrMax || !settings?.hrRest) return null;

  // Compute zones via Karvonen — throws if invalid; fail-safe by returning null.
  let zones;
  try {
    zones = computeHrZones({ hrMax: settings.hrMax, hrRest: settings.hrRest });
  } catch {
    return null;
  }

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

  const allSplits: SplitForTID[] = [];
  let sessionsWithHr = 0;
  let sessionsWithoutHr = 0;

  for (const w of runWorkouts) {
    if (!isRunType(w.type)) continue;
    const exec = w.executedSession as
      | {
          type?: string;
          splits?: Array<{ durationSec?: number; averageHr?: number | null }>;
          averageHr?: number | null;
          durationSec?: number;
        }
      | null;
    if (!exec || exec.type !== "run") {
      sessionsWithoutHr += 1;
      continue;
    }
    const splits = Array.isArray(exec.splits) ? exec.splits : [];
    if (splits.length === 0) {
      // Fall back to whole-session avg HR if no splits available.
      if (typeof exec.averageHr === "number" && typeof exec.durationSec === "number") {
        allSplits.push({
          durationSec: exec.durationSec,
          averageHr: exec.averageHr,
        });
        sessionsWithHr += 1;
      } else {
        sessionsWithoutHr += 1;
      }
      continue;
    }
    let anyHr = false;
    for (const s of splits) {
      const dur = typeof s.durationSec === "number" ? s.durationSec : 0;
      const hr = typeof s.averageHr === "number" ? s.averageHr : null;
      if (dur > 0) {
        allSplits.push({ durationSec: dur, averageHr: hr });
        if (hr !== null) anyHr = true;
      }
    }
    if (anyHr) sessionsWithHr += 1;
    else sessionsWithoutHr += 1;
  }

  const tid = computeHrTID(allSplits, zones);
  const z1Pct = Math.round(tid.z1Pct * 10) / 10;
  const z2Pct = Math.round(tid.z2Pct * 10) / 10;
  const z3Pct = Math.round(tid.z3Pct * 10) / 10;

  return {
    source: "hr",
    zones: {
      z1Max: zones.z1Max,
      z2Max: zones.z2Max,
      hrMax: zones.hrMax,
      hrRest: zones.hrRest,
    },
    z1Pct,
    z2Pct,
    z3Pct,
    totalSec: tid.totalSec,
    unclassifiedSec: tid.unclassifiedSec,
    sessionsWithHr,
    sessionsWithoutHr,
    driftPP: {
      z1: Math.round((z1Pct - planTID.z1) * 10) / 10,
      z2: Math.round((z2Pct - planTID.z2) * 10) / 10,
      z3: Math.round((z3Pct - planTID.z3) * 10) / 10,
    },
  };
}

// ============================================
// Pace-Drift Detection (Sprint v0.7)
// ============================================
/**
 * Pull recent completed Easy Runs (intensityZone === 1) and run pace-drift
 * detection. Returns the DriftDetectionResult or null when no Goal/Macrocycle.
 *
 * Window: latest `limit` Easy Runs that have an actual pace + RPE recorded
 * (typically 5-7). Workouts without executedSession or non-run types are skipped.
 */
export async function getPaceDriftStatus(
  userId: string,
  limit = 7,
): Promise<DriftDetectionResult | null> {
  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!macro) return null;

  const workouts = await db.workout.findMany({
    where: {
      userId,
      status: "completed",
      type: { in: ["easy_run"] },
    },
    orderBy: { date: "desc" },
    take: limit,
  });

  const samples: DriftEasyRunSample[] = [];
  for (const w of workouts) {
    const planned = w.plannedSession as unknown as SessionPlan | null;
    if (!planned || planned.intensityZone !== 1) continue;

    // Plan E-pace upper bound = the "slow" side of the easy band, sec/km.
    const planPaceTo = planned.paceTarget?.to;
    if (!planPaceTo) continue;
    const plannedPaceSecPerKm = paceStringToSec(planPaceTo);

    const exec = w.executedSession as
      | {
          type?: string;
          averagePaceSecPerKm?: number | null;
          averageHr?: number | null;
        }
      | null;
    if (!exec || exec.type !== "run") continue;

    const actualPaceSecPerKm =
      typeof exec.averagePaceSecPerKm === "number"
        ? exec.averagePaceSecPerKm
        : null;
    if (actualPaceSecPerKm === null || actualPaceSecPerKm <= 0) continue;
    if (w.rpe == null) continue;

    samples.push({
      plannedPaceSecPerKm,
      actualPaceSecPerKm,
      plannedRpe: planned.rpeTarget ?? 4,
      actualRpe: w.rpe,
      plannedZone: 1,
      actualHrAvg: typeof exec.averageHr === "number" ? exec.averageHr : null,
      plannedZoneHrMax: null, // HR-zone tie-in deferred — not needed for v0 trigger
    });
  }

  return detectPaceDrift({ recentEasyRuns: samples });
}

// ============================================
// Garmin-HR-Zone-based TID (Sprint v0.7)
// ============================================
//
// /progress's most accurate TID source: Garmin computed time-in-each-zone
// per activity (during the workout, with the device's full HR sample, no
// km-by-km approximation). For each completed Run-Workout in the window we
// just sum the polarizedTID payload that was stored at session-complete time.
//
// Falls back to null when no Garmin-enriched runs exist; caller then shows
// the splits-based or plan-based TID instead.

export interface GarminBasedTID {
  source: "garmin_hr_zones";
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
  totalSec: number;
  /** N runs whose Garmin polarizedTID we summed. */
  sessions: number;
  /** Drift vs plan-TID, percentage points. */
  driftPP: { z1: number; z2: number; z3: number };
}

export async function getGarminBasedTIDDistribution(
  userId: string,
  scope: TIDScope,
  today: Date,
): Promise<GarminBasedTID | null> {
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

  let z1Sec = 0;
  let z2Sec = 0;
  let z3Sec = 0;
  let sessions = 0;

  for (const w of runWorkouts) {
    if (!isRunType(w.type)) continue;
    const exec = w.executedSession as
      | {
          type?: string;
          polarizedTID?: {
            z1Sec: number;
            z2Sec: number;
            z3Sec: number;
          } | null;
        }
      | null;
    if (!exec || exec.type !== "run" || !exec.polarizedTID) continue;
    z1Sec += exec.polarizedTID.z1Sec;
    z2Sec += exec.polarizedTID.z2Sec;
    z3Sec += exec.polarizedTID.z3Sec;
    sessions += 1;
  }

  const totalSec = z1Sec + z2Sec + z3Sec;
  if (totalSec === 0) return null;

  const z1Pct = Math.round(((z1Sec / totalSec) * 100) * 10) / 10;
  const z2Pct = Math.round(((z2Sec / totalSec) * 100) * 10) / 10;
  const z3Pct = Math.round(((z3Sec / totalSec) * 100) * 10) / 10;

  return {
    source: "garmin_hr_zones",
    z1Pct,
    z2Pct,
    z3Pct,
    totalSec,
    sessions,
    driftPP: {
      z1: Math.round((z1Pct - planTID.z1) * 10) / 10,
      z2: Math.round((z2Pct - planTID.z2) * 10) / 10,
      z3: Math.round((z3Pct - planTID.z3) * 10) / 10,
    },
  };
}
