import { describe, expect, it } from "vitest";
import { DAY_TYPE_CONFIGS, findDayTypeConfig, ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";

// ═══════════════════════════════════════════════════════════════════════════
// DayTypeConfig structural validation
// ═══════════════════════════════════════════════════════════════════════════

describe("DAY_TYPE_CONFIGS", () => {
  it("has exactly 4 configs", () => {
    expect(DAY_TYPE_CONFIGS).toHaveLength(4);
  });

  it("covers all day types", () => {
    const types = DAY_TYPE_CONFIGS.map((c) => c.dayType).sort();
    expect(types).toEqual(["long_run", "rest", "strength_run", "threshold"]);
  });

  it("budget ratios sum to 1.0 for every day type", () => {
    for (const config of DAY_TYPE_CONFIGS) {
      const sum = config.variableSlots.mainMeal.budgetRatio + config.variableSlots.dinner.budgetRatio;
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    }
  });

  it("mainMeal recipe ≠ dinner recipe for every day type", () => {
    for (const config of DAY_TYPE_CONFIGS) {
      expect(config.variableSlots.mainMeal.recipeId).not.toBe(
        config.variableSlots.dinner.recipeId,
      );
    }
  });

  it("all referenced recipe IDs exist in RECIPE_TEMPLATES", () => {
    const validIds = new Set(RECIPE_TEMPLATES.map((t) => t.id));
    for (const config of DAY_TYPE_CONFIGS) {
      expect(validIds.has(config.variableSlots.mainMeal.recipeId)).toBe(true);
      expect(validIds.has(config.variableSlots.dinner.recipeId)).toBe(true);
    }
  });

  it("rest day has no preTraining", () => {
    const rest = findDayTypeConfig("rest");
    expect(rest.fixedSlots.preTraining).toBeNull();
  });

  it("training days have preTraining", () => {
    for (const type of ["strength_run", "threshold", "long_run"]) {
      const config = findDayTypeConfig(type);
      expect(config.fixedSlots.preTraining).not.toBeNull();
    }
  });

  it("all day types have flexDessert enabled (Skyr)", () => {
    for (const config of DAY_TYPE_CONFIGS) {
      expect(config.fixedSlots.flexDessert?.enabled).toBe(true);
    }
  });

  it("all day types have Hummus in afternoonSnack", () => {
    for (const config of DAY_TYPE_CONFIGS) {
      const hasHummus = config.fixedSlots.afternoonSnack.items.some(
        (i) => i.name.includes("Hummus"),
      );
      expect(hasHummus).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Calorie targets match sprint spec
// ═══════════════════════════════════════════════════════════════════════════

describe("Calorie targets (v1.2 — Intake = TDEE − 500)", () => {
  it("strength_run = 2853 (TDEE 3353 − 500)", () => {
    expect(findDayTypeConfig("strength_run").calorieTarget).toBe(2853);
  });

  it("threshold = 2439 (TDEE 2939 − 500)", () => {
    expect(findDayTypeConfig("threshold").calorieTarget).toBe(2439);
  });

  it("long_run = 2668 (TDEE 3168 − 500)", () => {
    expect(findDayTypeConfig("long_run").calorieTarget).toBe(2668);
  });

  it("rest = 2000 (TDEE 2500 capped − 500)", () => {
    expect(findDayTypeConfig("rest").calorieTarget).toBe(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recipe assignments match sprint spec table
// ═══════════════════════════════════════════════════════════════════════════

describe("Recipe assignments (v1.2)", () => {
  it("strength_run: chicken mainMeal, egg_asia_norice dinner", () => {
    const c = findDayTypeConfig("strength_run");
    expect(c.variableSlots.mainMeal.recipeId).toBe("chicken_rice_asia");
    expect(c.variableSlots.dinner.recipeId).toBe("egg_asia_norice");
  });

  it("threshold: chicken mainMeal, egg_chicken_rice_asia dinner (Lösung C)", () => {
    const c = findDayTypeConfig("threshold");
    expect(c.variableSlots.mainMeal.recipeId).toBe("chicken_rice_asia");
    expect(c.variableSlots.dinner.recipeId).toBe("egg_chicken_rice_asia");
  });

  it("long_run: hack mainMeal, chicken_rice_brokkoli dinner", () => {
    const c = findDayTypeConfig("long_run");
    expect(c.variableSlots.mainMeal.recipeId).toBe("hack_rice_brokkoli");
    expect(c.variableSlots.dinner.recipeId).toBe("chicken_rice_brokkoli");
  });

  it("rest: egg_asia_norice mainMeal (no rice), chicken_rice_brokkoli dinner", () => {
    const c = findDayTypeConfig("rest");
    expect(c.variableSlots.mainMeal.recipeId).toBe("egg_asia_norice");
    expect(c.variableSlots.dinner.recipeId).toBe("chicken_rice_brokkoli");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findDayTypeConfig
// ═══════════════════════════════════════════════════════════════════════════

describe("findDayTypeConfig", () => {
  it("throws for unknown day type", () => {
    expect(() => findDayTypeConfig("nonexistent")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Athlete weight constant
// ═══════════════════════════════════════════════════════════════════════════

describe("ATHLETE_WEIGHT_KG", () => {
  it("is 92", () => {
    expect(ATHLETE_WEIGHT_KG).toBe(92);
  });
});
