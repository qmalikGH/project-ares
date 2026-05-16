import { config } from "dotenv";
config({ path: ".env.local" });

import { DAY_TYPE_CONFIGS, ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import { computeDayPlan } from "@/lib/nutrition/compute-day-plan";

const weight = ATHLETE_WEIGHT_KG;
const minProtein = Math.round(weight * 2.0);

console.log(`Athlete: ${weight}kg | Min functional protein: ${minProtein}g`);
console.log(`Note: Kollagen (14g) is excluded from protein totals (no leucine, no MPS).\n`);
console.log("DayType         | kcal | Protein | Carbs | Fat  | Valid");
console.log("----------------|------|---------|-------|------|------");

for (const cfg of DAY_TYPE_CONFIGS) {
  const plan = computeDayPlan(cfg, RECIPE_TEMPLATES, weight);
  // plan.totals.protein already excludes kollagen (since 2026-05-16 fix).

  console.log(
    `${cfg.dayType.padEnd(16)}| ${String(plan.totals.kcal).padEnd(5)}| ${String(plan.totals.protein).padStart(4)}g   | ${String(plan.totals.carbs).padStart(4)}g | ${String(plan.totals.fat).padStart(4)}g | ${plan.validation.valid ? "OK" : "FAIL"}`,
  );

  // Show macro targets for comparison
  console.log(
    `${"  (target)".padEnd(16)}| ${String(cfg.calorieTarget).padEnd(5)}| ${String(cfg.macroTargets.proteinG).padStart(4)}g   | ${String(cfg.macroTargets.carbsG).padStart(4)}g | ${String(cfg.macroTargets.fatG).padStart(4)}g |`,
  );

  // Per-slot protein — split main-protein (Hähnchen/Hack/Eier) vs total
  const mainProteinComp = plan.mainMeal.components.find((c) =>
    ["beef_mince", "chicken_breast", "eggs"].includes(c.ingredientId)
  );
  const dinnerProteinComp = plan.dinner.components.find((c) =>
    ["beef_mince", "chicken_breast", "eggs"].includes(c.ingredientId)
  );
  const mainMP = Math.round(mainProteinComp?.protein ?? 0);
  const dinnerMP = Math.round(dinnerProteinComp?.protein ?? 0);

  console.log(
    `${"  MainMeal".padEnd(16)}| ${String(plan.mainMeal.totals.kcal).padEnd(5)}| ${String(plan.mainMeal.totals.protein).padStart(4)}g   | ${String(plan.mainMeal.totals.carbs).padStart(4)}g | (MPS: ${mainMP}g) | ${plan.mainMeal.recipeId}`,
  );
  console.log(
    `${"  Dinner".padEnd(16)}| ${String(plan.dinner.totals.kcal).padEnd(5)}| ${String(plan.dinner.totals.protein).padStart(4)}g   | ${String(plan.dinner.totals.carbs).padStart(4)}g | (MPS: ${dinnerMP}g) | ${plan.dinner.recipeId}`,
  );

  if (!plan.validation.valid) {
    console.log("  ERRORS:", plan.validation.errors.join("; "));
  }
  if (plan.validation.warnings.length > 0) {
    console.log("  WARNINGS:", plan.validation.warnings.join("; "));
  }
  console.log();
}
