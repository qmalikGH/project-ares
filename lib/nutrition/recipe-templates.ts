// Recipe template definitions — Nutrition v2.
//
// Each template stores per-unit nutritional data + min/max/step constraints.
// Templates know NOTHING about portion sizes — the cascade computes those
// via scaleRecipe(). This is the WHAT; the cascade is the HOW MUCH.
//
// 6 recipes: 3 mainMeal (with rice), 3 dinner (without rice).

import type { RecipeTemplate } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// MainMeal recipes (with rice as carb filler)
// ═══════════════════════════════════════════════════════════════════════════

const CHICKEN_RICE_ASIA: RecipeTemplate = {
  id: "chicken_rice_asia",
  name: "Hähnchen + Reis + TK Asia-Gemüse",
  components: [
    {
      ingredientId: "chicken_breast",
      role: "protein",
      portionUnit: "g",
      kcalPerUnit: 1.1, // 110 kcal / 100g
      proteinPerUnit: 0.22, // 22g / 100g
      carbsPerUnit: 0,
      fatPerUnit: 0.01,
      costPerUnit: 0.0092, // €9.20/kg
      minimumAmount: 100,
      maximumAmount: 200, // chicken-only protein 44g (under 50g MPS soft cap). Rice protein doesn't count toward MPS.
      stepSize: 25,
    },
    {
      ingredientId: "rice_dry",  // stepSize 10g for ±30 kcal precision
      role: "carb",
      portionUnit: "g",
      kcalPerUnit: 3.6, // 360 kcal / 100g dry
      proteinPerUnit: 0.07,
      carbsPerUnit: 0.78,
      fatPerUnit: 0.01,
      costPerUnit: 0.002, // €2/kg
      minimumAmount: 50, // MINIMUM 50g, never less
      maximumAmount: 200,
      stepSize: 10,
    },
    {
      ingredientId: "tk_asia_gemuse",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.24, // 60 kcal / 250g
      proteinPerUnit: 0.012,
      carbsPerUnit: 0.03,
      fatPerUnit: 0.004,
      costPerUnit: 0.0024, // €2.40/kg
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Öl + Sojasauce", kcal: 50, protein: 0, carbs: 1, fat: 5, cost: 0.15 }],
};

const HACK_RICE_BROKKOLI: RecipeTemplate = {
  id: "hack_rice_brokkoli",
  name: "Rinderhack + Reis + TK Brokkoli",
  components: [
    {
      ingredientId: "beef_mince",
      role: "protein",
      portionUnit: "g",
      kcalPerUnit: 2.12, // 212 kcal / 100g (10% fat)
      proteinPerUnit: 0.2,
      carbsPerUnit: 0,
      fatPerUnit: 0.13,
      costPerUnit: 0.0089, // ~€8.90/kg REWE
      minimumAmount: 100,
      maximumAmount: 350,
      stepSize: 25,
    },
    {
      ingredientId: "rice_dry",  // stepSize 10g for ±30 kcal precision
      role: "carb",
      portionUnit: "g",
      kcalPerUnit: 3.6,
      proteinPerUnit: 0.07,
      carbsPerUnit: 0.78,
      fatPerUnit: 0.01,
      costPerUnit: 0.002,
      minimumAmount: 50,
      maximumAmount: 200,
      stepSize: 10,
    },
    {
      ingredientId: "tk_brokkoli",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.34,
      proteinPerUnit: 0.028,
      carbsPerUnit: 0.04,
      fatPerUnit: 0.004,
      costPerUnit: 0.0022,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

const EGG_RICE_ASIA: RecipeTemplate = {
  id: "egg_rice_asia",
  name: "Eier + Reis + TK Asia-Gemüse",
  components: [
    {
      ingredientId: "eggs",
      role: "protein",
      portionUnit: "stück",
      kcalPerUnit: 78, // 78 kcal per egg (size M)
      proteinPerUnit: 6,
      carbsPerUnit: 0.6,
      fatPerUnit: 5.3,
      costPerUnit: 0.25, // €3/12er REWE
      minimumAmount: 3,
      maximumAmount: 8,
      stepSize: 1,
    },
    {
      ingredientId: "rice_dry",
      role: "carb",
      portionUnit: "g",
      kcalPerUnit: 3.6,
      proteinPerUnit: 0.07,
      carbsPerUnit: 0.78,
      fatPerUnit: 0.01,
      costPerUnit: 0.002,
      minimumAmount: 50,
      maximumAmount: 200,
      stepSize: 10,
    },
    {
      ingredientId: "tk_asia_gemuse",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.24,
      proteinPerUnit: 0.012,
      carbsPerUnit: 0.03,
      fatPerUnit: 0.004,
      costPerUnit: 0.0024,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

// ═══════════════════════════════════════════════════════════════════════════
// Dinner recipes (no rice — lighter, protein-focused)
// ═══════════════════════════════════════════════════════════════════════════

const EGG_ASIA_NORICE: RecipeTemplate = {
  id: "egg_asia_norice",
  name: "Eier + TK Asia-Gemüse",
  components: [
    {
      ingredientId: "eggs",
      role: "protein",
      portionUnit: "stück",
      kcalPerUnit: 78,
      proteinPerUnit: 6,
      carbsPerUnit: 0.6,
      fatPerUnit: 5.3,
      costPerUnit: 0.25,
      minimumAmount: 3,
      maximumAmount: 8,
      stepSize: 1,
    },
    {
      ingredientId: "tk_asia_gemuse",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.24,
      proteinPerUnit: 0.012,
      carbsPerUnit: 0.03,
      fatPerUnit: 0.004,
      costPerUnit: 0.0024,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

const EGG_BROKKOLI_NORICE: RecipeTemplate = {
  id: "egg_brokkoli_norice",
  name: "Eier + TK Brokkoli",
  components: [
    {
      ingredientId: "eggs",
      role: "protein",
      portionUnit: "stück",
      kcalPerUnit: 78,
      proteinPerUnit: 6,
      carbsPerUnit: 0.6,
      fatPerUnit: 5.3,
      costPerUnit: 0.25,
      minimumAmount: 3,
      maximumAmount: 8,
      stepSize: 1,
    },
    {
      ingredientId: "tk_brokkoli",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.34,
      proteinPerUnit: 0.028,
      carbsPerUnit: 0.04,
      fatPerUnit: 0.004,
      costPerUnit: 0.0022,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

const HACK_BROKKOLI_NORICE: RecipeTemplate = {
  id: "hack_brokkoli_norice",
  name: "Rinderhack + TK Brokkoli",
  components: [
    {
      ingredientId: "beef_mince",
      role: "protein",
      portionUnit: "g",
      kcalPerUnit: 2.12,
      proteinPerUnit: 0.2,
      carbsPerUnit: 0,
      fatPerUnit: 0.13,
      costPerUnit: 0.0089,
      minimumAmount: 100,
      maximumAmount: 350,
      stepSize: 25,
    },
    {
      ingredientId: "tk_brokkoli",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.34,
      proteinPerUnit: 0.028,
      carbsPerUnit: 0.04,
      fatPerUnit: 0.004,
      costPerUnit: 0.0022,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

// ═══════════════════════════════════════════════════════════════════════════
// v1.2 recipes — Post-WO carb dinners + Rest-Day Hähnchen
// ═══════════════════════════════════════════════════════════════════════════

/** Lösung C — Multi-protein dinner for Threshold (Post-WO Carbs ~65g). */
const EGG_CHICKEN_RICE_ASIA: RecipeTemplate = {
  id: "egg_chicken_rice_asia",
  name: "Eier + Hähnchen + Reis + TK Asia-Gemüse",
  components: [
    {
      ingredientId: "eggs",
      role: "protein",
      portionUnit: "stück",
      kcalPerUnit: 78,
      proteinPerUnit: 6,
      carbsPerUnit: 0.6,
      fatPerUnit: 5.3,
      costPerUnit: 0.25,
      minimumAmount: 2,
      maximumAmount: 6,
      stepSize: 1,
    },
    {
      ingredientId: "chicken_breast",
      role: "protein",
      portionUnit: "g",
      kcalPerUnit: 1.1,
      proteinPerUnit: 0.22,
      carbsPerUnit: 0,
      fatPerUnit: 0.01,
      costPerUnit: 0.0092,
      minimumAmount: 125, // v1.3: was 75 — ensure dinner gets meaningful chicken portion
      maximumAmount: 150,
      stepSize: 25,
    },
    {
      ingredientId: "rice_dry",
      role: "carb",
      portionUnit: "g",
      kcalPerUnit: 3.6,
      proteinPerUnit: 0.07,
      carbsPerUnit: 0.78,
      fatPerUnit: 0.01,
      costPerUnit: 0.002,
      minimumAmount: 50,
      maximumAmount: 150,
      stepSize: 10, // 10g for ±30 kcal precision (same as all rice components)
    },
    {
      ingredientId: "tk_asia_gemuse",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.24,
      proteinPerUnit: 0.012,
      carbsPerUnit: 0.03,
      fatPerUnit: 0.004,
      costPerUnit: 0.0024,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

/** Rest-Day dinner — Hähnchen statt Hack for 2x protein efficiency. */
const CHICKEN_RICE_BROKKOLI: RecipeTemplate = {
  id: "chicken_rice_brokkoli",
  name: "Hähnchen + Reis + TK Brokkoli",
  components: [
    {
      ingredientId: "chicken_breast",
      role: "protein",
      portionUnit: "g",
      kcalPerUnit: 1.1,
      proteinPerUnit: 0.22,
      carbsPerUnit: 0,
      fatPerUnit: 0.01,
      costPerUnit: 0.0092,
      minimumAmount: 100,
      maximumAmount: 275, // 2026-05-16: was 400 — cap at 60.5g chicken-protein (needed for rest day functional min; long_run gets capped by engine to ~50g via raised rice ceiling)
      stepSize: 25,
    },
    {
      ingredientId: "rice_dry",
      role: "carb",
      portionUnit: "g",
      kcalPerUnit: 3.6,
      proteinPerUnit: 0.07,
      carbsPerUnit: 0.78,
      fatPerUnit: 0.01,
      costPerUnit: 0.002,
      minimumAmount: 50,
      maximumAmount: 180, // 2026-05-16: was 100 — bigger carb sink so engine can absorb freed kcal when chicken caps
      stepSize: 10, // 10g for ±30 kcal precision
    },
    {
      ingredientId: "tk_brokkoli",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.34,
      proteinPerUnit: 0.028,
      carbsPerUnit: 0.04,
      fatPerUnit: 0.004,
      costPerUnit: 0.0022,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

/** Long-Run dinner — Eier + Reis for Post-WO Carbs ~69g. */
const EGG_RICE_BROKKOLI: RecipeTemplate = {
  id: "egg_rice_brokkoli",
  name: "Eier + Reis + TK Brokkoli",
  components: [
    {
      ingredientId: "eggs",
      role: "protein",
      portionUnit: "stück",
      kcalPerUnit: 78,
      proteinPerUnit: 6,
      carbsPerUnit: 0.6,
      fatPerUnit: 5.3,
      costPerUnit: 0.25,
      minimumAmount: 3,
      maximumAmount: 8,
      stepSize: 1,
    },
    {
      ingredientId: "rice_dry",
      role: "carb",
      portionUnit: "g",
      kcalPerUnit: 3.6,
      proteinPerUnit: 0.07,
      carbsPerUnit: 0.78,
      fatPerUnit: 0.01,
      costPerUnit: 0.002,
      minimumAmount: 50,
      maximumAmount: 200,
      stepSize: 10, // 10g for ±30 kcal precision
    },
    {
      ingredientId: "tk_brokkoli",
      role: "vegetable",
      portionUnit: "g",
      kcalPerUnit: 0.34,
      proteinPerUnit: 0.028,
      carbsPerUnit: 0.04,
      fatPerUnit: 0.004,
      costPerUnit: 0.0022,
      minimumAmount: 150,
      maximumAmount: 300,
      stepSize: 50,
    },
  ],
  sauces: [{ name: "Sojasauce", kcal: 8, protein: 0, carbs: 1, fat: 0, cost: 0.08 }],
};

// ═══════════════════════════════════════════════════════════════════════════
// Public exports
// ═══════════════════════════════════════════════════════════════════════════

export const RECIPE_TEMPLATES: RecipeTemplate[] = [
  CHICKEN_RICE_ASIA,
  HACK_RICE_BROKKOLI,
  EGG_RICE_ASIA,
  EGG_ASIA_NORICE,
  EGG_BROKKOLI_NORICE,
  HACK_BROKKOLI_NORICE,
  EGG_CHICKEN_RICE_ASIA,
  CHICKEN_RICE_BROKKOLI,
  EGG_RICE_BROKKOLI,
];

/** All valid recipe template IDs. */
export type RecipeTemplateId =
  | "chicken_rice_asia"
  | "hack_rice_brokkoli"
  | "egg_rice_asia"
  | "egg_asia_norice"
  | "egg_brokkoli_norice"
  | "hack_brokkoli_norice"
  | "egg_chicken_rice_asia"
  | "chicken_rice_brokkoli"
  | "egg_rice_brokkoli";

/** Ingredient display labels for human-readable item names. */
export const INGREDIENT_LABELS: Record<string, string> = {
  chicken_breast: "Hähnchenbrust",
  beef_mince: "Rinderhack",
  eggs: "Eier",
  rice_dry: "Reis",
  tk_asia_gemuse: "TK Asia-Gemüse",
  tk_brokkoli: "TK Brokkoli",
};

/** Lookup a recipe template by ID. Throws if not found. */
export function findRecipeTemplate(id: string): RecipeTemplate {
  const template = RECIPE_TEMPLATES.find((t) => t.id === id);
  if (!template) {
    throw new Error(`RecipeTemplate not found: "${id}"`);
  }
  return template;
}
