// PeriodizationLogic — 20-week macrocycle with 5 blocks, phase state machine
// See science_doc.md Kap 9 (Block periodization) & spec 6.1.
// Pure functions.

import type {
  BlockNumber,
  BlockReviewInput,
  GoalInput,
  MacrocyclePlan,
  PhaseConfig,
  PhaseName,
  PhasePlan,
  PhaseTransitionDecision,
} from "../types";

// ============================================
// Block configurations (Q's 5k 24:30 → 22:00 plan)
// ============================================
export const BLOCK_CONFIGS: Record<BlockNumber, PhaseConfig> = {
  1: {
    blockNumber: 1,
    phaseName: "ACCUMULATION_AEROBIC_BASE",
    durationWeeks: 4,
    enduranceTID: { z1: 78, z2: 20, z3: 2 },
    strengthMode: "linear_progression",
    strengthRpeCap: 8,
    volumeProgression: "linear_increase",
    vdotTarget: 42,
    // Sprint v0.10 run-volume baselines (W1; W2-W4 multiplied by progression)
    longRunBaselineMin: 50,
    qualityRunBaselineMin: 30,
    easyRunBaselineMin: 35,
  },
  2: {
    blockNumber: 2,
    phaseName: "ACCUMULATION_THRESHOLD_INTRO",
    durationWeeks: 4,
    enduranceTID: { z1: 75, z2: 22, z3: 3 },
    strengthMode: "linear_progression",
    strengthRpeCap: 8,
    volumeProgression: "linear_increase",
    vdotTarget: 43,
    longRunBaselineMin: 60,
    qualityRunBaselineMin: 40,
    easyRunBaselineMin: 40,
  },
  3: {
    blockNumber: 3,
    phaseName: "TRANSMUTATION_THRESHOLD",
    durationWeeks: 4,
    enduranceTID: { z1: 75, z2: 20, z3: 5 },
    strengthMode: "maintenance",
    strengthRpeCap: 7,
    volumeProgression: "maintain",
    vdotTarget: 44,
    longRunBaselineMin: 75,
    qualityRunBaselineMin: 45,
    easyRunBaselineMin: 35,
  },
  4: {
    blockNumber: 4,
    phaseName: "TRANSMUTATION_VO2MAX",
    durationWeeks: 4,
    enduranceTID: { z1: 72, z2: 13, z3: 15 },
    strengthMode: "maintenance",
    strengthRpeCap: 7,
    volumeProgression: "maintain",
    vdotTarget: 46,
    longRunBaselineMin: 70,
    qualityRunBaselineMin: 40,
    easyRunBaselineMin: 30,
  },
  5: {
    blockNumber: 5,
    phaseName: "REALIZATION_PEAK_PERFORMANCE",
    durationWeeks: 4,
    enduranceTID: { z1: 75, z2: 10, z3: 15 },
    strengthMode: "minimal",
    strengthRpeCap: 7,
    volumeProgression: "deload",
    vdotTarget: 47,
    longRunBaselineMin: 50,
    qualityRunBaselineMin: 30,
    easyRunBaselineMin: 25,
  },
};

const PHASE_ORDER: PhaseName[] = [
  "ACCUMULATION_AEROBIC_BASE",
  "ACCUMULATION_THRESHOLD_INTRO",
  "TRANSMUTATION_THRESHOLD",
  "TRANSMUTATION_VO2MAX",
  "REALIZATION_PEAK_PERFORMANCE",
];

// ============================================
// Public API
// ============================================
/**
 * Generate a 20-week macrocycle (5 × 4-week blocks) for the given goal.
 * Performance-marker weeks: end of each block (W4, W8, W12, W16, W20).
 */
