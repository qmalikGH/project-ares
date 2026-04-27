// BlockReview computation — aggregates a finished block's training data into
// the inputs the periodization engine needs to decide proceed/extend/adjust/defer.
//
// Pure aggregation; the actual transition decision lives in
// `periodization.decidePhaseTransition(...)`.
import type { BlockReviewInput } from "@/lib/coach-engine/types";

export interface BlockTrainingRows {
  workouts: { date: Date; type: string; status: string; rpe: number | null; durationActualMin: number | null }[];
  sensorRows: {
    date: Date;
    readinessScore: number | null;
    kneeScore: number | null;
    loadMetrics: unknown;
  }[];
  performance: {
    targetVdot: number | null;
    achievedVdot: number | null;
    targetTime: string | null;
    achievedTime: string | null;
  };
}

export function buildBlockReviewInput(rows: BlockTrainingRows): BlockReviewInput {
  // TID — z1/z2/z3 distribution from completed workouts
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  for (const w of rows.workouts) {
    if (w.status !== "completed") continue;
    const t = w.type;
    if (t === "easy_run" || t === "long_run" || t === "active_recovery") z1 += w.durationActualMin ?? 0;
    else if (t === "tempo_run" || t === "threshold_run") z2 += w.durationActualMin ?? 0;
    else if (t === "vo2max_intervals" || t === "time_trial_5k") z3 += w.durationActualMin ?? 0;
  }
  const totalMin = z1 + z2 + z3;
  const tid = totalMin > 0
    ? { z1: Math.round((z1 / totalMin) * 100), z2: Math.round((z2 / totalMin) * 100), z3: Math.round((z3 / totalMin) * 100) }
    : { z1: 0, z2: 0, z3: 0 };

  // Average ACWR — pull from cached loadMetrics
  const acwrs = rows.sensorRows
    .map((r) => {
      const lm = r.loadMetrics as { acwrRolling?: number } | null;
      return typeof lm?.acwrRolling === "number" ? lm.acwrRolling : null;
    })
    .filter((v): v is number => v !== null);
  const averageACWR = acwrs.length > 0 ? acwrs.reduce((a, b) => a + b, 0) / acwrs.length : 0;

  // Average readiness
  const readiness = rows.sensorRows.map((r) => r.readinessScore).filter((s): s is number => s != null);
  const averageReadiness = readiness.length > 0 ? Math.round(readiness.reduce((a, b) => a + b, 0) / readiness.length) : 0;

  // Knee trend — last 7 vs first 7 of the block
  const knee = rows.sensorRows.map((r) => r.kneeScore).filter((s): s is number => s != null);
  let kneeTrend: "stable" | "improving" | "declining" = "stable";
  if (knee.length >= 8) {
    const firstHalf = knee.slice(0, Math.floor(knee.length / 2));
    const lastHalf = knee.slice(Math.floor(knee.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const lastAvg = lastHalf.reduce((a, b) => a + b, 0) / lastHalf.length;
    if (lastAvg > firstAvg + 0.5) kneeTrend = "declining";
    else if (lastAvg < firstAvg - 0.5) kneeTrend = "improving";
  }

  // Missed sessions — planned but not completed within the block
  const missed = rows.workouts.filter((w) => w.status === "skipped" || w.status === "planned").length;

  // Performance marker — block 1-4: VDOT proxy. Block 5: time trial result.
  const targetVdot = rows.performance.targetVdot ?? 0;
  const achievedVdot = rows.performance.achievedVdot ?? 0;
  const performanceMarkerMet = achievedVdot >= targetVdot;
  const performanceMarkerClose = !performanceMarkerMet && targetVdot > 0 && achievedVdot >= targetVdot - 1;
  const performanceMarkerMissed = !performanceMarkerMet && !performanceMarkerClose;

  // Health stability — readiness + knee
  const healthStable = averageReadiness >= 70 && kneeTrend !== "declining";
  const healthWarning = averageReadiness >= 60 && averageReadiness < 70 && kneeTrend !== "declining";
  const healthDecline = averageReadiness < 60 || kneeTrend === "declining";

  return {
    performanceMarkerMet,
    performanceMarkerClose,
    performanceMarkerMissed,
    healthStable,
    healthWarning,
    healthDecline,
    averageACWR: Math.round(averageACWR * 100) / 100,
    averageReadiness,
    kneeScoreTrend: kneeTrend,
    missedSessionsCount: missed,
    actualTID: tid,
  };
}
