// Sprint v0.14: Gap-Analysis pure function tests.
// Verifies multi-dimensional evaluation, focus suggestion, and target generation.
import { describe, it, expect } from "vitest";

import { evaluateMacrocycle } from "@/lib/coach-engine/goal-hierarchy/gap-analysis";
import type { GoalDimensions } from "@/lib/coach-engine/types";

// ─────────────────────────────────────────────
// Fixtures: Q's real-ish data from first macrocycle
// ─────────────────────────────────────────────

const annualTargets: GoalDimensions = {
  "5k": "20:00",
  "10k": "42:00",
  hexBarDl: 180,
  convDl: 170,
  bench: 110,
  squat: 140,
  weight: 85,
  vo2max: 52,
};

const startValues: GoalDimensions = {
  "5k": "24:30",
  hexBarDl: 140,
  bench: 90,
  weight: 92,
  vo2max: 42,
};

// ─────────────────────────────────────────────
// Time-dimension gap calculation
// ─────────────────────────────────────────────

describe("evaluateMacrocycle — time dimensions", () => {
  it("5k 24:30→22:15, target 20:00 → on_track", () => {
    const endValues: GoalDimensions = { "5k": "22:15" };
    const result = evaluateMacrocycle(
      { "5k": "24:30" },
      endValues,
      { "5k": "20:00" },
      2,
    );
    const fiveK = result.dimensions.find((d) => d.name === "5k");
    expect(fiveK).toBeDefined();
    expect(fiveK!.verdict).toBe("on_track");
    // 24:30 = 1470s, 22:15 = 1335s, 20:00 = 1200s
    // total gap = 1470-1200 = 270, progress = 1470-1335 = 135, progressPct = 50%
    // Expected: ≥60% of 33% = 19.8%, 50% ≥ 19.8% → on_track
    expect(fiveK!.gap).toBeGreaterThan(0);
    expect(fiveK!.gap).toBeLessThan(100);
  });

  it("5k achieved → gap = 0", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30" },
      { "5k": "19:50" },
      { "5k": "20:00" },
      2,
    );
    const fiveK = result.dimensions.find((d) => d.name === "5k");
    expect(fiveK!.verdict).toBe("achieved");
    expect(fiveK!.gap).toBe(0);
  });

  it("no progress on 5k → behind", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30" },
      { "5k": "24:20" },
      { "5k": "20:00" },
      2,
    );
    const fiveK = result.dimensions.find((d) => d.name === "5k");
    // 10s out of 270s = 3.7% progress, well below threshold
    expect(fiveK!.verdict).toBe("behind");
  });

  it("10k with no start value → uses 120% of target as baseline", () => {
    const result = evaluateMacrocycle(
      {}, // no startValue for 10k
      { "10k": "46:00" },
      { "10k": "42:00" },
      2,
    );
    const tenK = result.dimensions.find((d) => d.name === "10k");
    expect(tenK).toBeDefined();
    expect(tenK!.verdict).not.toBe("no_data"); // should compute
  });
});

// ─────────────────────────────────────────────
// Strength-dimension gap calculation
// ─────────────────────────────────────────────

describe("evaluateMacrocycle — strength dimensions", () => {
  it("hexBarDl 140→142, target 180 → behind (only 5% progress)", () => {
    const result = evaluateMacrocycle(
      { hexBarDl: 140 },
      { hexBarDl: 142 },
      { hexBarDl: 180 },
      2,
    );
    const hex = result.dimensions.find((d) => d.name === "hexBarDl");
    // total gap = 180-140 = 40, progress = 142-140 = 2, pct = 5%
    // 5% < 19.8% threshold → behind
    expect(hex!.verdict).toBe("behind");
    expect(hex!.gap).toBeGreaterThan(0);
  });

  it("bench 90→110 when target 110 → achieved", () => {
    const result = evaluateMacrocycle(
      { bench: 90 },
      { bench: 110 },
      { bench: 110 },
      2,
    );
    const bench = result.dimensions.find((d) => d.name === "bench");
    expect(bench!.verdict).toBe("achieved");
    expect(bench!.gap).toBe(0);
  });

  it("no endValue → no_data", () => {
    const result = evaluateMacrocycle(
      { squat: 100 },
      {}, // no squat endValue
      { squat: 140 },
      2,
    );
    const squat = result.dimensions.find((d) => d.name === "squat");
    expect(squat!.verdict).toBe("no_data");
    expect(squat!.gap).toBeNull();
  });
});

// ─────────────────────────────────────────────
// Weight/body comp — lower is better
// ─────────────────────────────────────────────

