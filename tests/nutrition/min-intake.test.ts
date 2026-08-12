// Derived minimum intake — Sprint 2.7 (A5).
//
// The regression these tests exist for: on 2026-06-15 the calibration wrote a
// rest-day target of 1558 kcal, the engine could not build it, and the
// all-or-nothing cascade therefore wrote nothing — silently, for two months.
import { describe, expect, it } from "vitest";

import {
  carbFloorPerKg,
  clampToMinIntake,
  fixedSlotFacts,
  minCalorieTarget,
  minCalorieTargetForConfig,
} from "@/lib/nutrition/min-intake";
import { DAY_TYPE_CONFIGS } from "@/lib/nutrition/day-type-configs";
import {
  CARB_FLOOR_PER_KG_REST,
  CARB_FLOOR_PER_KG_TRAINING,
  MIN_REMAINING_BUDGET,
} from "@/lib/nutrition/constants";

const restConfig = DAY_TYPE_CONFIGS.find((c) => c.dayType === "rest")!;
const thresholdConfig = DAY_TYPE_CONFIGS.find((c) => c.dayType === "threshold")!;

describe("carbFloorPerKg", () => {
  it("training days get the higher floor", () => {
    expect(carbFloorPerKg(true)).toBe(CARB_FLOOR_PER_KG_TRAINING);
    expect(carbFloorPerKg(false)).toBe(CARB_FLOOR_PER_KG_REST);
    expect(CARB_FLOOR_PER_KG_TRAINING).toBeGreaterThan(CARB_FLOOR_PER_KG_REST);
  });
});

describe("fixedSlotFacts", () => {
  it("sums fixed slots incl. the flex dessert", () => {
    // rest day: morning 320 + afternoon 270 + evening 200 + skyr 130 = 920
    expect(fixedSlotFacts(restConfig.fixedSlots).fixedKcal).toBe(920);
  });

  it("counts collagen as non-functional protein on training days only", () => {
    // Collagen lives in the pre-training slot, which rest days do not have.
    expect(fixedSlotFacts(thresholdConfig.fixedSlots).nonFunctionalProteinG).toBe(14);
    expect(fixedSlotFacts(restConfig.fixedSlots).nonFunctionalProteinG).toBe(0);
  });

  it("ignores a disabled flex dessert", () => {
    const disabled = {
      ...restConfig.fixedSlots,
      flexDessert: { enabled: false, items: restConfig.fixedSlots.flexDessert!.items },
    };
    expect(fixedSlotFacts(disabled).fixedKcal).toBe(920 - 130);
  });
});

describe("minCalorieTarget", () => {
  it("training day at 88 kg needs ~2313 kcal", () => {
    const r = minCalorieTarget({
      weightKg: 88,
      fixedKcal: 1125,
      nonFunctionalProteinG: 14,
      isTrainingDay: true,
    });
    // 1.08 × (4×(158.4+14) + 9×44 + 4×264) = 1.08 × 2141.6 ≈ 2313
    expect(r.minKcal).toBe(2313);
    expect(r.binding).toBe("macro_floor");
    expect(r.breakdown.carbsG).toBe(264);
  });

  it("rest day at 88 kg needs ~1872 kcal", () => {
    const r = minCalorieTarget({
      weightKg: 88,
      fixedKcal: 920,
      nonFunctionalProteinG: 0,
      isTrainingDay: false,
    });
    expect(r.minKcal).toBe(1872);
    expect(r.binding).toBe("macro_floor");
  });

  it("collagen raises the floor — it costs kcal but does not count as protein", () => {
    const without = minCalorieTarget({ weightKg: 88, fixedKcal: 1125, nonFunctionalProteinG: 0, isTrainingDay: true });
    const with14 = minCalorieTarget({ weightKg: 88, fixedKcal: 1125, nonFunctionalProteinG: 14, isTrainingDay: true });
    expect(with14.minKcal).toBeGreaterThan(without.minKcal);
    expect(with14.minKcal - without.minKcal).toBe(61); // ≈ 1.08 × 14 g × 4 kcal
  });

  it("the structural term wins when the fixed slots are large", () => {
    const r = minCalorieTarget({
      weightKg: 60,
      fixedKcal: 2000,
      nonFunctionalProteinG: 0,
      isTrainingDay: false,
    });
    expect(r.binding).toBe("structural");
    expect(r.minKcal).toBe(2000 + MIN_REMAINING_BUDGET);
  });

  it("scales with body mass", () => {
    const light = minCalorieTarget({ weightKg: 70, fixedKcal: 920, nonFunctionalProteinG: 0, isTrainingDay: false });
    const heavy = minCalorieTarget({ weightKg: 95, fixedKcal: 920, nonFunctionalProteinG: 0, isTrainingDay: false });
    expect(heavy.minKcal).toBeGreaterThan(light.minKcal);
  });
});

describe("minCalorieTargetForConfig — regression against the 2026-06-15 split", () => {
  it("rejects the rest target the calibration actually wrote (1558)", () => {
    const floor = minCalorieTargetForConfig(restConfig, 88);
    expect(1558).toBeLessThan(floor.minKcal);
  });

  it("rejects the threshold target it wrote too (2196)", () => {
    const floor = minCalorieTargetForConfig(thresholdConfig, 88);
    expect(2196).toBeLessThan(floor.minKcal);
  });

  it("accepts every current static target at the real body mass", () => {
    for (const config of DAY_TYPE_CONFIGS) {
      const floor = minCalorieTargetForConfig(config, 88);
      expect(config.calorieTarget, `${config.dayType}`).toBeGreaterThanOrEqual(floor.minKcal);
    }
  });
});

describe("clampToMinIntake", () => {
  it("leaves a healthy target untouched and reports no note", () => {
    const r = clampToMinIntake(2200, restConfig, 88);
    expect(r.calorieTarget).toBe(2200);
    expect(r.clamped).toBe(false);
    expect(r.note).toBeNull();
  });

  it("raises a broken target to the floor and says so", () => {
    const r = clampToMinIntake(1558, restConfig, 88);
    expect(r.clamped).toBe(true);
    expect(r.calorieTarget).toBe(r.floor.minKcal);
    expect(r.note).toContain("1558");
    expect(r.note).toContain(String(r.floor.minKcal));
  });

  it("is idempotent — clamping a clamped value changes nothing", () => {
    const once = clampToMinIntake(1000, restConfig, 88);
    const twice = clampToMinIntake(once.calorieTarget, restConfig, 88);
    expect(twice.calorieTarget).toBe(once.calorieTarget);
    expect(twice.clamped).toBe(false);
  });
});
