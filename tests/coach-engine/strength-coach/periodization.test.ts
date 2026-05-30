import { describe, it, expect } from "vitest";
import {
  applyPeriodization,
  computePeriodizationAdjustment,
  getPeriodizationLabel,
  weekInBlockOf,
  type PeriodizationContext,
} from "@/lib/coach-engine/strength-coach/periodization";
import type { Exercise } from "@/lib/coach-engine/types";

const BASE_CTX: PeriodizationContext = {
  weekInBlock: 1,
  blockNumber: 1,
  prevShinPainNrs: null,
  prevRpeReported: null,
  baselineRpeCap: 8,
  strengthMode: "linear_progression",
};

const HEX_BAR: Exercise = {
  name: "Hex Bar Deadlift",
  sets: 4,
  reps: 5,
  loadPct: 82,
  rpeCap: 8,
  tempo: "3-3-1",
  restSec: 180,
};

const BENCH: Exercise = {
  name: "Bench Press",
  sets: 3,
  reps: 8,
  loadPct: 75,
  rpeCap: 8,
  tempo: "2-1-1",
  restSec: 120,
};

const PALLOF: Exercise = {
  name: "Pallof Press",
  sets: 3,
  reps: "10/side",
  rpeCap: 6,
  tempo: "1-2-1",
  restSec: 60,
};

describe("computePeriodizationAdjustment — week pattern", () => {
  it("W1 = baseline (1.0 / 1.0 / 0)", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 1 });
    expect(adj.loadMultiplier).toBe(1.0);
    expect(adj.setMultiplier).toBe(1.0);
    expect(adj.rpeCapDelta).toBe(0);
  });

  it("W2 = +2.5% load, same volume", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 2 });
    expect(adj.loadMultiplier).toBeCloseTo(1.025, 3);
    expect(adj.setMultiplier).toBe(1.0);
    expect(adj.rpeCapDelta).toBe(0);
  });

  it("W3 = +5% load, +33% sets, +1 RPE-cap", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 3 });
    expect(adj.loadMultiplier).toBeCloseTo(1.05, 3);
    expect(adj.setMultiplier).toBeCloseTo(1.33, 2);
    expect(adj.rpeCapDelta).toBe(1);
  });

  it("W4 = 85% load, 67% sets, -1 RPE-cap (linear_progression default)", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 4 });
    expect(adj.loadMultiplier).toBeCloseTo(0.85, 3);
    expect(adj.setMultiplier).toBeCloseTo(0.67, 2);
    expect(adj.rpeCapDelta).toBe(-1);
  });
});

describe("computePeriodizationAdjustment — W4 setMultiplier per strengthMode (Sprint v1.4)", () => {
  it("linear_progression mode → W4 setMultiplier 0.67 (unchanged)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 4,
      strengthMode: "linear_progression",
    });
    expect(adj.setMultiplier).toBeCloseTo(0.67, 2);
    expect(adj.rationale).toContain("67%");
  });

  it("maintenance mode → W4 setMultiplier 0.80 (softer deload)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 4,
      strengthMode: "maintenance",
    });
    expect(adj.setMultiplier).toBeCloseTo(0.80, 2);
    expect(adj.rationale).toContain("maintenance-adjusted");
    expect(adj.rationale).toContain("80%");
  });

  it("minimal mode → W4 setMultiplier 0.80 (same softening)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 4,
      strengthMode: "minimal",
    });
    expect(adj.setMultiplier).toBeCloseTo(0.80, 2);
  });
});

describe("computePeriodizationAdjustment — pain overrides", () => {
  it("NRS = 6 → painSteppedBack=true (no painLockedHsr)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 2,
      prevShinPainNrs: 6,
    });
    expect(adj.painSteppedBack).toBe(true);
    expect(adj.painLockedHsr).toBe(false);
    expect(adj.rationale).toContain("pain-stepped-back");
  });

  it("NRS = 4 → painLockedHsr=true (hold, no progression for HSR)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 2,
      prevShinPainNrs: 4,
    });
    expect(adj.painLockedHsr).toBe(true);
    expect(adj.painSteppedBack).toBe(false);
    expect(adj.rationale).toContain("pain-locked");
  });

  it("NRS = 5 → painLockedHsr=true (5 is hold, not stepped-back)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 3,
      prevShinPainNrs: 5,
    });
    expect(adj.painLockedHsr).toBe(true);
    expect(adj.painSteppedBack).toBe(false);
  });

  it("NRS ≤ 3 → no pain override (full progression)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 2,
      prevShinPainNrs: 2,
    });
    expect(adj.painLockedHsr).toBe(false);
    expect(adj.painSteppedBack).toBe(false);
    expect(adj.loadMultiplier).toBeCloseTo(1.025, 3);
  });

  it("prevShinPainNrs = null → neither flag set", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      prevShinPainNrs: null,
    });
    expect(adj.painLockedHsr).toBe(false);
    expect(adj.painSteppedBack).toBe(false);
  });
});

