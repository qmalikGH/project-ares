import { describe, expect, it } from "vitest";
import {
  RECIPES,
  WEEKLY_RECIPE_BY_WEEKDAY,
  getRecipeForDate,
} from "@/lib/nutrition/recipes";

describe("RECIPES library", () => {
  it("has all 3 canonical recipes", () => {
    expect(RECIPES.chicken_rice_tkgemuse).toBeDefined();
    expect(RECIPES.hack_rice_tkgemuse).toBeDefined();
    expect(RECIPES.egg_rice_tkgemuse).toBeDefined();
  });

  it("each recipe has at least 4 ingredients", () => {
    for (const [name, r] of Object.entries(RECIPES)) {
      expect(r.ingredients.length, `${name} ingredient count`).toBeGreaterThanOrEqual(4);
    }
  });

  it("perServing values match Sprint spec for chicken (650 kcal / 50g protein)", () => {
    expect(RECIPES.chicken_rice_tkgemuse.perServing.kcal).toBe(650);
    expect(RECIPES.chicken_rice_tkgemuse.perServing.protein).toBe(50);
  });

  it("perServing values match Sprint spec for hack (700 kcal / 45g protein)", () => {
    expect(RECIPES.hack_rice_tkgemuse.perServing.kcal).toBe(700);
    expect(RECIPES.hack_rice_tkgemuse.perServing.protein).toBe(45);
  });

  it("egg recipe has 1 serving (fresh/flex)", () => {
    expect(RECIPES.egg_rice_tkgemuse.servings).toBe(1);
  });

  it("meal-prep recipes have 3 servings (cook for 3 days)", () => {
    expect(RECIPES.chicken_rice_tkgemuse.servings).toBe(3);
    expect(RECIPES.hack_rice_tkgemuse.servings).toBe(3);
  });

  it("each recipe key references itself in `key` field", () => {
    for (const [name, r] of Object.entries(RECIPES)) {
      expect(r.key, `${name}.key`).toBe(name);
    }
  });
});

const MON = new Date("2026-05-04T00:00:00.000Z");
const TUE = new Date("2026-05-05T00:00:00.000Z");
const WED = new Date("2026-05-06T00:00:00.000Z");
const THU = new Date("2026-05-07T00:00:00.000Z");
const FRI = new Date("2026-05-08T00:00:00.000Z");
const SAT = new Date("2026-05-09T00:00:00.000Z");
const SUN = new Date("2026-05-10T00:00:00.000Z");

describe("WEEKLY_RECIPE_BY_WEEKDAY", () => {
  it("Mon-Wed map to chicken_rice", () => {
    expect(getRecipeForDate(MON).key).toBe("chicken_rice_tkgemuse");
    expect(getRecipeForDate(TUE).key).toBe("chicken_rice_tkgemuse");
    expect(getRecipeForDate(WED).key).toBe("chicken_rice_tkgemuse");
  });

  it("Thu-Sat map to hack_rice", () => {
    expect(getRecipeForDate(THU).key).toBe("hack_rice_tkgemuse");
    expect(getRecipeForDate(FRI).key).toBe("hack_rice_tkgemuse");
    expect(getRecipeForDate(SAT).key).toBe("hack_rice_tkgemuse");
  });

  it("Sun maps to egg_rice (flex)", () => {
    expect(getRecipeForDate(SUN).key).toBe("egg_rice_tkgemuse");
  });

  it("WEEKLY_RECIPE_BY_WEEKDAY has all 7 days assigned", () => {
    for (let d = 0; d < 7; d++) {
      expect(WEEKLY_RECIPE_BY_WEEKDAY[d], `weekday ${d}`).toBeDefined();
    }
  });
});
