// LimitationsLogic — Knee tracking + therapy phase + constraint generation
// See science_doc.md Kap 8.5 (Patellatendinopathie) & spec 6.6.
// Pure functions.

import type { KneeLog, LimitationsOutput, TherapyPhase, Trend7d, UserMorningInputs } from "../types";
import { computeTrend7d } from "../load-monitoring";

/**
 * Daily knee score: avg of morning_stiffness + stairs_score.
 * Both are 1-10 (10 = worst); higher → more concerning.
 */
export function kneeScoreFromInputs(morning: UserMorningInputs, postSession?: number): number {
  const morningAvg = (morning.morningStiffness + morning.stairsScore) / 2;
  if (postSession !== undefined) {
    return Math.round((morningAvg * 2 + postSession) / 3);
  }
  return Math.round(morningAvg);
}

/**
 * Therapy phase transition logic.
 * REACTIVE → DISREPAIR → REMODELING → SPORT_SPECIFIC.
 *
 * Per science_doc Kap 8.5: progression requires sustained improvement
 * (knee scores trending down) AND VISA-P or provocation-test clearance.
 * Regression: kneeScores worsening for 7d puts athlete back one phase.
 */
export function decideTherapyPhaseTransition(
  currentPhase: TherapyPhase,
  recentKneeScores: number[],
  visaPScore: number | null,
  provocationTestResult: number | null,
): TherapyPhase {
  if (recentKneeScores.length === 0) return currentPhase;

  const avg7d = recentKneeScores.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, recentKneeScores.length);
  const last7 = recentKneeScores.slice(-7);
  const trendInput = last7.map((value, i) => ({
    date: new Date(2026, 0, 1 + i),
    value,
  }));
  const trend = computeTrend7d(trendInput);

  // Regression: declining knee health (scores trending up = worsening)
  if (avg7d >= 6 && trend === "improving") {
    // For knee scores, "improving" trend means score increasing → worsening
    if (currentPhase === "SPORT_SPECIFIC") return "REMODELING";
    if (currentPhase === "REMODELING") return "DISREPAIR";
    if (currentPhase === "DISREPAIR") return "REACTIVE";
    return "REACTIVE";
  }

  // Progression
  if (currentPhase === "REACTIVE" && avg7d <= 4 && (visaPScore === null || visaPScore >= 50)) {
    return "DISREPAIR";
  }
  if (currentPhase === "DISREPAIR" && avg7d <= 3 && (visaPScore === null || visaPScore >= 70)) {
    return "REMODELING";
  }
  if (
    currentPhase === "REMODELING" &&
    avg7d <= 2 &&
    (visaPScore === null || visaPScore >= 80) &&
    (provocationTestResult === null || provocationTestResult <= 2)
  ) {
    return "SPORT_SPECIFIC";
  }

  return currentPhase;
}

/**
 * Constraint string list based on knee score + therapy phase.
 * See spec 6.6 + science_doc Kap 8.5.
 */
export function generateConstraints(kneeScore: number, therapyPhase: TherapyPhase): string[] {
  const constraints: string[] = [];

  if (kneeScore >= 8) {
    constraints.push("force_recovery_session", "no_running", "no_strength");
  } else if (kneeScore >= 7) {
    constraints.push("no_high_intensity", "no_plyo", "no_intervals_under_3min");
  } else if (kneeScore >= 5) {
    constraints.push("strength_load_cap_70", "no_plyo", "run_intensity_max_M");
  }

  if (therapyPhase === "REACTIVE") {
    constraints.push("add_wall_sit_pre_workout", "no_threshold_or_higher");
  } else if (therapyPhase === "DISREPAIR") {
    constraints.push("add_wall_sit_pre_workout");
  } else if (therapyPhase === "REMODELING") {
    constraints.push("monitor_knee_post_session");
  }

  // Deduplicate
  return [...new Set(constraints)];
}

/**
 * Compute how many days since the last `skipped_illness` workout.
 * Returns null when not in recovery (no illness or >10 days ago).
 * ACSM Return-to-Sport: 1-3 acute, 4-5 transition, 6-8 taper.
 */
export function computeIllnessRecoveryDays(
  recentWorkouts: { date: Date; status: string }[],
  today: Date,
): number | null {
  const illnessDays = recentWorkouts
    .filter((w) => w.status === "skipped_illness")
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (illnessDays.length === 0) return null;

  const lastIllnessDate = illnessDays[0].date;
  const diffMs = today.getTime() - lastIllnessDate.getTime();
  const daysSince = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  return daysSince <= 8 ? daysSince : null;
}

export function computeKneeStatus(
  todayInputs: { morning: UserMorningInputs; postSession?: number },
  recentKneeData: KneeLog[],
  currentTherapyPhase: TherapyPhase,
  visaPLatest: number | null = null,
  recentWorkoutStatuses?: { date: Date; status: string }[],
  today?: Date,
): LimitationsOutput {
  const kneeScoreToday = kneeScoreFromInputs(todayInputs.morning, todayInputs.postSession);

  const last28 = recentKneeData.slice(-28);
  const baseline28 =
    last28.length > 0
      ? last28.reduce((acc, k) => {
          const score = (k.morningStiffness + k.stairsScore) / 2;
          return acc + score;
        }, 0) / last28.length
      : kneeScoreToday;

  const last7 = recentKneeData.slice(-7).map((k) => ({
    date: k.date,
    value: (k.morningStiffness + k.stairsScore) / 2,
  }));
  // For knee: rising values = worsening. We invert sign to match "improving = better".
  const rawTrend = computeTrend7d(last7);
  const kneeTrend7d: Trend7d =
    rawTrend === "improving" ? "declining" : rawTrend === "declining" ? "improving" : "stable";

  // Therapy-phase decision uses recent scores
  const recentScoresForPhase = recentKneeData
    .slice(-14)
    .map((k) => Math.round((k.morningStiffness + k.stairsScore) / 2));
  const therapyPhase = decideTherapyPhaseTransition(currentTherapyPhase, recentScoresForPhase, visaPLatest, null);

  const constraints = generateConstraints(kneeScoreToday, therapyPhase);

  const illnessRecoveryDays =
    recentWorkoutStatuses && today
      ? computeIllnessRecoveryDays(recentWorkoutStatuses, today)
      : null;

  return {
    kneeScoreToday,
    kneeBaseline28d: Math.round(baseline28 * 10) / 10,
    kneeTrend7d,
    therapyPhase,
    constraints,
    illnessRecoveryDays,
  };
}
