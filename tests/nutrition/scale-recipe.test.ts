import { describe, expect, it } from "vitest";
import { scaleRecipe } from "@/lib/nutrition/scale-recipe";
import { findRecipeTemplate, RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";

// ═══════════════════════════════════════════════════════════════════════════
// scaleRecipe — core scaling logic
// ═══════════════════════════════════════════════════════════════════════════

describe("scaleRecipe", () => {
  // ── Sprint doc rechenprobe: rest day mainMeal (egg_rice_asia, 814 kcal) ──

  describe("egg_rice_asia at 814 kcal (rest day mainMeal)", () => {
    const template = findRecipeTemplate("egg_rice_asia");
    const result = scaleRecipe(template, 814);

    it("returns correct recipeId", () => {
      expect(result.recipeId).toBe("egg_rice_asia");
    });

    it("eggs are between 3 and 8", () => {
      const eggs = result.components.find((c) => c.ingredientId === "eggs");
      expect(eggs).toBeDefined();
      expect(eggs!.amount).toBeGreaterThanOrEqual(3);
      expect(eggs!.amount).toBeLessThanOrEqual(8);
    });

    it("eggs are whole numbers (stepSize=1)", () => {
      const eggs = result.components.find((c) => c.ingredientId === "eggs");
      expect(Number.isInteger(eggs!.amount)).toBe(true);
    });

    it("rice is at least 50g (minimum)", () => {
      const rice = result.components.find((c) => c.ingredientId === "rice_dry");
      expect(rice).toBeDefined();
      expect(rice!.amount).toBeGreaterThanOrEqual(50);
    });

    it("rice is in 10g steps (v1.9.1: flexible grams)", () => {
      const rice = result.components.find((c) => c.ingredientId === "rice_dry");
      expect(rice!.amount % 10).toBe(0);
    });

    it("vegetable is at minimum (150g)", () => {
      const veg = result.components.find((c) => c.ingredientId === "tk_asia_gemuse");
      expect(veg).toBeDefined();
      expect(veg!.amount).toBe(150);
    });

    it("total kcal is within one rice-bag of target (v1.9: 125g quantization)", () => {
      // Budget-driven rice now snaps to 125g bags, so an isolated recipe can be
      // off by up to ~half a bag; the day-level engine absorbs this via protein.
      expect(Math.abs(result.totals.kcal - 814)).toBeLessThanOrEqual(230);
    });
  });

  // ── Sprint doc rechenprobe: rest day dinner (hack_brokkoli_norice, 666 kcal) ──

  describe("hack_brokkoli_norice at 666 kcal (rest day dinner)", () => {
    const template = findRecipeTemplate("hack_brokkoli_norice");
    const result = scaleRecipe(template, 666);

    it("returns correct recipeId", () => {
      expect(result.recipeId).toBe("hack_brokkoli_norice");
    });

    it("hack is between 100g and 350g", () => {
      const hack = result.components.find((c) => c.ingredientId === "beef_mince");
      expect(hack).toBeDefined();
      expect(hack!.amount).toBeGreaterThanOrEqual(100);
      expect(hack!.amount).toBeLessThanOrEqual(350);
    });

    it("hack is in 25g steps", () => {
      const hack = result.components.find((c) => c.ingredientId === "beef_mince");
      expect(hack!.amount % 25).toBe(0);
    });

    it("no rice component (dinner recipe)", () => {
      const rice = result.components.find((c) => c.ingredientId === "rice_dry");
      expect(rice).toBeUndefined();
    });

    it("vegetable is at minimum (150g)", () => {
      const veg = result.components.find((c) => c.ingredientId === "tk_brokkoli");
      expect(veg).toBeDefined();
      expect(veg!.amount).toBe(150);
    });

    it("total kcal is within 50 of target", () => {
      expect(Math.abs(result.totals.kcal - 666)).toBeLessThanOrEqual(50);
    });
  });

  // ── MainMeal with rice (chicken) ──

  describe("chicken_rice_asia at 770 kcal (strength_run mainMeal)", () => {
    const template = findRecipeTemplate("chicken_rice_asia");
    const result = scaleRecipe(template, 770);

    it("chicken between 100-400g", () => {
      const chicken = result.components.find((c) => c.ingredientId === "chicken_breast");
      expect(chicken!.amount).toBeGreaterThanOrEqual(100);
      expect(chicken!.amount).toBeLessThanOrEqual(400);
    });

    it("chicken in 25g steps", () => {
      const chicken = result.components.find((c) => c.ingredientId === "chicken_breast");
      expect(chicken!.amount % 25).toBe(0);
    });

    it("rice present and >= 50g", () => {
      const rice = result.components.find((c) => c.ingredientId === "rice_dry");
      expect(rice).toBeDefined();
      expect(rice!.amount).toBeGreaterThanOrEqual(50);
    });

    it("includes sauces in totals", () => {
      expect(result.sauces.length).toBeGreaterThan(0);
      expect(result.totals.kcal).toBeGreaterThan(
        result.components.reduce((s, c) => s + c.kcal, 0),
      );
    });
  });

  // ── Dinner no-rice (egg) ──

  describe("egg_asia_norice at 630 kcal (dinner)", () => {
    const template = findRecipeTemplate("egg_asia_norice");
    const result = scaleRecipe(template, 630);

    it("eggs between 3-8", () => {
      const eggs = result.components.find((c) => c.ingredientId === "eggs");
      expect(eggs!.amount).toBeGreaterThanOrEqual(3);
      expect(eggs!.amount).toBeLessThanOrEqual(8);
    });

    it("no rice", () => {
      expect(result.components.find((c) => c.ingredientId === "rice_dry")).toBeUndefined();
    });
  });

  // ── Edge cases ──

  it("throws on impossible budget (too low)", () => {
    const template = findRecipeTemplate("chicken_rice_asia");
    expect(() => scaleRecipe(template, 50)).toThrow();
  });

  it("is deterministic", () => {
    const template = findRecipeTemplate("chicken_rice_asia");
    const a = scaleRecipe(template, 800);
    const b = scaleRecipe(template, 800);
    expect(a).toEqual(b);
  });

  it("all 6 templates can scale to 700 kcal without throwing", () => {
    for (const template of RECIPE_TEMPLATES) {
      expect(() => scaleRecipe(template, 700)).not.toThrow();
    }
  });

  it("component names include human-readable labels", () => {
    const result = scaleRecipe(findRecipeTemplate("chicken_rice_asia"), 800);
    const chicken = result.components.find((c) => c.ingredientId === "chicken_breast");
    expect(chicken!.name).toContain("Hähnchenbrust");
    expect(chicken!.name).toMatch(/\d+g/);
  });

  it("egg component names use 'Stück'", () => {
    const result = scaleRecipe(findRecipeTemplate("egg_rice_asia"), 800);
    const eggs = result.components.find((c) => c.ingredientId === "eggs");
    expect(eggs!.name).toContain("Eier");
    expect(eggs!.name).toContain("Stück");
  });

  // ── Multi-protein (v1.9 revert): eggs PRIMARY (scaling) + chicken (150g) FIXED
  //    secondary. Egg white removed. ──

  describe("egg_chicken_rice_asia (multi-protein)", () => {
    const template = findRecipeTemplate("egg_chicken_rice_asia");

    it("returns egg + chicken protein components in output", () => {
      const result = scaleRecipe(template, 657);
      const eggs = result.components.find((c) => c.ingredientId === "eggs");
      const chicken = result.components.find((c) => c.ingredientId === "chicken_breast");
      expect(eggs).toBeDefined();
      expect(chicken).toBeDefined();
    });

    it("chicken (secondary) is at minimumAmount 150g (v1.7 floor kept)", () => {
      const result = scaleRecipe(template, 657);
      const chicken = result.components.find((c) => c.ingredientId === "chicken_breast");
      expect(chicken!.amount).toBe(150);
    });

    it("eggs (primary) scale flexibly with budget", () => {
      const lowEggs = scaleRecipe(template, 500).components.find((c) => c.ingredientId === "eggs")!.amount;
      const highEggs = scaleRecipe(template, 800).components.find((c) => c.ingredientId === "eggs")!.amount;
      expect(highEggs).toBeGreaterThanOrEqual(lowEggs);
    });

    it("total protein scales up with budget", () => {
      const low = scaleRecipe(template, 500).totals.protein;
      const high = scaleRecipe(template, 800).totals.protein;
      expect(high).toBeGreaterThan(low);
    });

    it("threshold dinner (657 kcal): protein >= 40g", () => {
      const result = scaleRecipe(template, 657);
      expect(result.totals.protein).toBeGreaterThanOrEqual(40);
    });

    it("total kcal within one rice-bag of target (v1.9: 125g quantization)", () => {
      const result = scaleRecipe(template, 657);
      expect(Math.abs(result.totals.kcal - 657)).toBeLessThanOrEqual(230);
    });

    it("rice and vegetable are also present", () => {
      const result = scaleRecipe(template, 657);
      expect(result.components.find((c) => c.ingredientId === "rice_dry")).toBeDefined();
      expect(result.components.find((c) => c.ingredientId === "tk_asia_gemuse")).toBeDefined();
    });

    it("is deterministic across budgets", () => {
      for (const budget of [500, 600, 700, 800]) {
        const a = scaleRecipe(template, budget);
        const b = scaleRecipe(template, budget);
        expect(a).toEqual(b);
      }
    });
  });

  // ── v1.3: Regression — single-protein recipes unaffected ──

  it("single-protein recipes still produce valid results", () => {
    const singleProteinTemplates = RECIPE_TEMPLATES.filter(
      (t) => t.components.filter((c) => c.role === "protein").length === 1,
    );
    // v1.7: egg recipes are now multi-protein (egg white + whole eggs), so only
    // the meat-only recipes remain single-protein (chicken×2, hack×2 = 4).
    expect(singleProteinTemplates.length).toBeGreaterThanOrEqual(4);
    for (const t of singleProteinTemplates) {
      const result = scaleRecipe(t, 700);
      expect(result.components.length).toBeGreaterThan(0);
      expect(result.totals.kcal).toBeGreaterThan(0);
    }
  });
});
