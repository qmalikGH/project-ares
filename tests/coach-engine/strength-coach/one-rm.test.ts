// Sprint v0.11 — pure-function tests for the 1RM estimator. No DB, no I/O.
import { describe, it, expect } from "vitest";

import {
  estimateOneRM,
  loadPctToKg,
  rollingOneRMEstimate,
  checkOneRMDivergence,
} from "@/lib/coach-engine/strength-coach/one-rm";

describe("estimateOneRM (Epley)", () => {
  it("returns the canonical Epley value for 100kg × 5 reps (no RPE)", () => {
    // Epley: 100 × (1 + 5/30) = 100 × 1.1667 = 116.67 → 116.7 kg
    expect(estimateOneRM(100, 5)).toBe(116.7);
  });

  it("applies RIR correction when RPE 8 is provided", () => {
    // RPE 8 → 2 RIR → effectiveReps = 5 + 2 = 7
    // 100 × (1 + 7/30) = 100 × 1.2333 = 123.33 → 123.3 kg
    expect(estimateOneRM(100, 5, 8)).toBe(123.3);
  });

  it("treats RPE 10 as a true max (no RIR added)", () => {
    expect(estimateOneRM(100, 5, 10)).toBe(estimateOneRM(100, 5));
  });

  it("ignores out-of-range RPE values (<6 or >10)", () => {
    expect(estimateOneRM(100, 5, 5)).toBe(estimateOneRM(100, 5));
    expect(estimateOneRM(100, 5, 11)).toBe(estimateOneRM(100, 5));
  });

  it("returns 0 for invalid inputs", () => {
    expect(estimateOneRM(0, 5)).toBe(0);
    expect(estimateOneRM(100, 0)).toBe(0);
    expect(estimateOneRM(-50, 5)).toBe(0);
  });

  it("is deterministic (same inputs → same output)", () => {
    const a = estimateOneRM(120, 4, 8);
    const b = estimateOneRM(120, 4, 8);
    expect(a).toBe(b);
  });
});

describe("loadPctToKg", () => {
  it("snaps 120kg × 82% to 97.5 kg (nearest 2.5kg plate)", () => {
    // 120 × 0.82 = 98.4, rounds DOWN to 97.5 (nearest 2.5)
    expect(loadPctToKg(120, 82)).toBe(97.5);
  });

  it("snaps 80kg × 70% to 55.0 kg", () => {
    // 80 × 0.70 = 56.0, rounds DOWN to 55.0 (nearest 2.5)
    expect(loadPctToKg(80, 70)).toBe(55);
  });

  it("returns 0 for invalid inputs", () => {
    expect(loadPctToKg(0, 80)).toBe(0);
    expect(loadPctToKg(100, 0)).toBe(0);
    expect(loadPctToKg(-50, 80)).toBe(0);
  });

  it("rounds up when raw value is closer to next plate", () => {
    // 100 × 0.94 = 94.0 → 95.0 (closer to 95 than 92.5)
    expect(loadPctToKg(100, 94)).toBe(95);
  });
});

describe("rollingOneRMEstimate", () => {
  it("returns the median of per-set Epley estimates", () => {
    // Estimates: [100×5=116.7, 105×5=122.5, 110×5=128.3]
    // Sorted: [116.7, 122.5, 128.3] → median = 122.5
    const result = rollingOneRMEstimate([
      { weightKg: 100, reps: 5 },
      { weightKg: 105, reps: 5 },
      { weightKg: 110, reps: 5 },
    ]);
    expect(result).toBe(122.5);
  });

  it("averages the two middle values for an even number of sets", () => {
    // Estimates sorted: [116.7, 122.5] → median = (116.7 + 122.5) / 2 = 119.6
    const result = rollingOneRMEstimate([
      { weightKg: 100, reps: 5 },
      { weightKg: 105, reps: 5 },
    ]);
    expect(result).toBe(119.6);
  });

  it("returns null when fewer than 2 data points exist", () => {
    expect(rollingOneRMEstimate([])).toBeNull();
    expect(rollingOneRMEstimate([{ weightKg: 100, reps: 5 }])).toBeNull();
  });

  it("uses RIR correction per-set when RPE is provided", () => {
    // Set 1: 100 × 5 @ RPE 8 → effective 7 reps → 100 × (1 + 7/30) = 123.3
    // Set 2: 100 × 5 @ RPE 10 (max effort) → 116.7
    // Median (even): (116.7 + 123.3) / 2 = 120.0
    const result = rollingOneRMEstimate([
      { weightKg: 100, reps: 5, rpe: 8 },
      { weightKg: 100, reps: 5, rpe: 10 },
    ]);
    expect(result).toBe(120);
  });
});

describe("checkOneRMDivergence", () => {
  it("flags divergence when engine estimate is +12.5% above manual", () => {
    // 120 vs 135: pctDiff = (135-120)/120 × 100 = 12.5%
    const result = checkOneRMDivergence(120, 135);
    expect(result).not.toBeNull();
    expect(result!.divergent).toBe(true);
    expect(result!.pctDiff).toBe(12.5);
    expect(result!.suggestion).toContain("über");
  });

  it("flags divergence when engine estimate is below manual", () => {
    // 120 vs 100: pctDiff = (100-120)/120 × 100 ≈ -16.67%
    const result = checkOneRMDivergence(120, 100);
    expect(result).not.toBeNull();
    expect(result!.divergent).toBe(true);
    expect(result!.pctDiff).toBeLessThan(0);
    expect(result!.suggestion).toContain("unter");
  });

  it("returns null when values agree within ±10%", () => {
    // 120 vs 125: pctDiff = +4.17% → within tolerance
    expect(checkOneRMDivergence(120, 125)).toBeNull();
    // exactly +10% is also within tolerance
    expect(checkOneRMDivergence(100, 110)).toBeNull();
  });

  it("returns null for invalid inputs", () => {
    expect(checkOneRMDivergence(0, 100)).toBeNull();
    expect(checkOneRMDivergence(100, 0)).toBeNull();
    expect(checkOneRMDivergence(-50, 100)).toBeNull();
  });
});
