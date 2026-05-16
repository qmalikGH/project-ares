import { config } from "dotenv";
config({ path: ".env.local" });

import { DAY_TYPE_CONFIGS, ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import { computeDayPlan } from "@/lib/nutrition/compute-day-plan";

const weight = ATHLETE_WEIGHT_KG;
const minProtein = Math.round(weight * 2.0);

console.log(`Athlete: ${weight}kg | Min functional protein: ${minProtein}g\n`);
console.log("DayType         | kcal | Protein | Functional | Carbs | Fat  | Valid");
console.log("----------------|------|---------|------------|-------|------|------");

for (const cfg of DAY_TYPE_CONFIGS) {
  const plan = computeDayPlan(cfg, RECIPE_TEMPLATES, weight);
  const hasCollagen = cfg.fixedSlots.preTraining !== null;
  const nonFunctional = hasCollagen ? 14 : 0;
  const functional = plan.totals.protein - nonFunctional;

  console.log(
    `${cfg.dayType.padEnd(16)}| ${String(plan.totals.kcal).padEnd(5)}| ${String(plan.totals.protein).padStart(4)}g   | ${String(functional).padStart(7)}g    | ${String(plan.totals.carbs).padStart(4)}g | ${String(plan.totals.fat).padStart(4)}g | ${plan.validation.valid ? "OK" : "FAIL"}`,
  );

  // Show macro targets for comparison
  console.log(
    `${"  (target)".padEnd(16)}| ${String(cfg.calorieTarget).padEnd(5)}| ${String(cfg.macroTargets.proteinG).padStart(4)}g   |            | ${String(cfg.macroTargets.carbsG).padStart(4)}g | ${String(cfg.macroTargets.fatG).padStart(4)}g |`,
  );

  // Per-slot protein
  console.log(
    `${"  MainMeal".padEnd(16)}| ${String(plan.mainMeal.totals.kcal).padEnd(5)}| ${String(plan.mainMeal.totals.protein).padStart(4)}g   |            | ${String(plan.mainMeal.totals.carbs).padStart(4)}g |      | ${plan.mainMeal.recipeId}`,
  );
  console.log(
    `${"  Dinner".padEnd(16)}| ${String(plan.dinner.totals.kcal).padEnd(5)}| ${String(plan.dinner.totals.protein).padStart(4)}g   |            | ${String(plan.dinner.totals.carbs).padStart(4)}g |      | ${plan.dinner.recipeId}`,
  );

  if (!plan.validation.valid) {
    console.log("  ERRORS:", plan.validation.errors.join("; "));
  }
  if (plan.validation.warnings.length > 0) {
    console.log("  WARNINGS:", plan.validation.warnings.join("; "));
  }
  console.log();
}
