// Calibration must not lie about its outcome — Sprint 2.7 (A5).
//
// What actually happened in production: on 2026-06-15 the weekly calibration
// wrote new DayTypeConfig targets, the all-or-nothing cascade rejected them,
// and calibration still stamped `calibrationStatus: "calibrated"` and moved
// `calibratedAt` forward. The configs kept the impossible values, DayPlan and
// ComputedMealSlot kept the old ones, and nothing anywhere said so — for two
// months, across every page load and every weigh-in.
//
// These tests pin the three properties that make that impossible:
//   1. a rejected calibration reports `cascade_failed`, not `calibrated`
//   2. it never advances calibratedAt (so the daily cron retries)
//   3. it restores the previous configs, so the stores cannot diverge
import { beforeEach, describe, expect, it, vi } from "vitest";

const sensorFindMany = vi.hoisted(() => vi.fn());
const workoutFindMany = vi.hoisted(() => vi.fn());
const mealPlanFindFirst = vi.hoisted(() => vi.fn());
const mealPlanUpdate = vi.hoisted(() => vi.fn());
const userSettingsFindUnique = vi.hoisted(() => vi.fn());
const coachingLogFindMany = vi.hoisted(() => vi.fn());
const dayTypeConfigFindMany = vi.hoisted(() => vi.fn());
const dayTypeConfigUpdate = vi.hoisted(() => vi.fn());
const cascadeMock = vi.hoisted(() => vi.fn());
const dryRunMock = vi.hoisted(() => vi.fn());
const weightAvgMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    dailySensorData: { findMany: sensorFindMany },
    workout: { findMany: workoutFindMany },
    mealPlan: { findFirst: mealPlanFindFirst, update: mealPlanUpdate },
    userSettings: { findUnique: userSettingsFindUnique },
    coachingLog: { findMany: coachingLogFindMany },
    dayTypeConfig: { findMany: dayTypeConfigFindMany, update: dayTypeConfigUpdate },
  },
}));

vi.mock("@/lib/db/queries/sensors", () => ({
  dayKey: (d: Date) => {
    const r = new Date(d);
    r.setUTCHours(0, 0, 0, 0);
    return r;
  },
  getRecentWeightAverageKg: weightAvgMock,
}));

vi.mock("@/lib/nutrition/cascade", () => ({ cascadeNutritionUpdate: cascadeMock }));

vi.mock("@/lib/nutrition/dry-run", () => ({
  dryRunConfigChange: dryRunMock,
  resolveAthleteWeightKg: vi.fn(async () => 88),
}));

import { calibrateMealPlan } from "@/lib/nutrition/calibration";
import { DAY_TYPE_CONFIGS } from "@/lib/nutrition/day-type-configs";
import { engineConfigToDbData } from "@/lib/nutrition/seed-day-type-configs";

const PLAN_ID = "plan_1";
const USER_ID = "user_1";

// 2026-08-12 is a Wednesday → rest. Tuesdays are threshold days.
const REST_A = new Date("2026-08-05T00:00:00.000Z"); // Wed
const REST_B = new Date("2026-08-09T00:00:00.000Z"); // Sun
const THR_A = new Date("2026-08-04T00:00:00.000Z"); // Tue
const THR_B = new Date("2026-08-11T00:00:00.000Z"); // Tue

function configRows(overrides: Partial<Record<string, number>> = {}) {
  return DAY_TYPE_CONFIGS.map((c) => ({
    id: `cfg_${c.dayType}`,
    ...engineConfigToDbData(PLAN_ID, c),
    calorieTarget: overrides[c.dayType] ?? c.calorieTarget,
  }));
}

