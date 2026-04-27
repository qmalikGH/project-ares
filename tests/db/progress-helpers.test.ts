import { describe, it, expect } from "vitest";
import {
  computeAdherenceBand,
  computeAdherenceScore,
  computeWeightedTID,
  zoneMinutesToTID,
  sortVdotPoints,
  isRunType,
  isStrengthType,
} from "@/lib/db/queries/progress-helpers";

describe("computeAdherenceBand", () => {
  it("80% → good", () => expect(computeAdherenceBand(80)).toBe("good"));
  it("100% → good", () => expect(computeAdherenceBand(100)).toBe("good"));
  it("65% → warning", () => expect(computeAdherenceBand(65)).toBe("warning"));
  it("60% boundary → warning", () => expect(computeAdherenceBand(60)).toBe("warning"));
  it("59% → alarm", () => expect(computeAdherenceBand(59)).toBe("alarm"));
  it("0% → alarm", () => expect(computeAdherenceBand(0)).toBe("alarm"));
});

describe("computeAdherenceScore", () => {
  it("returns 0 for empty counts", () => {
    expect(computeAdherenceScore({ completed: 0, modified: 0, skipped: 0, pending: 0 })).toBe(0);
  });
  it("Completed + Modified count toward adherence", () => {
    expect(
      computeAdherenceScore({ completed: 4, modified: 1, skipped: 1, pending: 0 }),
    ).toBe(83);
  });
  it("100% when all completed", () => {
    expect(
      computeAdherenceScore({ completed: 6, modified: 0, skipped: 0, pending: 0 }),
    ).toBe(100);
  });
  it("0% when all skipped", () => {
    expect(
      computeAdherenceScore({ completed: 0, modified: 0, skipped: 5, pending: 0 }),
    ).toBe(0);
  });
});

describe("computeWeightedTID", () => {
  it("two equal-weight phases with same TID → that TID", () => {
    const result = computeWeightedTID([
      { z1: 75, z2: 20, z3: 5, durationWeeks: 4 },
      { z1: 75, z2: 20, z3: 5, durationWeeks: 4 },
    ]);
    expect(result).toEqual({ z1: 75, z2: 20, z3: 5 });
  });

  it("differently weighted phases compute correctly", () => {
    // Phase A: 8 weeks of 80/20/0 = 640/160/0
    // Phase B: 4 weeks of 60/30/10 = 240/120/40
    // Total: 12 weeks, weighted avg = 880/280/40 / 12 = 73.3/23.3/3.3
    const result = computeWeightedTID([
      { z1: 80, z2: 20, z3: 0, durationWeeks: 8 },
      { z1: 60, z2: 30, z3: 10, durationWeeks: 4 },
    ]);
    expect(result.z1).toBeCloseTo(73.3, 1);
    expect(result.z2).toBeCloseTo(23.3, 1);
    expect(result.z3).toBeCloseTo(3.3, 1);
  });

  it("returns zero for empty input", () => {
    expect(computeWeightedTID([])).toEqual({ z1: 0, z2: 0, z3: 0 });
  });
});

describe("zoneMinutesToTID", () => {
  it("converts minutes to percentages", () => {
    const tid = zoneMinutesToTID({ z1: 60, z2: 20, z3: 20 });
    expect(tid.z1).toBe(60);
    expect(tid.z2).toBe(20);
    expect(tid.z3).toBe(20);
  });

  it("returns zeros when no minutes", () => {
    expect(zoneMinutesToTID({ z1: 0, z2: 0, z3: 0 })).toEqual({ z1: 0, z2: 0, z3: 0 });
  });

  it("rounds to 1 decimal", () => {
    const tid = zoneMinutesToTID({ z1: 100, z2: 0, z3: 0 });
    expect(tid.z1).toBe(100);
  });
});

describe("sortVdotPoints", () => {
  it("orders by date ascending", () => {
    const points = [
      { date: new Date("2026-05-01"), vdot: 43, source: "PLANNED" },
      { date: new Date("2026-04-20"), vdot: 42, source: "INITIAL" },
      { date: new Date("2026-04-25"), vdot: 42, source: "PLANNED" },
    ];
    const sorted = sortVdotPoints(points);
    expect(sorted[0].date.toISOString().slice(0, 10)).toBe("2026-04-20");
    expect(sorted[2].date.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("does not mutate input", () => {
    const points = [
      { date: new Date("2026-05-01"), vdot: 43, source: "PLANNED" },
      { date: new Date("2026-04-20"), vdot: 42, source: "INITIAL" },
    ];
    const original = [...points];
    sortVdotPoints(points);
    expect(points).toEqual(original);
  });
});

describe("isRunType / isStrengthType", () => {
  it("classifies run types", () => {
    expect(isRunType("easy_run")).toBe(true);
    expect(isRunType("threshold_run")).toBe(true);
    expect(isRunType("vo2max_intervals")).toBe(true);
    expect(isRunType("strength_a")).toBe(false);
    expect(isRunType("rest")).toBe(false);
  });

  it("classifies strength types", () => {
    expect(isStrengthType("strength_a")).toBe(true);
    expect(isStrengthType("strength_c")).toBe(true);
    expect(isStrengthType("easy_run")).toBe(false);
  });
});