describe("evaluateMacrocycle — weight (lower=better)", () => {
  it("weight 92→90, target 85 → on_track", () => {
    const result = evaluateMacrocycle(
      { weight: 92 },
      { weight: 90 },
      { weight: 85 },
      2,
    );
    const w = result.dimensions.find((d) => d.name === "weight");
    // total gap = 92-85 = 7, progress = 92-90 = 2, pct = 28.6%
    // 28.6% ≥ 19.8% → on_track
    expect(w!.verdict).toBe("on_track");
    expect(w!.gap).toBeGreaterThan(0);
  });

  it("weight already at target → achieved", () => {
    const result = evaluateMacrocycle(
      { weight: 92 },
      { weight: 84 },
      { weight: 85 },
      2,
    );
    const w = result.dimensions.find((d) => d.name === "weight");
    expect(w!.verdict).toBe("achieved");
    expect(w!.gap).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Focus suggestion
// ─────────────────────────────────────────────

describe("evaluateMacrocycle — focus suggestion", () => {
  it("weight gap > 30% → recomp", () => {
    const result = evaluateMacrocycle(
      { weight: 92, "5k": "24:30", hexBarDl: 140, bench: 90 },
      { weight: 91, "5k": "22:00", hexBarDl: 145, bench: 93 },
      { weight: 80, "5k": "20:00", hexBarDl: 180, bench: 110 },
      2,
    );
    // weight gap: 92-80=12, progress=1, pct=8.3%, remaining=91.7% > 30% → recomp
    expect(result.suggestedFocus).toBe("recomp");
  });

  it("2+ strength behind + 2+ endurance on_track → strength_focus", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30", vo2max: 42, hexBarDl: 140, bench: 90, squat: 100 },
      { "5k": "21:00", vo2max: 48, hexBarDl: 142, bench: 91, squat: 101 },
      { "5k": "20:00", vo2max: 52, hexBarDl: 180, bench: 110, squat: 140, weight: 90 },
      2,
    );
    expect(result.suggestedFocus).toBe("strength_focus");
  });

  it("2+ endurance behind + 2+ strength on_track → endurance_focus", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30", "10k": "52:00", vo2max: 42, hexBarDl: 140, bench: 90, squat: 100 },
      { "5k": "24:00", "10k": "51:30", vo2max: 43, hexBarDl: 170, bench: 108, squat: 135 },
      { "5k": "20:00", "10k": "42:00", vo2max: 52, hexBarDl: 180, bench: 110, squat: 140, weight: 85 },
      2,
    );
    expect(result.suggestedFocus).toBe("endurance_focus");
  });

  it("all on track → balanced", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30", hexBarDl: 140, bench: 90, weight: 92 },
      { "5k": "21:30", hexBarDl: 165, bench: 105, weight: 87 },
      { "5k": "20:00", hexBarDl: 180, bench: 110, weight: 85 },
      2,
    );
    expect(result.suggestedFocus).toBe("balanced");
  });
});

// ─────────────────────────────────────────────
// Overall verdict
// ─────────────────────────────────────────────

describe("evaluateMacrocycle — overall verdict", () => {
  it("no behind → all_on_track", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30" },
      { "5k": "21:00" },
      { "5k": "20:00" },
      2,
    );
    expect(result.overallVerdict).toBe("all_on_track");
  });

  it("some behind, more on_track → mixed", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30", hexBarDl: 140, bench: 90 },
      { "5k": "21:00", hexBarDl: 142, bench: 105 },
      { "5k": "20:00", hexBarDl: 180, bench: 110 },
      2,
    );
    expect(result.overallVerdict).toBe("mixed");
  });
});

// ─────────────────────────────────────────────
// Next cycle target generation
// ─────────────────────────────────────────────

describe("evaluateMacrocycle — nextCycleTargets", () => {
  it("linearly interpolates remaining gap for numeric dims", () => {
    const result = evaluateMacrocycle(
      { hexBarDl: 140 },
      { hexBarDl: 150 },
      { hexBarDl: 180 },
      2, // 2 remaining → step = (180-150)/2 = 15
    );
    expect(result.nextCycleTargets.hexBarDl).toBe(165);
  });

  it("linearly interpolates time dims", () => {
    const result = evaluateMacrocycle(
      { "5k": "24:30" },
      { "5k": "22:00" },
      { "5k": "20:00" },
      2, // 22:00=1320s, 20:00=1200s, step=(1320-1200)/2=60s → 21:00
    );
    expect(result.nextCycleTargets["5k"]).toBe("21:00");
  });

  it("weight (lower=better) interpolates downward", () => {
    const result = evaluateMacrocycle(
      { weight: 92 },
      { weight: 90 },
      { weight: 84 },
      2, // step = |84-90|/2 = 3 → 90-3 = 87
    );
    expect(result.nextCycleTargets.weight).toBe(87);
  });
});

// ─────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────

describe("evaluateMacrocycle — determinism", () => {
  it("same inputs → same output", () => {
    const a = evaluateMacrocycle(startValues, { "5k": "22:15", hexBarDl: 148, bench: 94, weight: 90 }, annualTargets, 2);
    const b = evaluateMacrocycle(startValues, { "5k": "22:15", hexBarDl: 148, bench: 94, weight: 90 }, annualTargets, 2);
    expect(a).toEqual(b);
  });
});