function seedHappyPath(restTdee = 2400) {
  sensorFindMany.mockResolvedValue([
    { date: REST_A, totalKilocalories: restTdee },
    { date: REST_B, totalKilocalories: restTdee },
    { date: THR_A, totalKilocalories: 2900 },
    { date: THR_B, totalKilocalories: 2900 },
  ]);
  workoutFindMany.mockResolvedValue([
    { date: THR_A, status: "completed" },
    { date: THR_B, status: "completed" },
  ]);
  mealPlanFindFirst.mockResolvedValue({ id: PLAN_ID, deficitKcal: 300, calibratedAt: new Date("2026-08-01") });
  userSettingsFindUnique.mockResolvedValue({ targetWeightKg: 84 });
  weightAvgMock.mockResolvedValue({ avgKg: 88, samples: 4, latestAt: new Date("2026-08-12") });
  coachingLogFindMany.mockResolvedValue([]);
  dayTypeConfigFindMany.mockResolvedValue(configRows());
  dryRunMock.mockResolvedValue({ ok: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-12T06:00:00.000Z"));
});

describe("calibrateMealPlan — cascade failure", () => {
  it("reports cascade_failed instead of calibrated", async () => {
    seedHappyPath();
    cascadeMock.mockResolvedValue({ success: false, errors: ["[rest] Functional protein 140g < hard floor 158g"] });

    const result = await calibrateMealPlan(USER_ID);

    expect(result.status).toBe("cascade_failed");
    expect(result.message).toContain("Functional protein");
  });

  it("does not advance calibratedAt — the daily cron must retry", async () => {
    seedHappyPath();
    cascadeMock.mockResolvedValue({ success: false, errors: ["nope"] });

    await calibrateMealPlan(USER_ID);

    const statusWrites = mealPlanUpdate.mock.calls.filter(
      ([arg]) => arg?.data?.calibratedAt != null || arg?.data?.calibrationStatus != null,
    );
    expect(statusWrites).toHaveLength(0);
  });

  it("rolls the DayTypeConfig rows back to their previous values", async () => {
    seedHappyPath();
    cascadeMock.mockResolvedValue({ success: false, errors: ["nope"] });

    await calibrateMealPlan(USER_ID);

    // Every row written must be written back. The LAST write per id is the
    // restore, and it has to match what the row held before.
    const before = new Map(configRows().map((r) => [r.id, r.calorieTarget]));
    const lastWritePerId = new Map<string, number>();
    for (const [arg] of dayTypeConfigUpdate.mock.calls) {
      lastWritePerId.set(arg.where.id, arg.data.calorieTarget);
    }
    expect(lastWritePerId.size).toBeGreaterThan(0);
    for (const [id, target] of lastWritePerId) {
      expect(target, `${id} restored`).toBe(before.get(id));
    }
  });

  it("skips the write entirely when the dry run already rejects the targets", async () => {
    seedHappyPath();
    dryRunMock.mockResolvedValue({ ok: false, errors: ["[rest] Calorie mismatch"] });

    const result = await calibrateMealPlan(USER_ID);

    expect(result.status).toBe("cascade_failed");
    expect(dayTypeConfigUpdate).not.toHaveBeenCalled();
    expect(cascadeMock).not.toHaveBeenCalled();
  });
});

describe("calibrateMealPlan — success path", () => {
  it("marks the plan calibrated only after the cascade succeeds", async () => {
    seedHappyPath();
    cascadeMock.mockResolvedValue({ success: true, errors: [] });

    const result = await calibrateMealPlan(USER_ID);

    expect(result.status).toBe("calibrated");
    const statusWrites = mealPlanUpdate.mock.calls.filter(([arg]) => arg?.data?.calibrationStatus === "calibrated");
    expect(statusWrites).toHaveLength(1);
  });

  it("writes targets derived from the resolved deficit", async () => {
    seedHappyPath();
    cascadeMock.mockResolvedValue({ success: true, errors: [] });

    await calibrateMealPlan(USER_ID);

    const restWrite = dayTypeConfigUpdate.mock.calls.find(([arg]) => arg.where.id === "cfg_rest")![0];
    expect(restWrite.data.tdeeEstimate).toBe(2400);
    expect(restWrite.data.calorieTarget).toBe(2100); // 2400 − 300
    expect(restWrite.data.proteinG).toBe(194); // 88 kg × 2.2, not the old fixed 190
  });
});

describe("calibrateMealPlan — derived intake floor", () => {
  it("raises a target the engine could not build, and says it did", async () => {
    // Rest TDEE 2100 → 2100 − 300 = 1800, below the 1872 floor at 88 kg.
    seedHappyPath(2100);
    cascadeMock.mockResolvedValue({ success: true, errors: [] });

    const result = await calibrateMealPlan(USER_ID);

    const restWrite = dayTypeConfigUpdate.mock.calls.find(([arg]) => arg.where.id === "cfg_rest")![0];
    expect(restWrite.data.calorieTarget).toBe(1872);
    expect(result.clampNotes?.join(" ")).toContain("rest");
    expect(result.message).toContain("Untergrenze");
  });

  it("carbs describe the clamped target, not the requested one", async () => {
    seedHappyPath(2100);
    cascadeMock.mockResolvedValue({ success: true, errors: [] });

    await calibrateMealPlan(USER_ID);

    const w = dayTypeConfigUpdate.mock.calls.find(([arg]) => arg.where.id === "cfg_rest")![0].data;
    const reconstructed = w.proteinG * 4 + w.fatG * 9 + w.carbsG * 4;
    expect(Math.abs(reconstructed - w.calorieTarget)).toBeLessThanOrEqual(4);
  });
});
