import { describe, it, expect } from "vitest";
import {
  computeDailyLoad,
  computeACWR,
  buildLoadOutput,
  computeTrend7d,
  type DailyLoadEntry,
} from "@/lib/coach-engine/load-monitoring";

const day = (offsetDays: number, base = new Date("2026-04-26T06:00:00Z")) =>
  new Date(base.getTime() + offsetDays * 86400000);

describe("computeDailyLoad", () => {
  it("returns sRPE × duration", () => {
    expect(computeDailyLoad(7, 60)).toBe(420);
  });

  it("zero rpe gives zero load", () => {
    expect(computeDailyLoad(0, 60)).toBe(0);
  });

  it("zero duration gives zero load", () => {
    expect(computeDailyLoad(7, 0)).toBe(0);
  });

  it("rejects out-of-range rpe", () => {
    expect(() => computeDailyLoad(-1, 60)).toThrow();
    expect(() => computeDailyLoad(11, 60)).toThrow();
  });

  it("rejects negative duration", () => {
    expect(() => computeDailyLoad(7, -1)).toThrow();
  });
});

describe("computeACWR (rolling)", () => {
  it("returns zeros + BASELINE_BUILDING for empty history", () => {
    const result = computeACWR([], "rolling");
    expect(result).toEqual({ acwr: 0, acute: 0, chronic: 0, band: "BASELINE_BUILDING", daysOfData: 0 });
  });

  it("BASELINE_BUILDING when <14 days of data even if chronic load is high", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = [];
    // 7 days of heavy training — could yield "DANGER" if naive, but baseline is too thin.
    for (let i = 0; i < 7; i++) loads.push({ date: day(-i), load: 600 });
    const result = computeACWR(loads, "rolling", today);
    expect(result.daysOfData).toBe(7);
    expect(result.band).toBe("BASELINE_BUILDING");
    // ACWR value is still computed (just the band classification is different)
    expect(result.acwr).toBeGreaterThan(0);
  });

  it("BASELINE_BUILDING when chronic28d < 50 AU even with 14+ days", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = [];
    // 20 days of barely-any training (load=1 AU each → chronic ≈ 0.7/day → 20 AU total)
    for (let i = 0; i < 20; i++) loads.push({ date: day(-i), load: 1 });
    const result = computeACWR(loads, "rolling", today);
    expect(result.daysOfData).toBe(20);
    expect(result.band).toBe("BASELINE_BUILDING");
  });

  it("normal classification kicks in at 14+ days AND chronic28d >50 AU", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = Array.from({ length: 14 }, (_, i) => ({
      date: day(-i),
      load: 200,
    }));
    const result = computeACWR(loads, "rolling", today);
    expect(result.daysOfData).toBe(14);
    // 14 days × 200 AU / 28 = 100 AU/day chronic; chronic*28 = 2800 > 50 → out of cold start
    expect(result.band).not.toBe("BASELINE_BUILDING");
  });

  it("identifies OPTIMAL band for steady training", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = Array.from({ length: 28 }, (_, i) => ({
      date: day(-i),
      load: 400, // ~57 min @ RPE 7
    }));
    const result = computeACWR(loads, "rolling", today);
    // acute = 7×400/7 = 400; chronic = 28×400/28 = 400 → 1.0
    expect(result.acwr).toBeCloseTo(1.0, 5);
    expect(result.band).toBe("OPTIMAL");
  });

  it("identifies HIGH band when acute spikes versus chronic baseline", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = [];
    // Chronic includes acute window (rolling 28d). Solve 4X / (X + 3Y) = 1.4 → X = 1.615Y.
    // Y=100, X=162 → ACWR ≈ 1.40
    for (let i = 7; i < 28; i++) loads.push({ date: day(-i), load: 100 });
    for (let i = 0; i < 7; i++) loads.push({ date: day(-i), load: 162 });
    const result = computeACWR(loads, "rolling", today);
    expect(result.acwr).toBeGreaterThan(ACWR_OPTIMAL_BOUND);
    expect(result.acwr).toBeLessThanOrEqual(ACWR_HIGH_BOUND);
    expect(result.band).toBe("HIGH");
  });

  it("identifies DANGER band for sharp spike", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = [];
    for (let i = 7; i < 28; i++) loads.push({ date: day(-i), load: 100 });
    for (let i = 0; i < 7; i++) loads.push({ date: day(-i), load: 600 });
    const result = computeACWR(loads, "rolling", today);
    expect(result.band).toBe("DANGER");
  });

  it("at ACWR exactly 1.3, band is OPTIMAL (boundary)", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = [];
    // Chronic includes acute window. Solve 4X / (X + 3Y) = 1.3 → X = 13Y/9.
    // Y=90, X=130 → ACWR = 1.30 exact
    for (let i = 7; i < 28; i++) loads.push({ date: day(-i), load: 90 });
    for (let i = 0; i < 7; i++) loads.push({ date: day(-i), load: 130 });
    const result = computeACWR(loads, "rolling", today);
    expect(result.acwr).toBeCloseTo(1.3, 5);
    expect(result.band).toBe("OPTIMAL");
  });
});

