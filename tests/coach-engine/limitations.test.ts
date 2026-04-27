import { describe, it, expect } from "vitest";
import {
  kneeScoreFromInputs,
  generateConstraints,
  decideTherapyPhaseTransition,
  computeKneeStatus,
} from "@/lib/coach-engine/limitations";
import type { KneeLog, UserMorningInputs } from "@/lib/coach-engine/types";

const morning = (stiffness: number, stairs: number): UserMorningInputs => ({
  subjectiveRecovery: 7,
  morningStiffness: stiffness,
  stairsScore: stairs,
});

const day = (offset: number) => new Date(new Date("2026-04-26").getTime() + offset * 86400000);

describe("kneeScoreFromInputs", () => {
  it("averages morning stiffness + stairs", () => {
    expect(kneeScoreFromInputs(morning(4, 4))).toBe(4);
    expect(kneeScoreFromInputs(morning(2, 8))).toBe(5);
  });

  it("blends in post-session score with double weight on morning", () => {
    // morning avg = 4, post = 7. (4*2 + 7) / 3 = 5
    expect(kneeScoreFromInputs(morning(4, 4), 7)).toBe(5);
  });

  it("rounds to nearest int", () => {
    // (3 + 4) / 2 = 3.5 → 4
    expect(kneeScoreFromInputs(morning(3, 4))).toBe(4);
  });
});

describe("generateConstraints", () => {
  it("knee >= 8 forces recovery", () => {
    const c = generateConstraints(8, "REMODELING");
    expect(c).toContain("force_recovery_session");
    expect(c).toContain("no_running");
  });

  it("knee 7 blocks high intensity", () => {
    const c = generateConstraints(7, "REMODELING");
    expect(c).toContain("no_high_intensity");
    expect(c).toContain("no_plyo");
  });

  it("knee 5-6 caps strength load + run intensity", () => {
    const c = generateConstraints(5, "REMODELING");
    expect(c).toContain("strength_load_cap_70");
    expect(c).toContain("run_intensity_max_M");
  });

  it("knee < 5 with REACTIVE phase still adds wall sit", () => {
    const c = generateConstraints(3, "REACTIVE");
    expect(c).toContain("add_wall_sit_pre_workout");
    expect(c).toContain("no_threshold_or_higher");
  });

  it("knee < 5 with REMODELING gives monitoring constraint", () => {
    const c = generateConstraints(2, "REMODELING");
    expect(c).toContain("monitor_knee_post_session");
  });

  it("SPORT_SPECIFIC + low knee gives no constraints", () => {
    const c = generateConstraints(2, "SPORT_SPECIFIC");
    expect(c).toEqual([]);
  });

  it("deduplicates", () => {
    const c = generateConstraints(7, "DISREPAIR");
    const unique = [...new Set(c)];
    expect(c).toEqual(unique);
  });
});

describe("decideTherapyPhaseTransition", () => {
  it("REACTIVE → DISREPAIR when avg knee <= 4", () => {
    const scores = [4, 4, 3, 4, 4, 3, 4];
    expect(decideTherapyPhaseTransition("REACTIVE", scores, null, null)).toBe("DISREPAIR");
  });

  it("DISREPAIR → REMODELING when avg knee <= 3", () => {
    const scores = [3, 2, 3, 3, 2, 3, 3];
    expect(decideTherapyPhaseTransition("DISREPAIR", scores, null, null)).toBe("REMODELING");
  });

  it("REMODELING → SPORT_SPECIFIC when avg <= 2 + visa-P high", () => {
    const scores = [2, 2, 1, 2, 2, 1, 2];
    expect(decideTherapyPhaseTransition("REMODELING", scores, 85, 1)).toBe("SPORT_SPECIFIC");
  });

  it("stays in current phase if conditions not met", () => {
    const scores = [5, 5, 5, 5, 5, 5, 5];
    expect(decideTherapyPhaseTransition("REACTIVE", scores, null, null)).toBe("REACTIVE");
  });

  it("returns current phase for empty input", () => {
    expect(decideTherapyPhaseTransition("REACTIVE", [], null, null)).toBe("REACTIVE");
  });
});

describe("computeKneeStatus", () => {
  const recentKneeData: KneeLog[] = Array.from({ length: 14 }, (_, i) => ({
    date: day(-(13 - i)),
    morningStiffness: 4,
    stairsScore: 4,
  }));

  it("aggregates knee score from morning + history", () => {
    const out = computeKneeStatus({ morning: morning(4, 4) }, recentKneeData, "REACTIVE", null);
    expect(out.kneeScoreToday).toBe(4);
    expect(out.kneeBaseline28d).toBe(4);
    expect(out.therapyPhase).toBe("DISREPAIR"); // avg 4 → progresses
    expect(out.constraints).toContain("add_wall_sit_pre_workout");
  });

  it("is deterministic", () => {
    const inputs = { morning: morning(3, 3) };
    const a = computeKneeStatus(inputs, recentKneeData, "DISREPAIR", null);
    const b = computeKneeStatus(inputs, recentKneeData, "DISREPAIR", null);
    expect(a).toEqual(b);
  });

  it("handles empty history (uses today as baseline)", () => {
    const out = computeKneeStatus({ morning: morning(5, 5) }, [], "REACTIVE", null);
    expect(out.kneeScoreToday).toBe(5);
    expect(out.kneeBaseline28d).toBe(5);
  });
});
