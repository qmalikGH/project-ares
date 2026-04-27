import { describe, it, expect } from "vitest";
import {
  generateMacrocycle,
  getCurrentPhase,
  getNextPhaseName,
  decidePhaseTransition,
  analyzeRootCause,
} from "@/lib/coach-engine/periodization";
import type { BlockReviewInput, GoalInput } from "@/lib/coach-engine/types";

const qGoal: GoalInput = {
  primaryType: "5k_time",
  currentValue: { time: "24:30", date: new Date("2026-04-26") },
  targetValue: { time: "22:00", date: new Date("2026-09-15") },
  modality: "hybrid",
  constraints: [{ type: "patellar_tendinopathy", severity: "active" }],
  preferences: { strengthPerWeek: 3, maxTrainingDays: 6 },
  startDate: new Date("2026-04-27"),
  vdotInitial: 42,
};

describe("generateMacrocycle", () => {
  it("generates 20 weeks across 5 blocks", () => {
    const m = generateMacrocycle(qGoal);
    expect(m.totalWeeks).toBe(20);
    expect(m.phases).toHaveLength(5);
  });

  it("each phase is 4 weeks", () => {
    const m = generateMacrocycle(qGoal);
    m.phases.forEach((p) => {
      expect(p.endWeek - p.startWeek + 1).toBe(4);
    });
  });

  it("phase names follow expected progression", () => {
    const m = generateMacrocycle(qGoal);
    expect(m.phases[0].phaseName).toBe("ACCUMULATION_AEROBIC_BASE");
    expect(m.phases[1].phaseName).toBe("ACCUMULATION_THRESHOLD_INTRO");
    expect(m.phases[2].phaseName).toBe("TRANSMUTATION_THRESHOLD");
    expect(m.phases[3].phaseName).toBe("TRANSMUTATION_VO2MAX");
    expect(m.phases[4].phaseName).toBe("REALIZATION_PEAK_PERFORMANCE");
  });

  it("VDOT targets ramp 42 → 47", () => {
    const m = generateMacrocycle(qGoal);
    expect(m.phases[0].vdotTarget).toBe(42);
    expect(m.phases[4].vdotTarget).toBe(47);
  });

  it("performance marker weeks are end of each block", () => {
    const m = generateMacrocycle(qGoal);
    expect(m.performanceMarkerWeeks).toEqual([4, 8, 12, 16, 20]);
  });

  it("Block 4 has Z3=15% TID (VO2max heavy)", () => {
    const m = generateMacrocycle(qGoal);
    expect(m.phases[3].config.enduranceTID.z3).toBe(15);
  });

  it("is deterministic", () => {
    const a = generateMacrocycle(qGoal);
    const b = generateMacrocycle(qGoal);
    expect(a.phases.map((p) => p.phaseName)).toEqual(b.phases.map((p) => p.phaseName));
  });
});

describe("getCurrentPhase", () => {
  const macro = generateMacrocycle(qGoal);

  it("returns Block 1 in W1", () => {
    const phase = getCurrentPhase(macro, new Date("2026-04-30"));
    expect(phase.blockNumber).toBe(1);
  });

  it("returns Block 3 in W10", () => {
    const phase = getCurrentPhase(macro, new Date("2026-07-04"));
    expect(phase.blockNumber).toBe(3);
  });

  it("returns last phase when past end", () => {
    const phase = getCurrentPhase(macro, new Date("2027-01-01"));
    expect(phase.blockNumber).toBe(5);
  });

  it("returns first phase when before start", () => {
    const phase = getCurrentPhase(macro, new Date("2025-01-01"));
    expect(phase.blockNumber).toBe(1);
  });
});

describe("getNextPhaseName", () => {
  it("Block 1 → Block 2", () => {
    expect(getNextPhaseName("ACCUMULATION_AEROBIC_BASE")).toBe("ACCUMULATION_THRESHOLD_INTRO");
  });

  it("returns null at end", () => {
    expect(getNextPhaseName("REALIZATION_PEAK_PERFORMANCE")).toBeNull();
  });
});

