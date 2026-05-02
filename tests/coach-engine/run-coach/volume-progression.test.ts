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

const BLOCK2_CONFIG: PhaseConfig = {
  ...BLOCK1_CONFIG,
  blockNumber: 2,
  phaseName: "ACCUMULATION_THRESHOLD_INTRO",
};

const MONDAY = new Date("2026-04-27T00:00:00Z");

function findLong(plan: ReturnType<typeof generateWeekRunPlan>): number {
  return plan.sessions.find((s) => s.type === "long_run")?.durationMin ?? 0;
}
function findEasy(plan: ReturnType<typeof generateWeekRunPlan>): number {
  return plan.sessions.find((s) => s.type === "easy_run")?.durationMin ?? 0;
}

// ─────────────────────────────────────────────────────
// Block 1 — Sprint v0.12 conservative ramp (Pillai 2025: training-volume
// is the dominant shin-splint risk factor; runners early in a macrocycle
// need a slower build to grow MTSS-resilience).
// ─────────────────────────────────────────────────────

describe("computeRunVolumeProgression — Block 1 (conservative)", () => {
  it("W1 = 1.0 / 1.0 / 1.0 (baseline)", () => {
    const p = computeRunVolumeProgression(1, 1);
    expect(p.longRunMultiplier).toBe(1.0);
    expect(p.qualityRunMultiplier).toBe(1.0);
    expect(p.easyRunMultiplier).toBe(1.0);
  });

  it("W2 = long +5% (was +10%), quality unchanged, easy unchanged", () => {
    const p = computeRunVolumeProgression(2, 1);
    expect(p.longRunMultiplier).toBeCloseTo(1.05, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(1.0, 2);
    expect(p.easyRunMultiplier).toBe(1.0);
  });

  it("W3 = long +10% (was +20%), quality +5%, easy unchanged", () => {
    const p = computeRunVolumeProgression(3, 1);
    expect(p.longRunMultiplier).toBeCloseTo(1.1, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(1.05, 2);
  });

  it("W4 = long -20%, quality -25%, easy -15% (Deload)", () => {
    const p = computeRunVolumeProgression(4, 1);
    expect(p.longRunMultiplier).toBeCloseTo(0.8, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(0.75, 2);
    expect(p.easyRunMultiplier).toBeCloseTo(0.85, 2);
  });

  it("rationale labels week + block-1 hint", () => {
    expect(computeRunVolumeProgression(1, 1).rationale).toContain("Adaptation");
    expect(computeRunVolumeProgression(2, 1).rationale).toContain("Block 1");
    expect(computeRunVolumeProgression(3, 1).rationale).toContain("Peak");
    expect(computeRunVolumeProgression(4, 1).rationale).toContain("Deload");
  });
});

// ─────────────────────────────────────────────────────
// Block 2+ — standard progression (slightly tamed W3 from +20% to +15%
// per Sprint v0.12). Block 1's caution doesn't extend here: by Block 2
// the runner has 4 weeks of MTSS-conditioning under their belt.
// ─────────────────────────────────────────────────────

describe("computeRunVolumeProgression — Block 2+ (standard)", () => {
  it("W1 = baseline", () => {
    const p = computeRunVolumeProgression(1, 2);
    expect(p.longRunMultiplier).toBe(1.0);
  });

  it("W2 = long +10%, quality +5%", () => {
    const p = computeRunVolumeProgression(2, 2);
    expect(p.longRunMultiplier).toBeCloseTo(1.1, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(1.05, 2);
  });

  it("W3 = long +15% (was +20%), quality +10%", () => {
    const p = computeRunVolumeProgression(3, 2);
    expect(p.longRunMultiplier).toBeCloseTo(1.15, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(1.1, 2);
  });

  it("W4 = long -25%, quality -30%, easy -15% (Deload)", () => {
    const p = computeRunVolumeProgression(4, 2);
    expect(p.longRunMultiplier).toBeCloseTo(0.75, 2);
    expect(p.qualityRunMultiplier).toBeCloseTo(0.7, 2);
    expect(p.easyRunMultiplier).toBeCloseTo(0.85, 2);
  });

  it("Block 3-5 use the same standard progression as Block 2", () => {
    expect(computeRunVolumeProgression(2, 3).longRunMultiplier).toBeCloseTo(
      1.1,
      2,
    );
    expect(computeRunVolumeProgression(3, 5).longRunMultiplier).toBeCloseTo(
      1.15,
      2,
    );
  });
});

describe("computeRunVolumeProgression — default-arg backwards compat", () => {
  it("calling without blockNumber falls back to Block 1 (conservative)", () => {
    expect(computeRunVolumeProgression(2).longRunMultiplier).toBeCloseTo(
      1.05,
      2,
    );
    expect(computeRunVolumeProgression(3).longRunMultiplier).toBeCloseTo(
      1.1,
      2,
    );
  });
});

// ─────────────────────────────────────────────────────
// generateWeekRunPlan integration — verifies the call site passes
// phaseConfig.blockNumber through to the progression computation.
// ─────────────────────────────────────────────────────

  // Sprint v0.13: long run now includes +5 min for pre-run activation (Leppänen 2024).
  // All expected durations are base + ACTIVATION_DURATION_MIN (5).
  const ACT = 5; // ACTIVATION_DURATION_MIN

describe("generateWeekRunPlan — applies block-1 conservative progression", () => {
  it("W1 long run = baseline (50min) + activation", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 1, 42, MONDAY);
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBe(50 + ACT);
    }
  });

  it("W2 long run = baseline × 1.05 ≈ 52-53min + activation (Block 1 conservative)", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 2, 42, MONDAY);
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBeGreaterThanOrEqual(52 + ACT);
      expect(long).toBeLessThanOrEqual(53 + ACT);
    }
  });

  it("W3 long run = baseline × 1.10 = 55min + activation (Block 1 conservative)", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 3, 42, MONDAY);
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBeGreaterThanOrEqual(54 + ACT);
      expect(long).toBeLessThanOrEqual(56 + ACT);
    }
  });

  it("W4 long run = baseline × 0.80 = 40min + activation (Block 1 deload)", () => {
    const plan = generateWeekRunPlan(BLOCK1_CONFIG, 4, 42, MONDAY);
    const long = findLong(plan);
    if (long > 0) {
      expect(long).toBeGreaterThanOrEqual(39 + ACT);
      expect(long).toBeLessThanOrEqual(41 + ACT);
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
    const plan = generateWeekRunPlan(minimalConfig, 1, 42, MONDAY);
    expect(plan.sessions.length).toBeGreaterThan(0);
  });
});

describe("generateWeekRunPlan — Block 2 uses standard progression", () => {
  it("Block 2 W3 long run = baseline × 1.15 (vs Block 1 W3 = 1.10)", () => {
    const b1 = generateWeekRunPlan(BLOCK1_CONFIG, 3, 42, MONDAY);
    const b2 = generateWeekRunPlan(BLOCK2_CONFIG, 7, 42, MONDAY); // weekInBlock=3 in 4-week block
    const longB1 = findLong(b1);
    const longB2 = findLong(b2);
    if (longB1 > 0 && longB2 > 0) {
      expect(longB2).toBeGreaterThan(longB1);
    }
  });
});