describe("computePeriodizationAdjustment — RPE feedback", () => {
  it("prev RPE much below cap → ×1.01 bump", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 1,
      prevRpeReported: 5, // baseline cap 8, threshold = cap-2 = 6
    });
    expect(adj.loadMultiplier).toBeCloseTo(1.01, 3);
    expect(adj.rationale).toContain("RPE bump");
  });

  it("prev RPE above cap+1 → ×0.95 pullback", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 1,
      prevRpeReported: 10, // cap+1 = 9, > 9 triggers
    });
    expect(adj.loadMultiplier).toBeCloseTo(0.95, 3);
    expect(adj.rationale).toContain("pullback");
  });

  it("prev RPE in normal band → no adjustment", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 2,
      prevRpeReported: 8,
    });
    expect(adj.loadMultiplier).toBeCloseTo(1.025, 3); // unchanged W2 base
  });

  it("compounds with week pattern (W2 + RPE bump = 1.025*1.01)", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 2,
      prevRpeReported: 5,
    });
    expect(adj.loadMultiplier).toBeCloseTo(1.025 * 1.01, 4);
  });
});

describe("applyPeriodization — HSR rules", () => {
  it("HSR with painSteppedBack: load ×0.95, no extra sets", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 3,
      prevShinPainNrs: 6, // step back
    });
    const [hex] = applyPeriodization([HEX_BAR], adj);
    expect(hex.loadPct).toBeCloseTo(82 * 0.95, 1);
    expect(hex.sets).toBe(4); // unchanged
  });

  it("HSR with painLockedHsr: load unchanged in W2", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 2,
      prevShinPainNrs: 4,
    });
    const [hex] = applyPeriodization([HEX_BAR], adj);
    expect(hex.loadPct).toBe(82); // same as W1
  });

  it("HSR in W3 NEVER gets +1 set (cap at setMult 1.0)", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 3 });
    const [hex] = applyPeriodization([HEX_BAR], adj);
    expect(hex.sets).toBe(4); // not 4 * 1.33 ≈ 5
    expect(hex.loadPct).toBeCloseTo(82 * 1.05, 1);
  });

  it("HSR in W4 deload: load ×0.85, sets ×0.67 (capped at 1.0 still applies → 0.67)", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 4 });
    const [hex] = applyPeriodization([HEX_BAR], adj);
    expect(hex.loadPct).toBeCloseTo(82 * 0.85, 1);
    // setMult 0.67, applied: 4 * 0.67 = 2.68 → 3 (rounded), and min 2
    expect(hex.sets).toBeGreaterThanOrEqual(2);
    expect(hex.sets).toBeLessThanOrEqual(4);
  });
});

describe("applyPeriodization — non-HSR rules", () => {
  it("Bench in W3: +1 set (3 → 4), +5% load", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 3 });
    const [bench] = applyPeriodization([BENCH], adj);
    expect(bench.sets).toBe(4); // 3 * 1.33 = 3.99 → 4
    expect(bench.loadPct).toBeCloseTo(75 * 1.05, 1);
    expect(bench.rpeCap).toBe(9); // 8 + 1
  });

  it("Pallof Press has no loadPct → load multiplier no-op", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 2 });
    const [pallof] = applyPeriodization([PALLOF], adj);
    expect(pallof.loadPct).toBeUndefined();
    expect(pallof.sets).toBe(3); // setMult 1.0 in W2
  });

  it("rpeCap clamped to [5, 10]", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE_CTX,
      weekInBlock: 4, // -1 cap
    });
    const lowCap: Exercise = { ...BENCH, rpeCap: 5 };
    const [out] = applyPeriodization([lowCap], adj);
    expect(out.rpeCap).toBe(5); // not 4
  });
});

describe("applyPeriodization — purity", () => {
  it("does not mutate input array or items", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 3 });
    const input = [HEX_BAR, BENCH];
    const before = JSON.stringify(input);
    applyPeriodization(input, adj);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("getPeriodizationLabel + weekInBlockOf", () => {
  it("labels by week", () => {
    expect(getPeriodizationLabel(1)).toBe("Adaptation");
    expect(getPeriodizationLabel(2)).toBe("Build 1");
    expect(getPeriodizationLabel(3)).toBe("Build 2 / Peak");
    expect(getPeriodizationLabel(4)).toBe("Deload");
  });

  it("weekInBlockOf maps macrocycle weekNumber to W1-W4 within phase", () => {
    // Phase 1 = weeks 1-4
    expect(weekInBlockOf(1, 4)).toBe(1);
    expect(weekInBlockOf(2, 4)).toBe(2);
    expect(weekInBlockOf(3, 4)).toBe(3);
    expect(weekInBlockOf(4, 4)).toBe(4);
    // Phase 2 = weeks 5-8 (week 5 = W1 of block 2)
    expect(weekInBlockOf(5, 4)).toBe(1);
    expect(weekInBlockOf(8, 4)).toBe(4);
  });

  it("rationale includes week label", () => {
    const adj = computePeriodizationAdjustment({ ...BASE_CTX, weekInBlock: 3 });
    expect(adj.rationale).toContain("W3");
    expect(adj.rationale).toContain("Peak");
  });
});