const happyReview: BlockReviewInput = {
  performanceMarkerMet: true,
  performanceMarkerClose: false,
  performanceMarkerMissed: false,
  healthStable: true,
  healthWarning: false,
  healthDecline: false,
  averageACWR: 1.1,
  averageReadiness: 80,
  kneeScoreTrend: "stable",
  missedSessionsCount: 0,
  actualTID: { z1: 78, z2: 20, z3: 2 },
};

describe("decidePhaseTransition", () => {
  it("PROCEED on happy path", () => {
    const d = decidePhaseTransition("ACCUMULATION_AEROBIC_BASE", happyReview);
    expect(d.decision).toBe("PROCEED");
    if (d.decision === "PROCEED") {
      expect(d.nextPhase).toBe("ACCUMULATION_THRESHOLD_INTRO");
    }
  });

  it("EXTEND_PHASE if close + health warning", () => {
    const d = decidePhaseTransition("ACCUMULATION_AEROBIC_BASE", {
      ...happyReview,
      performanceMarkerMet: false,
      performanceMarkerClose: true,
      healthStable: false,
      healthWarning: true,
    });
    expect(d.decision).toBe("EXTEND_PHASE");
  });

  it("ADJUST_PHASE on health decline", () => {
    const d = decidePhaseTransition("ACCUMULATION_AEROBIC_BASE", {
      ...happyReview,
      performanceMarkerMet: false,
      healthStable: false,
      healthDecline: true,
    });
    expect(d.decision).toBe("ADJUST_PHASE");
  });

  it("DEFER if performance missed and root cause unclear", () => {
    // No health decline, no overreaching, no missed sessions, TID intact
    const d = decidePhaseTransition("TRANSMUTATION_THRESHOLD", {
      ...happyReview,
      performanceMarkerMet: false,
      performanceMarkerMissed: true,
      actualTID: { z1: 75, z2: 17, z3: 8 }, // z3 above 5% threshold
    });
    expect(d.decision).toBe("DEFER");
  });

  it("PROCEED with recoverInNext if missed due to distribution shortfall", () => {
    const d = decidePhaseTransition("TRANSMUTATION_VO2MAX", {
      ...happyReview,
      performanceMarkerMet: false,
      performanceMarkerMissed: true,
      missedSessionsCount: 5,
    });
    expect(d.decision).toBe("PROCEED");
    if (d.decision === "PROCEED") {
      expect(d.recoverInNext).toBe(true);
    }
  });

  it("at end of macrocycle, nextPhase is null", () => {
    const d = decidePhaseTransition("REALIZATION_PEAK_PERFORMANCE", happyReview);
    if (d.decision === "PROCEED") {
      expect(d.nextPhase).toBeNull();
    }
  });
});

describe("analyzeRootCause", () => {
  it("returns HEALTH_DECLINE when knee trending down", () => {
    const cause = analyzeRootCause({ ...happyReview, kneeScoreTrend: "declining", performanceMarkerMissed: true });
    expect(cause).toBe("HEALTH_DECLINE");
  });

  it("returns OVERREACHING when ACWR > 1.3", () => {
    const cause = analyzeRootCause({ ...happyReview, averageACWR: 1.45, performanceMarkerMissed: true });
    expect(cause).toBe("OVERREACHING");
  });

  it("returns DISTRIBUTION_SHORTFALL when many sessions missed", () => {
    const cause = analyzeRootCause({ ...happyReview, missedSessionsCount: 5, performanceMarkerMissed: true });
    expect(cause).toBe("DISTRIBUTION_SHORTFALL");
  });

  it("returns UNCLEAR when no signal", () => {
    const cause = analyzeRootCause({ ...happyReview, performanceMarkerMissed: false });
    expect(cause).toBe("UNCLEAR");
  });
});