describe("computeACWR (ewma)", () => {
  it("returns finite value for non-trivial history", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = Array.from({ length: 28 }, (_, i) => ({
      date: day(-i),
      load: 400,
    }));
    const result = computeACWR(loads, "ewma", today);
    expect(Number.isFinite(result.acwr)).toBe(true);
    expect(result.acwr).toBeGreaterThan(0);
  });
});

describe("buildLoadOutput", () => {
  it("combines rolling + ewma into one output", () => {
    const today = day(0);
    const loads: DailyLoadEntry[] = Array.from({ length: 28 }, (_, i) => ({
      date: day(-i),
      load: 400,
    }));
    const out = buildLoadOutput(loads, 420, today);
    expect(out.dailyLoadAu).toBe(420);
    expect(out.acute7d).toBeGreaterThan(0);
    expect(out.chronic28d).toBeGreaterThan(0);
    expect(out.acwrRolling).toBeCloseTo(1.0, 5);
    expect(out.acwrEwma).toBeGreaterThan(0);
    expect(out.band).toBe("OPTIMAL");
  });
});

describe("computeTrend7d", () => {
  it("returns stable for flat values", () => {
    const values = Array.from({ length: 7 }, (_, i) => ({ date: day(-i), value: 50 }));
    expect(computeTrend7d(values)).toBe("stable");
  });

  it("returns improving for ascending trend", () => {
    const values = Array.from({ length: 7 }, (_, i) => ({ date: day(-(6 - i)), value: 40 + i * 5 }));
    expect(computeTrend7d(values)).toBe("improving");
  });

  it("returns declining for descending trend", () => {
    const values = Array.from({ length: 7 }, (_, i) => ({ date: day(-(6 - i)), value: 80 - i * 5 }));
    expect(computeTrend7d(values)).toBe("declining");
  });

  it("returns stable for fewer than 3 points", () => {
    expect(computeTrend7d([])).toBe("stable");
    expect(computeTrend7d([{ date: day(0), value: 50 }])).toBe("stable");
  });
});

describe("Determinism", () => {
  it("computeACWR is deterministic", () => {
    const loads: DailyLoadEntry[] = Array.from({ length: 28 }, (_, i) => ({
      date: day(-i),
      load: 350 + (i % 3) * 50,
    }));
    const today = day(0);
    const a = computeACWR(loads, "rolling", today);
    const b = computeACWR(loads, "rolling", today);
    expect(a).toEqual(b);
  });

  it("buildLoadOutput is deterministic across 10 runs", () => {
    const loads: DailyLoadEntry[] = Array.from({ length: 28 }, (_, i) => ({
      date: day(-i),
      load: 350 + (i % 3) * 50,
    }));
    const today = day(0);
    const first = buildLoadOutput(loads, 400, today);
    for (let i = 0; i < 10; i++) {
      expect(buildLoadOutput(loads, 400, today)).toEqual(first);
    }
  });
});

// Threshold constants kept locally for readable assertions in tests.
const ACWR_OPTIMAL_BOUND = 1.3;
const ACWR_HIGH_BOUND = 1.5;
