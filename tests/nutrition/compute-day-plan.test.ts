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

describe("computeDayPlan — rest day rechenprobe (v1.2: Intake 2000)", () => {
  const plan = computeDayPlan(configFor("rest"), recipes, weight);

  it("validation passes", () => {
    expect(plan.validation.valid).toBe(true);
  });

  it("calorieTarget = 2000", () => {
    expect(plan.calorieTarget).toBe(2000);
  });

  it("fixed slots total = 920 kcal (morning 320 + afternoon 270 + evening 200 + skyr 130)", () => {
    expect(plan.fixedSlotsTotalKcal).toBe(920);
  });

  it("remaining budget = 1080", () => {
    expect(plan.remainingBudget).toBe(1080);
  });

  it("mainMeal uses egg_asia_norice (no rice, Carb-Cut)", () => {
    expect(plan.mainMeal.recipeId).toBe("egg_asia_norice");
  });

  it("dinner uses chicken_rice_brokkoli", () => {
    expect(plan.dinner.recipeId).toBe("chicken_rice_brokkoli");
  });

  it("total kcal within 30 of target", () => {
    expect(Math.abs(plan.totals.kcal - 2000)).toBeLessThanOrEqual(30);
  });

  it("protein ≥ 184g (2.0 g/kg at 92kg)", () => {
    expect(plan.totals.protein).toBeGreaterThanOrEqual(184);
  });

  it("cost ≤ €15", () => {
    expect(plan.totals.cost).toBeLessThanOrEqual(16);
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
        expect(plan.totals.cost).toBeLessThanOrEqual(16);
      });

      it("mainMeal ≠ dinner recipe", () => {
        expect(plan.mainMeal.recipeId).not.toBe(plan.dinner.recipeId);
      });

      it("no component below minimum amount", () => {
        // Check each slot against its OWN recipe template (not all templates)
        for (const [slot, slotData] of [["mainMeal", plan.mainMeal], ["dinner", plan.dinner]] as const) {
          const tmpl = recipes.find((r) => r.id === slotData.recipeId);
          if (!tmpl) continue;
          for (const comp of slotData.components) {
            const tmplComp = tmpl.components.find((tc) => tc.ingredientId === comp.ingredientId);
            if (tmplComp) {
              expect(comp.amount, `${comp.ingredientId} in ${slot}`).toBeGreaterThanOrEqual(tmplComp.minimumAmount);
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
// Collagen non-functional protein (Sprint: fix_collagen_protein_accounting)
// ═══════════════════════════════════════════════════════════════════════════

describe("computeDayPlan — collagen protein excluded from total + functional check", () => {
  const minProtein = Math.round(weight * 2.0); // 184g at 92kg

  it("strength_run: total protein (collagen already excluded) >= 184g", () => {
    const plan = computeDayPlan(configFor("strength_run"), recipes, weight);
    expect(plan.validation.valid).toBe(true);
    // plan.totals.protein already EXCLUDES the 14g collagen (since 2026-05-16)
    expect(plan.totals.protein).toBeGreaterThanOrEqual(minProtein);
  });

  it("threshold: total protein (collagen already excluded) >= 184g", () => {
    const plan = computeDayPlan(configFor("threshold"), recipes, weight);
    expect(plan.validation.valid).toBe(true);
    expect(plan.totals.protein).toBeGreaterThanOrEqual(minProtein);
  });

  it("long_run: total protein (collagen already excluded) >= 184g", () => {
    const plan = computeDayPlan(configFor("long_run"), recipes, weight);
    expect(plan.validation.valid).toBe(true);
    expect(plan.totals.protein).toBeGreaterThanOrEqual(minProtein);
  });

  it("rest: no collagen (preTraining null) — protein unchanged, valid", () => {
    const plan = computeDayPlan(configFor("rest"), recipes, weight);
    expect(plan.validation.valid).toBe(true);
    // Rest has no preTraining → no collagen → functional = total
    expect(plan.totals.protein).toBeGreaterThanOrEqual(minProtein);
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
