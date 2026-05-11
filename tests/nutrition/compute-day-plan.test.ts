import { describe, expect, it } from "vitest";
import { computeDayPlan } from "@/lib/nutrition/compute-day-plan";
import { DAY_TYPE_CONFIGS, ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import type { DayTypeConfig } from "@/lib/nutrition/types";

const recipes = RECIPE_TEMPLATES;
const weight = ATHLETE_WEIGHT_KG;

function configFor(dayType: string): DayTypeConfig {
  const c = DAY_TYPE_CONFIGS.find((cfg) => cfg.dayType === dayType);
  if (!c) throw new Error(`No config for ${dayType}`);
  return c;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint doc rechenprobe: Rest day (So/Mi)
// ═══════════════════════════════════════════════════════════════════════════

describe("computeDayPlan — rest day rechenprobe", () => {
  const plan = computeDayPlan(configFor("rest"), recipes, weight);

  it("validation passes", () => {
    expect(plan.validation.valid).toBe(true);
  });

  it("calorieTarget = 2400", () => {
    expect(plan.calorieTarget).toBe(2400);
  });

  it("fixed slots total = 920 kcal (morning 320 + afternoon 270 + evening 200 + skyr 130)", () => {
    expect(plan.fixedSlotsTotalKcal).toBe(920);
  });

  it("remaining budget = 1480", () => {
    expect(plan.remainingBudget).toBe(1480);
  });

  it("mainMeal uses egg_rice_asia", () => {
    expect(plan.mainMeal.recipeId).toBe("egg_rice_asia");
  });

  it("dinner uses hack_brokkoli_norice", () => {
    expect(plan.dinner.recipeId).toBe("hack_brokkoli_norice");
  });

  it("total kcal within 30 of target", () => {
    expect(Math.abs(plan.totals.kcal - 2400)).toBeLessThanOrEqual(30);
  });

  it("protein ≥ 184g (2.0 g/kg at 92kg)", () => {
    expect(plan.totals.protein).toBeGreaterThanOrEqual(184);
  });

  it("cost ≤ €15", () => {
    expect(plan.totals.cost).toBeLessThanOrEqual(15);
  });

  it("mainMeal ≠ dinner recipe", () => {
    expect(plan.mainMeal.recipeId).not.toBe(plan.dinner.recipeId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// All 4 day types pass validation
// ═══════════════════════════════════════════════════════════════════════════

describe("computeDayPlan — all day types valid", () => {
  for (const config of DAY_TYPE_CONFIGS) {
    describe(config.dayType, () => {
      const plan = computeDayPlan(config, recipes, weight);

      it("validation passes", () => {
        expect(plan.validation.valid).toBe(true);
      });

      it(`|kcal - target| ≤ 30 (target=${config.calorieTarget})`, () => {
        expect(Math.abs(plan.totals.kcal - config.calorieTarget)).toBeLessThanOrEqual(30);
      });

      it("protein ≥ 184g", () => {
        expect(plan.totals.protein).toBeGreaterThanOrEqual(184);
      });

      it("cost ≤ €15", () => {
        expect(plan.totals.cost).toBeLessThanOrEqual(15);
      });

      it("mainMeal ≠ dinner recipe", () => {
        expect(plan.mainMeal.recipeId).not.toBe(plan.dinner.recipeId);
      });

      it("no component below minimum amount", () => {
        for (const comp of [...plan.mainMeal.components, ...plan.dinner.components]) {
          // Find the template component to check its minimum
          const allTemplates = [...recipes];
          for (const tmpl of allTemplates) {
            const tmplComp = tmpl.components.find((tc) => tc.ingredientId === comp.ingredientId);
            if (tmplComp) {
              expect(comp.amount).toBeGreaterThanOrEqual(tmplComp.minimumAmount);
              break;
            }
          }
        }
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Guards and edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("computeDayPlan — guards", () => {
  it("throws if remaining budget < 400 kcal", () => {
    const badConfig: DayTypeConfig = {
      ...configFor("strength_run"),
      calorieTarget: 800, // way too low for fixed slots
    };
    expect(() => computeDayPlan(badConfig, recipes, weight)).toThrow("Remaining budget too low");
  });

  it("detects invalid budget ratio sum", () => {
    const badConfig: DayTypeConfig = {
      ...configFor("strength_run"),
      variableSlots: {
        mainMeal: { recipeId: "chicken_rice_asia", budgetRatio: 0.6 },
        dinner: { recipeId: "egg_asia_norice", budgetRatio: 0.6 }, // sum = 1.2
      },
    };
    const plan = computeDayPlan(badConfig, recipes, weight);
    expect(plan.validation.valid).toBe(false);
    expect(plan.validation.errors.some((e) => e.includes("Budget ratios"))).toBe(true);
  });

  it("detects same recipe for mainMeal and dinner", () => {
    const badConfig: DayTypeConfig = {
      ...configFor("strength_run"),
      variableSlots: {
        mainMeal: { recipeId: "chicken_rice_asia", budgetRatio: 0.55 },
        dinner: { recipeId: "chicken_rice_asia", budgetRatio: 0.45 },
      },
    };
    const plan = computeDayPlan(badConfig, recipes, weight);
    expect(plan.validation.valid).toBe(false);
    expect(plan.validation.errors.some((e) => e.includes("same recipe"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("computeDayPlan — determinism", () => {
  it("same inputs → same outputs", () => {
    const config = configFor("strength_run");
    const a = computeDayPlan(config, recipes, weight);
    const b = computeDayPlan(config, recipes, weight);
    expect(a).toEqual(b);
  });
});
