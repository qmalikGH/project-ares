import { describe, expect, it, vi } from "vitest";

// Prevent Prisma client initialization (DATABASE_URL not available in test env).
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/date", () => ({ userTodayDynamic: vi.fn(async () => new Date()) }));
vi.mock("@/lib/db/queries/sensors", () => ({
  getRecentSensorData: vi.fn(async () => []),
  dayKey: (d: Date) => { const r = new Date(d); r.setUTCHours(0, 0, 0, 0); return r; },
}));
vi.mock("@/lib/db/queries/settings", () => ({ getEffectiveVdot: vi.fn(async () => 42) }));

import { computeComplianceRate, safeSection } from "@/lib/coaching-export/build-export";

describe("computeComplianceRate", () => {
  it("6 completed out of 10 total = 60%", () => {
    expect(computeComplianceRate(6, 10)).toBe(60);
  });

  it("all completed = 100%", () => {
    expect(computeComplianceRate(8, 8)).toBe(100);
  });

  it("zero total = 0% (no division by zero)", () => {
    expect(computeComplianceRate(0, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    // 1/3 = 33.33... → 33
    expect(computeComplianceRate(1, 3)).toBe(33);
  });

  it("none completed out of total = 0%", () => {
    expect(computeComplianceRate(0, 8)).toBe(0);
  });
});

describe("safeSection — graceful degradation", () => {
  it("returns null when fn throws and no fallback given", async () => {
    const result = await safeSection(async () => {
      throw new Error("db failure");
    });
    expect(result).toBeNull();
  });

  it("returns fallback when fn throws", async () => {
    const fallback = { days: [], baselines: null };
    const result = await safeSection(async () => {
      throw new Error("DailySensorData unavailable");
    }, fallback);
    expect(result).toEqual({ days: [], baselines: null });
  });

  it("returns the resolved value when fn succeeds", async () => {
    const result = await safeSection(async () => 42);
    expect(result).toBe(42);
  });

  it("wellness section gracefully falls back to empty days on DB error", async () => {
    const defaultWellness = { days: [], baselines: null };
    const result = await safeSection(async () => {
      throw new Error("No sensor data");
    }, defaultWellness);
    expect(result).toEqual({ days: [], baselines: null });
    expect((result as typeof defaultWellness).days).toHaveLength(0);
  });

  it("fallback for trainingHistory has correct shape", async () => {
    const defaultHistory = {
      last28Days: { planned: 0, completed: 0, skipped: 0, complianceRate: 0 },
      sessions: [],
      volumeTrends: { weeklyRunKm: [], weeklyStrengthSets: [] },
    };
    const result = await safeSection(async () => {
      throw new Error("Workout table unreachable");
    }, defaultHistory);
    expect(result?.last28Days.complianceRate).toBe(0);
    expect(result?.sessions).toHaveLength(0);
  });
});
