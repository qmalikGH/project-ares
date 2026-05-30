// Sprint v1.7 — Portion sanity + two-tier protein + fat guard-rails + Eiklar.
// Asserts every day type ships USABLE portions after the −600 cut, and that
// validatePortionSanity fails LOUD on a sub-floor sliver.

import { describe, expect, it } from "vitest";
import { computeDayPlan, validatePortionSanity } from "@/lib/nutrition/compute-day-plan";
import { DAY_TYPE_CONFIGS, ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import type { ScaledRecipe } from "@/lib/nutrition/types";

const recipes = RECIPE_TEMPLATES;
const weight = ATHLETE_WEIGHT_KG;

describe("Sprint v1.7 — day plans: portions usable + two-tier protein + fat", () => {
  for (const config of DAY_TYPE_CONFIGS) {
    describe(config.dayType, () => {
      const plan = computeDayPlan(config, recipes, weight);

      it("validation passes", () => {
        expect(plan.validation.valid, JSON.stringify(plan.validation.errors)).toBe(true);
      });

      it("functional protein ≥ hard floor 165g (1.8 g/kg)", () => {
        expect(plan.totals.protein).toBeGreaterThanOrEqual(165);
      });

      it("functional protein clears the hard floor with margin (≥166g)", () => {
        // v1.9: rice cook-bags take budget, so protein lands ~169–182g (above
        // the 1.8 g/kg hard floor); the 2.2 soft target is maximize-toward, not guaranteed.
        expect(plan.totals.protein).toBeGreaterThanOrEqual(166);
      });

      it("fat within guard-rails 46–85g", () => {
        expect(plan.totals.fat).toBeGreaterThanOrEqual(46);
        expect(plan.totals.fat).toBeLessThanOrEqual(85);
      });

      it("chicken (where present) is 150–275g — no sliver", () => {
        for (const slot of [plan.mainMeal, plan.dinner]) {
          const chicken = slot.components.find((c) => c.ingredientId === "chicken_breast");
          if (chicken) {
            expect(chicken.amount).toBeGreaterThanOrEqual(150);
            expect(chicken.amount).toBeLessThanOrEqual(275);
          }
        }
      });

      it("whole eggs (where present) are integers", () => {
        for (const slot of [plan.mainMeal, plan.dinner]) {
          const eggs = slot.components.find((c) => c.ingredientId === "eggs");
          if (eggs) expect(Number.isInteger(eggs.amount)).toBe(true);
        }
      });

      it("egg white (where present) is in 50ml steps", () => {
        for (const slot of [plan.mainMeal, plan.dinner]) {
          const ew = slot.components.find((c) => c.ingredientId === "egg_white_liquid");
          if (ew) expect(ew.amount % 50).toBe(0);
        }
      });

      it("portion-sanity helper reports no errors for the real plan", () => {
        expect(validatePortionSanity(plan.mainMeal, "MainMeal")).toEqual([]);
        expect(validatePortionSanity(plan.dinner, "Dinner")).toEqual([]);
      });
    });
  }
});

describe("validatePortionSanity — fails LOUD on a sub-floor sliver", () => {
  it("flags a 90g chicken sliver (below 150g floor)", () => {
    const sliver: ScaledRecipe = {
      recipeId: "test",
      recipeName: "test",
      components: [
        { ingredientId: "chicken_breast", name: "Hähnchenbrust 90g", amount: 90, unit: "g", kcal: 99, protein: 20, carbs: 0, fat: 1, cost: 0.8 },
      ],
      sauces: [],
      totals: { kcal: 99, protein: 20, carbs: 0, fat: 1, cost: 0.8 },
    };
    const errs = validatePortionSanity(sliver, "Dinner");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain("chicken_breast");
  });

  it("flags non-whole eggs", () => {
    const broken: ScaledRecipe = {
      recipeId: "test",
      recipeName: "test",
      components: [
        { ingredientId: "eggs", name: "Eier 2.5 Stück", amount: 2.5, unit: "stück", kcal: 195, protein: 15, carbs: 1.5, fat: 13, cost: 0.6 },
      ],
      sauces: [],
      totals: { kcal: 195, protein: 15, carbs: 1.5, fat: 13, cost: 0.6 },
    };
    const errs = validatePortionSanity(broken, "MainMeal");
    expect(errs.some((e) => e.includes("not a whole number"))).toBe(true);
  });
});
