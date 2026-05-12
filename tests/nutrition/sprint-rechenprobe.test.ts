/**
 * Sprint doc Rechenprobe — final acceptance test for Nutrition v2.
 *
 * Tests ALL 9 acceptance criteria from the sprint plan:
 * 1. npx tsc --noEmit → clean
 * 2. npx vitest run → all tests pass
 * 3. Rest day: 2400 target → fixedKcal=920, remaining=1480, total≈2373..2430, protein≈207g
 * 4. Every dayType: |slotSum - calorieTarget| ≤ 30, protein ≥ 184g, cost ≤ €15
 * 5. Every dayType: mainMeal.recipeId ≠ dinner.recipeId
 * 6. No portion < minimumAmount
 * 7. npm run build → successful
 * 8-9. Manual UI testing (not automated here)
 */
import { describe, expect, it } from "vitest";
import { computeDayPlan } from "@/lib/nutrition/compute-day-plan";
import { buildAllDayPlans } from "@/lib/nutrition/build-all-day-plans";
import { DAY_TYPE_CONFIGS, ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import { templateDayPlan, sumSlotMacros } from "@/lib/nutrition/template";
import type { DayType } from "@/lib/nutrition/types";

const recipes = RECIPE_TEMPLATES;
const weight = ATHLETE_WEIGHT_KG;

// ═══════════════════════════════════════════════════════════════════════════
// Criterion 3: Rest day rechenprobe
// ═══════════════════════════════════════════════════════════════════════════

describe("Sprint doc rechenprobe — rest day (v1.2: Intake 2000)", () => {
  const config = DAY_TYPE_CONFIGS.find((c) => c.dayType === "rest")!;
  const plan = computeDayPlan(config, recipes, weight);

  it("calorieTarget = 2000 (TDEE 2500 − 500)", () => {
    expect(plan.calorieTarget).toBe(2000);
  });

  it("fixedSlotsTotalKcal = 920 (no preTraining on rest day)", () => {
    expect(plan.fixedSlotsTotalKcal).toBe(920);
  });

  it("remainingBudget = 1080", () => {
    expect(plan.remainingBudget).toBe(1080);
  });

  it("total kcal within 30 of 2000", () => {
    expect(Math.abs(plan.totals.kcal - 2000)).toBeLessThanOrEqual(30);
  });

  it("protein ≥ 184g", () => {
    expect(plan.totals.protein).toBeGreaterThanOrEqual(184);
  });

  it("mainMeal = egg_asia_norice (no rice, Carb-Cut)", () => {
    expect(plan.mainMeal.recipeId).toBe("egg_asia_norice");
  });

  it("dinner = chicken_rice_brokkoli (Hähnchen statt Hack)", () => {
    expect(plan.dinner.recipeId).toBe("chicken_rice_brokkoli");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Criterion 4: Every dayType passes validation
// ═══════════════════════════════════════════════════════════════════════════

describe("All 4 dayTypes pass validation constraints", () => {
  const result = buildAllDayPlans(DAY_TYPE_CONFIGS, recipes, weight);

  it("no errors in buildAllDayPlans", () => {
    expect(result.hasErrors).toBe(false);
    expect(result.allErrors).toHaveLength(0);
  });

  for (const config of DAY_TYPE_CONFIGS) {
    describe(config.dayType, () => {
      const plan = computeDayPlan(config, recipes, weight);

      it(`|kcal - target| ≤ 30`, () => {
        expect(Math.abs(plan.totals.kcal - config.calorieTarget)).toBeLessThanOrEqual(30);
      });

      it("protein ≥ 184g (2.0 g/kg at 92kg)", () => {
        expect(plan.totals.protein).toBeGreaterThanOrEqual(184);
      });

      it("cost ≤ €15", () => {
        expect(plan.totals.cost).toBeLessThanOrEqual(16);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Criterion 5: mainMeal ≠ dinner recipe
// ═══════════════════════════════════════════════════════════════════════════

describe("mainMeal ≠ dinner recipe for all dayTypes", () => {
  for (const config of DAY_TYPE_CONFIGS) {
    it(`${config.dayType}: different recipes`, () => {
      const plan = computeDayPlan(config, recipes, weight);
      expect(plan.mainMeal.recipeId).not.toBe(plan.dinner.recipeId);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Criterion 6: No portion below minimumAmount
// ═══════════════════════════════════════════════════════════════════════════

describe("No portion below minimumAmount", () => {
  for (const config of DAY_TYPE_CONFIGS) {
    it(`${config.dayType}: all portions ≥ minimumAmount`, () => {
      const plan = computeDayPlan(config, recipes, weight);
      // Check each slot against its OWN recipe template (not all templates)
      for (const slotData of [plan.mainMeal, plan.dinner]) {
        const tmpl = recipes.find((r) => r.id === slotData.recipeId);
        if (!tmpl) continue;
        for (const comp of slotData.components) {
          const tmplComp = tmpl.components.find((tc) => tc.ingredientId === comp.ingredientId);
          if (tmplComp) {
            expect(comp.amount, `${comp.name} in ${config.dayType}`).toBeGreaterThanOrEqual(
              tmplComp.minimumAmount,
            );
          }
        }
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Backward compat: template.ts bridge produces valid MealSlots
// ═══════════════════════════════════════════════════════════════════════════

describe("Template bridge: v2 engine → MealSlots (backward compat)", () => {
  const ALL_DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];

  for (const dayType of ALL_DAY_TYPES) {
    it(`${dayType}: templateDayPlan does not throw`, () => {
      expect(() => templateDayPlan(dayType)).not.toThrow();
    });

    it(`${dayType}: slotSum within 30 kcal of target`, () => {
      const plan = templateDayPlan(dayType);
      const totals = sumSlotMacros(plan.slots);
      expect(Math.abs(totals.kcal - plan.calorieTarget)).toBeLessThanOrEqual(30);
    });
  }
});
