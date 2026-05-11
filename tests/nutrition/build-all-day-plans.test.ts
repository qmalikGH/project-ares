import { describe, expect, it } from "vitest";
import { buildAllDayPlans } from "@/lib/nutrition/build-all-day-plans";
import { DAY_TYPE_CONFIGS, ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import type { DayTypeConfig } from "@/lib/nutrition/types";

const recipes = RECIPE_TEMPLATES;
const weight = ATHLETE_WEIGHT_KG;

// ═══════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════

describe("buildAllDayPlans — happy path", () => {
  const result = buildAllDayPlans(DAY_TYPE_CONFIGS, recipes, weight);

  it("has no errors", () => {
    expect(result.hasErrors).toBe(false);
    expect(result.allErrors).toHaveLength(0);
  });

  it("returns 4 plans", () => {
    expect(result.plans.size).toBe(4);
  });

  it("has entries for all day types", () => {
    expect(result.plans.has("strength_run")).toBe(true);
    expect(result.plans.has("threshold")).toBe(true);
    expect(result.plans.has("long_run")).toBe(true);
    expect(result.plans.has("rest")).toBe(true);
  });

  it("all plans pass validation", () => {
    for (const [, plan] of result.plans) {
      expect(plan.validation.valid).toBe(true);
    }
  });

  it("each plan has mainMeal ≠ dinner recipe", () => {
    for (const [, plan] of result.plans) {
      expect(plan.mainMeal.recipeId).not.toBe(plan.dinner.recipeId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error propagation
// ═══════════════════════════════════════════════════════════════════════════

describe("buildAllDayPlans — error propagation", () => {
  it("reports errors from bad config", () => {
    const badConfigs: DayTypeConfig[] = [
      ...DAY_TYPE_CONFIGS.filter((c) => c.dayType !== "rest"),
      {
        ...DAY_TYPE_CONFIGS.find((c) => c.dayType === "rest")!,
        calorieTarget: 500, // impossible
      },
    ];
    const result = buildAllDayPlans(badConfigs, recipes, weight);
    expect(result.hasErrors).toBe(true);
    expect(result.allErrors.some((e) => e.includes("[rest]"))).toBe(true);
  });

  it("collects errors from multiple failing configs", () => {
    const badConfigs: DayTypeConfig[] = DAY_TYPE_CONFIGS.map((c) => ({
      ...c,
      variableSlots: {
        mainMeal: { recipeId: c.variableSlots.mainMeal.recipeId, budgetRatio: 0.8 },
        dinner: { recipeId: c.variableSlots.dinner.recipeId, budgetRatio: 0.8 }, // sum = 1.6
      },
    }));
    const result = buildAllDayPlans(badConfigs, recipes, weight);
    expect(result.hasErrors).toBe(true);
    expect(result.allErrors.length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("buildAllDayPlans — determinism", () => {
  it("same inputs → same outputs", () => {
    const a = buildAllDayPlans(DAY_TYPE_CONFIGS, recipes, weight);
    const b = buildAllDayPlans(DAY_TYPE_CONFIGS, recipes, weight);
    for (const [key, planA] of a.plans) {
      expect(planA).toEqual(b.plans.get(key));
    }
  });
});
