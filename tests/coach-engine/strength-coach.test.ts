import { describe, it, expect } from "vitest";
import {
  adjustLoadForRPE,
  generateWeekStrengthPlan,
  WALL_SIT,
} from "@/lib/coach-engine/strength-coach";
import type { PhaseConfig, WeekStrengthData } from "@/lib/coach-engine/types";

const block1Config: PhaseConfig = {
  blockNumber: 1,
  phaseName: "ACCUMULATION_AEROBIC_BASE",
  durationWeeks: 4,
  enduranceTID: { z1: 78, z2: 20, z3: 2 },
  strengthMode: "linear_progression",
  strengthRpeCap: 8,
  volumeProgression: "linear_increase",
  vdotTarget: 42,
};

const block5Config: PhaseConfig = {
  ...block1Config,
  blockNumber: 5,
  strengthMode: "minimal",
  strengthRpeCap: 7,
};

describe("adjustLoadForRPE", () => {
  it("increases by 2.5% if RPE < cap-1", () => {
    expect(adjustLoadForRPE(6, 8, 100)).toBeCloseTo(102.5, 1);
  });

  it("increases by 1% if RPE < cap (but not <cap-1)", () => {
    expect(adjustLoadForRPE(7, 8, 100)).toBeCloseTo(101, 1);
  });

  it("holds if RPE = cap", () => {
    expect(adjustLoadForRPE(8, 8, 100)).toBe(100);
  });

  it("holds if RPE = cap+1 (within tolerance)", () => {
    expect(adjustLoadForRPE(9, 8, 100)).toBe(100);
  });

  it("decreases by 5% if RPE > cap+1", () => {
    expect(adjustLoadForRPE(10, 8, 100)).toBeCloseTo(95, 1);
  });

  it("returns 0 for 0 load", () => {
    expect(adjustLoadForRPE(7, 8, 0)).toBe(0);
  });

  it("is deterministic", () => {
    const a = adjustLoadForRPE(7, 8, 80);
    const b = adjustLoadForRPE(7, 8, 80);
    expect(a).toBe(b);
  });
});

describe("generateWeekStrengthPlan", () => {
  const monday = new Date("2026-04-27");

  it("generates 3 sessions for linear_progression mode", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday);
    expect(plan.sessions).toHaveLength(3);
    expect(plan.sessions[0].type).toBe("strength_a");
    expect(plan.sessions[1].type).toBe("strength_b");
    expect(plan.sessions[2].type).toBe("strength_c");
  });

  it("generates 2 sessions for minimal mode (Sprint v1.4: StrA + StrB)", () => {
    const plan = generateWeekStrengthPlan(block5Config, 17, monday);
    expect(plan.sessions).toHaveLength(2);
    expect(plan.sessions[0].type).toBe("strength_a");
    expect(plan.sessions[1].type).toBe("strength_b");
  });

  it("Strength A includes Hex Bar Deadlift", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday);
    const a = plan.sessions[0];
    expect(a.exercises?.some((e) => e.name === "Hex Bar Deadlift")).toBe(true);
  });

  it("Strength C uses Broad Jumps (knee-friendly)", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday);
    const c = plan.sessions[2];
    expect(c.exercises?.some((e) => e.name === "Broad Jumps")).toBe(true);
    // Should NOT have box jumps or depth jumps
    expect(c.exercises?.some((e) => /box|depth/i.test(e.name))).toBe(false);
  });

  it("respects RPE cap from phase config", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday);
    plan.sessions.forEach((s) => {
      s.exercises?.forEach((ex) => {
        if (ex.rpeCap !== undefined) {
          expect(ex.rpeCap).toBeLessThanOrEqual(block1Config.strengthRpeCap);
        }
      });
    });
  });

  it("applies RPE-based progression from previous week", () => {
    const prevWeek: WeekStrengthData = {
      weekNumber: 1,
      sessions: [
        { type: "strength_a", rpeReported: 6 }, // well under cap-1=7 → +2.5%
        { type: "strength_b", rpeReported: 8 },
        { type: "strength_c", rpeReported: 9 },
      ],
    };
    const plan = generateWeekStrengthPlan(block1Config, 2, monday, prevWeek);
    const aDeadlift = plan.sessions[0].exercises?.find((e) => e.name === "Hex Bar Deadlift" && !e.isWarmup);
    expect(aDeadlift?.loadPct).toBeGreaterThan(82); // bumped up from base 82
  });

  it("maintenance mode reduces sets vs linear_progression", () => {
    const linear = generateWeekStrengthPlan(block1Config, 1, monday);
    const maint = generateWeekStrengthPlan(
      { ...block1Config, strengthMode: "maintenance", strengthRpeCap: 7 },
      1,
      monday,
    );
    const linearTotalSets = linear.sessions[0].exercises!.reduce((acc, e) => acc + e.sets, 0);
    const maintTotalSets = maint.sessions[0].exercises!.reduce((acc, e) => acc + e.sets, 0);
    expect(maintTotalSets).toBeLessThan(linearTotalSets);
  });

  it("is deterministic", () => {
    const a = generateWeekStrengthPlan(block1Config, 1, monday);
    const b = generateWeekStrengthPlan(block1Config, 1, monday);
    expect(a).toEqual(b);
  });
});

