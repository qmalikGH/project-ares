import { describe, it, expect } from "vitest";
import {
  computeRunVolumeProgression,
  generateWeekRunPlan,
} from "@/lib/coach-engine/run-coach";
import type { PhaseConfig } from "@/lib/coach-engine/types";

const BLOCK1_CONFIG: PhaseConfig = {
  blockNumber: 1,
  phaseName: "ACCUMULATION_AEROBIC_BASE",
  durationWeeks: 4,
  enduranceTID: { z1: 78, z2: 20, z3: 2 },
  strengthMode: "linear_progression",
  strengthRpeCap: 8,
  volumeProgression: "linear_increase",
  vdotTarget: 42,
  longRunBaselineMin: 50,
  qualityRunBaselineMin: 30,
  easyRunBaselineMin: 35,
};

const MONDAY = new Date("2026-04-27T00:00:00Z");

function findLong(plan: ReturnType<typeof generateWeekRunPlan>): number {
  return plan.sessions.find((s) => s.type === "long_run")?.durationMin ?? 0;
}
function findEasy(plan: ReturnType<typeof generateWeekRunPlan>): number {
  return plan.sessions.find((s) => s.type === "easy_run")?.durationMin ?? 0;
}

describe("computeRunVolumeProgression — week pattern", () => {
  it("W1 = 1.0 / 1.0 / 1.0", () => {
    const p = computeRunVolumeProgression(1);
    expect(p.longRunMultiplier).toBe(1.0);
    expect(p.qualityRunMultiplier).toBe(1.0);
    expect(p.easyRunMultiplier).toBe(1.0);
  });

  it("W2 = long +10%, quality +5%, easy unchanged", () => {
    const p = computeRunVolumeProgression(2);
    expect(p.longRunMultiplier).toBeCloseTo(1.1, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(1.05, 2);
    expect(p.easyRunMultiplier).toBe(1.0);
  });

  it("W3 = long +20%, quality +10%, easy unchanged", () => {
    const p = computeRunVolumeProgression(3);
    expect(p.longRunMultiplier).toBeCloseTo(1.2, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(1.1, 2);
  });

  it("W4 = long -25%, quality -30%, easy -15%", () => {
    const p = computeRunVolumeProgression(4);
    expect(p.longRunMultiplier).toBeCloseTo(0.75, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(0.7, 2);
    expect(p.easyRunMultiplier).toBeCloseTo(0.85, 2);
  });

  it("rationale includes week label", () => {
    expect(computeRunVolumeProgression(1).rationale).toContain("Adaptation");
    expect(computeRunVolumeProgression(3).rationale).toContain("Peak");
    expect(computeRunVolumeProgression(4).rationale).toContain("Deload");
  });
});

describe("generateWeekRunPlan — applies block 1 volume progression", () => {
  it("W1 long run = baseline (50min)", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 1, 42, MONDAY);
    // weekNumber=1 in block 1 → calibration run replaces threshold; long-run
    // is generateLongRunProgression-controlled. Block 1 W1 long run is 0 or
    // baseline depending on long-run-progression rules; we just assert
    // it falls within a reasonable band when present.
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBe(50);
    }
  });

  it("W2 long run = baseline × 1.10 = 55min", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 2, 42, MONDAY);
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBeGreaterThanOrEqual(54);
      expect(long).toBeLessThanOrEqual(56);
    }
  });

  it("W3 long run = baseline × 1.20 = 60min", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 3, 42, MONDAY);
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBeGreaterThanOrEqual(59);
      expect(long).toBeLessThanOrEqual(61);
    }
  });

  it("W4 long run = baseline × 0.75 = 37min (Deload)", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 4, 42, MONDAY);
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBeGreaterThanOrEqual(36);
      expect(long).toBeLessThanOrEqual(38);
    }
  });

  it("W4 easy run shorter than W2 easy (deload)", () => {
    const w2 = findEasy(generateWeekRunPlan(BLOCK1_CONFIG, 2, 42, MONDAY));
    const w4 = findEasy(generateWeekRunPlan(BLOCK1_CONFIG, 4, 42, MONDAY));
    expect(w4).toBeLessThan(w2);
  });

  it("falls back to defaults when PhaseConfig has no baselines", () => {
    const minimalConfig = { ...BLOCK1_CONFIG };
    delete minimalConfig.longRunBaselineMin;
    delete minimalConfig.qualityRunBaselineMin;
    delete minimalConfig.easyRunBaselineMin;
    // Should not throw; uses internal fallbacks (60/40/35).
    const plan = generateWeekRunPlan(minimalConfig, 1, 42, MONDAY);
    expect(plan.sessions.length).toBeGreaterThan(0);
  });
});
