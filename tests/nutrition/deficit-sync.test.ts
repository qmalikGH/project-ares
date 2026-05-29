// Sprint v1.8 #6 — Cross-store deficit consistency.
// Guards that cascadeNutritionUpdate() now syncs DayPlan rows (not just
// ComputedMealSlot), so all 4 stores stay at the same deficit. Mocks the DB
// and runs the REAL engine; asserts every DayPlan write is deficit-consistent.

import { beforeEach, describe, expect, it, vi } from "vitest";

const dayTypeConfigFindMany = vi.hoisted(() => vi.fn());
const mealPlanFindUnique = vi.hoisted(() => vi.fn());
const userSettingsFindUnique = vi.hoisted(() => vi.fn());
const dayPlanUpdateMany = vi.hoisted(() => vi.fn());
const computedMealSlotDeleteMany = vi.hoisted(() => vi.fn());
const computedMealSlotCreateMany = vi.hoisted(() => vi.fn());
const coachingLogCreate = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn(async (ops: unknown[]) => ops));

vi.mock("@/lib/db/client", () => ({
  db: {
    dayTypeConfig: { findMany: dayTypeConfigFindMany },
    mealPlan: { findUnique: mealPlanFindUnique },
    userSettings: { findUnique: userSettingsFindUnique },
    dayPlan: { updateMany: dayPlanUpdateMany },
    computedMealSlot: { deleteMany: computedMealSlotDeleteMany, createMany: computedMealSlotCreateMany },
    coachingLog: { create: coachingLogCreate },
    $transaction: transactionMock,
  },
}));

import { cascadeNutritionUpdate } from "@/lib/nutrition/cascade";
import { DAY_TYPE_CONFIGS } from "@/lib/nutrition/day-type-configs";
import { engineConfigToDbData } from "@/lib/nutrition/seed-day-type-configs";
import { DEFICIT_KCAL } from "@/lib/nutrition/constants";

describe("cascadeNutritionUpdate — cross-store deficit sync (#6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dayTypeConfigFindMany.mockResolvedValue(
      DAY_TYPE_CONFIGS.map((c, i) => ({ id: `cfg-${i}`, ...engineConfigToDbData("plan-1", c) })),
    );
    mealPlanFindUnique.mockResolvedValue({ userId: "u1", deficitKcal: DEFICIT_KCAL });
    userSettingsFindUnique.mockResolvedValue({ currentWeightKg: 92, targetWeightKg: 92 });
    dayPlanUpdateMany.mockReturnValue({});
    computedMealSlotDeleteMany.mockReturnValue({});
    computedMealSlotCreateMany.mockReturnValue({});
    coachingLogCreate.mockReturnValue({});
  });

  it("succeeds and writes DayPlan for every day type", async () => {
    const res = await cascadeNutritionUpdate("plan-1", "seed", "test");
    expect(res.success, JSON.stringify(res.errors)).toBe(true);
    expect(dayPlanUpdateMany).toHaveBeenCalledTimes(DAY_TYPE_CONFIGS.length);
  });

  it("every DayPlan write keeps tdee − calorieTarget == DEFICIT_KCAL (no drift)", async () => {
    await cascadeNutritionUpdate("plan-1", "seed", "test");
    const seenDayTypes = new Set<string>();
    for (const call of dayPlanUpdateMany.mock.calls) {
      const { where, data } = call[0] as {
        where: { dayType: string };
        data: { tdeeEstimate: number; calorieTarget: number; slots: unknown };
      };
      seenDayTypes.add(where.dayType);
      expect(data.tdeeEstimate - data.calorieTarget, `${where.dayType} deficit`).toBe(DEFICIT_KCAL);
      expect(data.slots).toBeTruthy();
    }
    expect([...seenDayTypes].sort()).toEqual(["long_run", "rest", "strength_run", "threshold"]);
  });

  it("DayPlan write is part of the same transaction as the slot writes", async () => {
    await cascadeNutritionUpdate("plan-1", "seed", "test");
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const ops = transactionMock.mock.calls[0][0] as unknown[];
    // deleteMany + createMany + 4 dayPlan updateMany + coachingLog = 7 ops
    expect(ops.length).toBe(2 + DAY_TYPE_CONFIGS.length + 1);
  });
});