describe("WALL_SIT", () => {
  it("is exposed and uses 5×45sec format", () => {
    expect(WALL_SIT.sets).toBe(5);
    expect(WALL_SIT.reps).toBe("45sec");
  });
});

describe("therapy phase integration", () => {
  const monday = new Date("2026-04-27");

  it("DISREPAIR therapy → Wall Sit prepended to every strength session", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday, null, "DISREPAIR");
    plan.sessions.forEach((s) => {
      expect(s.exercises?.[0].name).toBe("Wall Sit");
    });
  });

  it("REACTIVE therapy → Wall Sit prepended to every strength session", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday, null, "REACTIVE");
    plan.sessions.forEach((s) => {
      expect(s.exercises?.[0].name).toBe("Wall Sit");
    });
  });

  it("REMODELING therapy → no Wall Sit prepended", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday, null, "REMODELING");
    plan.sessions.forEach((s) => {
      expect(s.exercises?.[0].name).not.toBe("Wall Sit");
    });
  });

  it("null therapy phase → no Wall Sit prepended (back-compat)", () => {
    const plan = generateWeekStrengthPlan(block1Config, 1, monday);
    plan.sessions.forEach((s) => {
      expect(s.exercises?.[0].name).not.toBe("Wall Sit");
    });
  });
});

describe("Exercise tempo + rest defaults", () => {
  const monday = new Date("2026-04-27");
  const plan = generateWeekStrengthPlan(block1Config, 1, monday);

  it("HSR lifts (Hex Bar Deadlift, Romanian Deadlift) use 3-3-1 tempo + ≥120s rest", () => {
    const allExercises = plan.sessions.flatMap((s) => s.exercises ?? []);
    const hsrLifts = allExercises.filter((ex) =>
      /Hex Bar Deadlift|Romanian Deadlift/i.test(ex.name) && !ex.isWarmup,
    );
    expect(hsrLifts.length).toBeGreaterThan(0);
    hsrLifts.forEach((ex) => {
      expect(ex.tempo).toBe("3-3-1");
      expect(ex.restSec ?? 0).toBeGreaterThanOrEqual(120);
    });
  });

  it("every non-isometric exercise has restSec defined", () => {
    const allExercises = plan.sessions.flatMap((s) => s.exercises ?? []);
    allExercises.forEach((ex) => {
      // restSec is required on all template exercises. Sprint v1.5: order-1
      // of a superset can be 0 (immediate transition to the antagonist).
      expect(ex.restSec).toBeDefined();
      expect(ex.restSec).toBeGreaterThanOrEqual(0);
    });
  });
});
