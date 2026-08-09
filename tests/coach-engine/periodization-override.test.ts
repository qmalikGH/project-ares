// Sprint v1.5 — loadOverrideWeek tests.
//
// Verifies that the periodization engine applies the LOAD multiplier from a
// target week-in-block while keeping the row's actual weekInBlock's SETS and
// RPE-cap. Use case: post-illness ramp-up where W1 volume is paired with
// W2-calibrated loads.

import { describe, it, expect } from "vitest";
import {
  computePeriodizationAdjustment,
  type PeriodizationContext,
} from "@/lib/coach-engine/strength-coach/periodization";

const BASE: PeriodizationContext = {
  weekInBlock: 1,
  blockNumber: 1,
  prevShinPainNrs: null,
  prevRpeReported: null,
  baselineRpeCap: 8,
  strengthMode: "linear_progression",
};

describe("loadOverrideWeek (Sprint v1.5)", () => {
  it("W1 + override W2 → load 1.025 (W2), sets 1.0 (W1), rpe 0 (W1)", () => {
    const adj = computePeriodizationAdjustment({ ...BASE, weekInBlock: 1, loadOverrideWeek: 2 });
    expect(adj.loadMultiplier).toBeCloseTo(1.025, 3);
    expect(adj.setMultiplier).toBeCloseTo(1.0, 3);
    expect(adj.rpeCapDelta).toBe(0);
    expect(adj.rationale).toContain("Load-Override");
    expect(adj.rationale).toContain("W2");
  });

  it("W1 + override W3 → load 1.05 (W3), but still W1 volume + RPE", () => {
    const adj = computePeriodizationAdjustment({ ...BASE, weekInBlock: 1, loadOverrideWeek: 3 });
    expect(adj.loadMultiplier).toBeCloseTo(1.05, 3);
    expect(adj.setMultiplier).toBeCloseTo(1.0, 3); // NOT 1.33
    expect(adj.rpeCapDelta).toBe(0); // NOT +1
  });

  it("W1 + override null → normal W1 baseline (no override)", () => {
    const adj = computePeriodizationAdjustment({ ...BASE, weekInBlock: 1, loadOverrideWeek: null });
    expect(adj.loadMultiplier).toBeCloseTo(1.0, 3);
    expect(adj.rationale).not.toContain("Load-Override");
  });

  it("W1 + override W1 (same week) → no override applied", () => {
    const adj = computePeriodizationAdjustment({ ...BASE, weekInBlock: 1, loadOverrideWeek: 1 });
    expect(adj.loadMultiplier).toBeCloseTo(1.0, 3);
    expect(adj.rationale).not.toContain("Load-Override");
  });

  it("W2 + override W3 → load 1.05, but W2 still has no set bump", () => {
    const adj = computePeriodizationAdjustment({ ...BASE, weekInBlock: 2, loadOverrideWeek: 3 });
    expect(adj.loadMultiplier).toBeCloseTo(1.05, 3);
    expect(adj.setMultiplier).toBeCloseTo(1.0, 3);
  });

  it("override + RPE-pullback (last too hard) still applies RPE adjustment", () => {
    // baseline RPE = 8, last reported = 10 → -5% pullback
    const adj = computePeriodizationAdjustment({
      ...BASE,
      weekInBlock: 1,
      loadOverrideWeek: 2,
      prevRpeReported: 10,
    });
    // 1.025 (override) × 0.95 (RPE pullback) ≈ 0.974
    expect(adj.loadMultiplier).toBeCloseTo(1.025 * 0.95, 3);
  });

  it("undefined loadOverrideWeek is treated like null", () => {
    const adj = computePeriodizationAdjustment({ ...BASE, weekInBlock: 1 });
    expect(adj.loadMultiplier).toBeCloseTo(1.0, 3);
  });
});

// Sprint 2.4 — comeback ramp on the strength side.
describe("comebackWeek ramp (Sprint 2.4)", () => {
  it("scales load 0.75 / 0.85 / 0.95 across the three ramp weeks", () => {
    expect(
      computePeriodizationAdjustment({ ...BASE, comebackWeek: 1 }).loadMultiplier,
    ).toBeCloseTo(0.75, 3);
    expect(
      computePeriodizationAdjustment({ ...BASE, comebackWeek: 2 }).loadMultiplier,
    ).toBeCloseTo(0.85, 3);
    expect(
      computePeriodizationAdjustment({ ...BASE, comebackWeek: 3 }).loadMultiplier,
    ).toBeCloseTo(0.95, 3);
  });

  it("week 1 also drops volume (≈ one set less); weeks 2-3 keep block volume", () => {
    expect(
      computePeriodizationAdjustment({ ...BASE, comebackWeek: 1 }).setMultiplier,
    ).toBeCloseTo(0.75, 3);
    expect(
      computePeriodizationAdjustment({ ...BASE, comebackWeek: 2 }).setMultiplier,
    ).toBeCloseTo(1.0, 3);
  });

  it("compounds with the week-in-block pattern rather than replacing it", () => {
    // W3 is +5% load; a comeback week 1 on top must land at 1.05 × 0.75.
    const adj = computePeriodizationAdjustment({ ...BASE, weekInBlock: 3, comebackWeek: 1 });
    expect(adj.loadMultiplier).toBeCloseTo(1.05 * 0.75, 3);
    // …and the W3 +33% set bump is damped, not cancelled.
    expect(adj.setMultiplier).toBeCloseTo(1.33 * 0.75, 3);
    expect(adj.rpeCapDelta).toBe(1); // RPE cap still follows the real week
  });

  it("applies after loadOverrideWeek so the ramp always has the last word", () => {
    const adj = computePeriodizationAdjustment({
      ...BASE,
      weekInBlock: 1,
      loadOverrideWeek: 3, // would raise load to 1.05
      comebackWeek: 1,
    });
    expect(adj.loadMultiplier).toBeCloseTo(1.05 * 0.75, 3);
  });

  it("names itself in the rationale so the UI can explain the lighter week", () => {
    const adj = computePeriodizationAdjustment({ ...BASE, comebackWeek: 1 });
    expect(adj.rationale).toContain("Wiedereinstieg W1");
    expect(adj.rationale).toContain("Trainingspause");
  });

  it("null / undefined comebackWeek is a no-op (back-compat)", () => {
    const off = computePeriodizationAdjustment({ ...BASE, comebackWeek: null });
    const omitted = computePeriodizationAdjustment({ ...BASE });
    expect(off.loadMultiplier).toBeCloseTo(omitted.loadMultiplier, 6);
    expect(off.setMultiplier).toBeCloseTo(omitted.setMultiplier, 6);
    expect(off.rationale).toBe(omitted.rationale);
  });
});