export function generateMacrocycle(goal: GoalInput): MacrocyclePlan {
  const totalWeeks = 20;
  const startDate = goal.startDate;
  const endDate = new Date(startDate.getTime() + totalWeeks * 7 * 86400000);

  const phases: PhasePlan[] = [];
  let currentStartWeek = 1;
  let currentStartDate = startDate;

  for (let i = 1 as BlockNumber; i <= 5; i = (i + 1) as BlockNumber) {
    const config = BLOCK_CONFIGS[i];
    const endWeek = currentStartWeek + config.durationWeeks - 1;
    const phaseEndDate = new Date(currentStartDate.getTime() + config.durationWeeks * 7 * 86400000);
    phases.push({
      blockNumber: i,
      phaseName: config.phaseName,
      startWeek: currentStartWeek,
      endWeek,
      startDate: currentStartDate,
      plannedEndDate: phaseEndDate,
      config,
      vdotTarget: config.vdotTarget,
    });
    currentStartWeek = endWeek + 1;
    currentStartDate = phaseEndDate;
    if (i === 5) break;
  }

  return {
    totalWeeks,
    startDate,
    endDate,
    vdotInitial: goal.vdotInitial,
    phases,
    performanceMarkerWeeks: phases.map((p) => p.endWeek),
  };
}

/**
 * Return the current phase based on today's date.
 * Returns the last phase if `today` is past macrocycle end.
 */
export function getCurrentPhase(macrocycle: MacrocyclePlan, today: Date): PhasePlan {
  const phase = macrocycle.phases.find(
    (p) => today >= p.startDate && today < p.plannedEndDate,
  );
  if (phase) return phase;
  // Past end → return final phase
  if (today >= macrocycle.endDate) {
    return macrocycle.phases[macrocycle.phases.length - 1];
  }
  // Before start → return first
  return macrocycle.phases[0];
}

/**
 * Look up the next phase by name. Returns null if at end.
 */
export function getNextPhaseName(currentPhaseName: PhaseName): PhaseName | null {
  const idx = PHASE_ORDER.indexOf(currentPhaseName);
  if (idx === -1 || idx === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

/**
 * Phase-transition decision based on block review outcomes.
 * See spec 6.1 for the decision table.
 */
export function decidePhaseTransition(
  currentPhaseName: PhaseName,
  review: BlockReviewInput,
): PhaseTransitionDecision {
  const nextPhase = getNextPhaseName(currentPhaseName);

  // Happy path: target hit + health stable
  if (review.performanceMarkerMet && review.healthStable) {
    return { decision: "PROCEED", nextPhase, recoverInNext: false };
  }

  // Close but not quite + warning signs → extend block
  if (review.performanceMarkerClose && review.healthWarning && !review.healthDecline) {
    return { decision: "EXTEND_PHASE", extendByWeeks: 1 };
  }

  // Health decline → reduce intensity
  if (review.healthDecline) {
    return { decision: "ADJUST_PHASE", reduceIntensityFraction: 0.1 };
  }

  // Performance miss
  if (review.performanceMarkerMissed) {
    const cause = analyzeRootCause(review);
    if (cause === "DISTRIBUTION_SHORTFALL") {
      return { decision: "PROCEED", nextPhase, recoverInNext: true };
    }
    if (cause === "HEALTH_DECLINE") {
      return { decision: "ADJUST_PHASE", reduceIntensityFraction: 0.1 };
    }
    return { decision: "DEFER", deferByWeeks: 1 };
  }

  // Default: proceed
  return { decision: "PROCEED", nextPhase, recoverInNext: false };
}

type RootCause = "DISTRIBUTION_SHORTFALL" | "HEALTH_DECLINE" | "OVERREACHING" | "UNCLEAR";

/**
 * Diagnose why a performance marker was missed.
 * - DISTRIBUTION_SHORTFALL: actual TID didn't match planned TID
 * - HEALTH_DECLINE: knee or readiness trending down
 * - OVERREACHING: high ACWR
 * - UNCLEAR: none of the above clearly
 */
export function analyzeRootCause(review: BlockReviewInput): RootCause {
  if (review.healthDecline) return "HEALTH_DECLINE";
  if (review.kneeScoreTrend === "declining") return "HEALTH_DECLINE";
  if (review.averageACWR > 1.3) return "OVERREACHING";
  if (review.missedSessionsCount >= 3) return "DISTRIBUTION_SHORTFALL";

  // Check TID deviation: compare to planned TID baseline (~75/20/5 average)
  const tid = review.actualTID;
  const total = tid.z1 + tid.z2 + tid.z3;
  if (total > 0) {
    const z3Pct = tid.z3 / total;
    if (z3Pct < 0.05 && review.performanceMarkerMissed) {
      return "DISTRIBUTION_SHORTFALL";
    }
  }
  return "UNCLEAR";
}
