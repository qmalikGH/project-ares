// Deficit taper / goal-weight stop — Sprint 2.7 (A5).
//
// Before this module the deficit had no end condition at all: `targetWeightKg`
// was drawn on a chart and read by the export, but never compared to the
// athlete's actual mass. These tests pin the controller, especially the two
// ways it could go wrong — compounding itself to zero, or latching at
// maintenance because it read the goal as if it were a measurement.
import { describe, expect, it } from "vitest";

import {
  DEFICIT_RESUME_MARGIN_KG,
  DEFICIT_TAPER_BAND_KG,
  MIN_MEANINGFUL_DEFICIT_KCAL,
  resolveDeficitKcal,
} from "@/lib/nutrition/deficit";

const BASE = 300;
const TARGET = 84;
const NO_CAP = 10_000;

function resolve(avg: number | null, current: number | null = BASE, target: number | null = TARGET, cap = NO_CAP) {
  return resolveDeficitKcal({
    avg7dWeightKg: avg,
    targetWeightKg: target,
    currentDeficitKcal: current,
    baseDeficitKcal: BASE,
    gartheCapKcal: cap,
  });
}

describe("resolveDeficitKcal — bands", () => {
  it("full deficit while clearly above the target", () => {
    const r = resolve(88.0);
    expect(r.mode).toBe("full");
    expect(r.deficitKcal).toBe(300);
  });

  it("full deficit right at the top of the taper band", () => {
    expect(resolve(TARGET + DEFICIT_TAPER_BAND_KG + 0.1).mode).toBe("full");
  });

  it("tapers inside the band", () => {
    const r = resolve(85.0); // 1.0 kg above target of a 1.5 kg band
    expect(r.mode).toBe("taper");
    expect(r.deficitKcal).toBe(200); // 300 × 1.0/1.5 = 200
  });

  it("keeps tapered values on 25-kcal steps", () => {
    for (const avg of [84.2, 84.5, 84.9, 85.2, 85.4]) {
      expect(resolve(avg).deficitKcal % 25).toBe(0);
    }
  });

  it("drops to maintenance when the tapered value is noise", () => {
    const r = resolve(84.2); // 300 × 0.2/1.5 = 40 < 100
    expect(r.mode).toBe("maintenance");
    expect(r.deficitKcal).toBe(0);
    expect(MIN_MEANINGFUL_DEFICIT_KCAL).toBe(100);
  });

  it("maintenance at and below the target", () => {
    expect(resolve(84.0).deficitKcal).toBe(0);
    expect(resolve(83.0).deficitKcal).toBe(0);
    expect(resolve(84.0).mode).toBe("maintenance");
  });
});

describe("resolveDeficitKcal — hysteresis", () => {
  it("stays at maintenance until the resume margin is cleared", () => {
    // Already at maintenance (current = 0), drifting back up but not enough.
    expect(resolve(84.9, 0).mode).toBe("maintenance");
    expect(resolve(TARGET + DEFICIT_RESUME_MARGIN_KG - 0.01, 0).deficitKcal).toBe(0);
  });

  it("resumes once the margin is cleared", () => {
    const r = resolve(TARGET + DEFICIT_RESUME_MARGIN_KG, 0);
    expect(r.mode).not.toBe("maintenance");
    expect(r.deficitKcal).toBeGreaterThan(0);
  });

  it("the same weight resolves differently depending on where it came from", () => {
    // 84.6 kg: coming down it still tapers, coming back up it holds maintenance.
    expect(resolve(84.6, BASE).mode).toBe("taper");
    expect(resolve(84.6, 0).mode).toBe("maintenance");
  });
});

describe("resolveDeficitKcal — does not compound", () => {
  it("re-resolving from a tapered value gives the same answer", () => {
    const first = resolve(85.0, BASE);
    const second = resolve(85.0, first.deficitKcal);
    expect(second.deficitKcal).toBe(first.deficitKcal);
  });
});

describe("resolveDeficitKcal — missing data", () => {
  it("holds the full deficit when the weight average is unavailable", () => {
    const r = resolve(null);
    expect(r.mode).toBe("unknown");
    expect(r.deficitKcal).toBe(300);
  });

  it("holds the full deficit when no target weight is set", () => {
    const r = resolve(88.0, BASE, null);
    expect(r.mode).toBe("unknown");
    expect(r.deficitKcal).toBe(300);
  });

  // The failure mode this guards: if a caller ever substituted targetWeightKg
  // for a real measurement, avg === target would read as "arrived" and pin the
  // deficit at zero forever. Missing data must never mean maintenance.
  it("missing data is never read as having reached the goal", () => {
    expect(resolve(null).deficitKcal).not.toBe(0);
    expect(resolve(null, 0).deficitKcal).not.toBe(0);
  });
});

describe("resolveDeficitKcal — Garthe composition", () => {
  it("the rate cap wins when it is lower than the base", () => {
    const r = resolve(88.0, BASE, TARGET, 250);
    expect(r.deficitKcal).toBe(250);
    expect(r.reason).toContain("Garthe");
  });

  it("the cap also bounds the tapered value", () => {
    const r = resolve(85.0, BASE, TARGET, 150);
    expect(r.deficitKcal).toBeLessThanOrEqual(150);
  });
});
