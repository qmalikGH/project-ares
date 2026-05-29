// Nutrition cascade — Nutrition v2 with DB persistence.
//
// Single entry point for recomputing all meal plans after any config change.
// Reads DayTypeConfigs from DB, delegates to buildAllDayPlans() (pure engine),
// then persists ComputedMealSlots via transactional DB writes.
//
// Trigger scenarios:
//   - config_change:  Coach adjusts calorie targets or recipe assignments
//   - recipe_change:  Recipe template data is updated
//   - calibration:    14-day TDEE calibration completes
//   - manual:         Admin operation
//   - seed:           Initial setup or integrity repair
//
// All-or-nothing: if ANY dayType fails validation, NOTHING is written.

import { db } from "@/lib/db/client";
import { buildAllDayPlans } from "./build-all-day-plans";
import { ATHLETE_WEIGHT_KG } from "./day-type-configs";
import { RECIPE_TEMPLATES } from "./recipe-templates";
import { dbConfigToEngineConfig } from "./seed-day-type-configs";
import { buildSlotsForTargets } from "./template";
import { DEFICIT_KCAL } from "./constants";
import type { DayTypeTargets } from "./day-type";
import type { ComputedDayPlan, DayType, FixedSlotItem } from "./types";

export type CascadeTrigger = "config_change" | "recipe_change" | "calibration" | "manual" | "seed" | "weight_change";

export interface CascadeResult {
  success: boolean;
  errors: string[];
  trigger: CascadeTrigger;
  reason: string;
}

interface SlotRow {
  planId: string;
  dayType: string;
  slotName: string;
  recipeId: string | null;
  recipeName: string | null;
  items: object;
  totalKcal: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalCost: number;
}

/**
 * Recompute all day plans from DB configs and persist ComputedMealSlots.
 *
 * 1. Load DayTypeConfigs from DB (source of truth after seed)
 * 2. Pre-validate constraints (ratios, recipe existence, calorie range)
 * 3. Compute via buildAllDayPlans() (pure engine, unchanged)
 * 4. If valid: delete old slots + write new slots + log — in a single transaction
 * 5. If invalid: return errors, DB untouched
 */
export async function cascadeNutritionUpdate(
  planId: string,
  trigger: CascadeTrigger,
  reason: string,
): Promise<CascadeResult> {
  // ── Load configs from DB ──
  const dbConfigs = await db.dayTypeConfig.findMany({ where: { planId } });
  if (dbConfigs.length === 0) {
    return { success: false, errors: ["No DayTypeConfigs found for plan"], trigger, reason };
  }

  const configs = dbConfigs.map(dbConfigToEngineConfig);

  // ── Pre-validate constraints ──
  const preErrors: string[] = [];
  for (const config of configs) {
    const ratioSum = config.variableSlots.mainMeal.budgetRatio + config.variableSlots.dinner.budgetRatio;
    if (Math.abs(ratioSum - 1.0) > 0.001) {
      preErrors.push(`${config.dayType}: ratios sum to ${ratioSum}, must be 1.0`);
    }
    if (config.variableSlots.mainMeal.recipeId === config.variableSlots.dinner.recipeId) {
      preErrors.push(`${config.dayType}: mainMeal and dinner use same recipe "${config.variableSlots.mainMeal.recipeId}"`);
    }
    if (!RECIPE_TEMPLATES.some((r) => r.id === config.variableSlots.mainMeal.recipeId)) {
      preErrors.push(`${config.dayType}: mainMeal recipe "${config.variableSlots.mainMeal.recipeId}" not found`);
    }
    if (!RECIPE_TEMPLATES.some((r) => r.id === config.variableSlots.dinner.recipeId)) {
      preErrors.push(`${config.dayType}: dinner recipe "${config.variableSlots.dinner.recipeId}" not found`);
    }
    if (config.calorieTarget < 1500 || config.calorieTarget > 5000) {
      preErrors.push(`${config.dayType}: calorie target ${config.calorieTarget} out of sane range [1500, 5000]`);
    }
  }
  if (preErrors.length > 0) {
    return { success: false, errors: preErrors, trigger, reason };
  }

  // ── Load athlete weight ──
  const plan = await db.mealPlan.findUnique({
    where: { id: planId },
    select: { userId: true, deficitKcal: true },
  });
  if (!plan) {
    return { success: false, errors: ["MealPlan not found"], trigger, reason };
  }

  const settings = await db.userSettings.findUnique({
    where: { userId: plan.userId },
    select: { currentWeightKg: true, targetWeightKg: true },
  });
  const weight = settings?.currentWeightKg ?? settings?.targetWeightKg ?? ATHLETE_WEIGHT_KG;

  // ── Compute (pure engine) ──
  const result = buildAllDayPlans(configs, RECIPE_TEMPLATES, weight);

  if (result.hasErrors) {
    return { success: false, errors: result.allErrors, trigger, reason };
  }

  // ── Map ComputedDayPlan → ComputedMealSlot rows ──
  const allNewSlots: SlotRow[] = [];
  for (const [dayType, dayPlan] of result.plans) {
    mapDayPlanToSlotRows(planId, dayType, dayPlan, allNewSlots);
  }

  // ── Sprint v1.8 #6: also sync DayPlan rows so all 4 deficit stores stay
  // consistent (DayTypeConfig, ComputedMealSlot, DayPlan, MealPlan.deficitKcal).
  // DayPlan.slots uses the MealSlots shape (buildSlotsForTargets), derived from
  // the SAME DB configs the ComputedMealSlots come from. Computed outside the
  // transaction (pure); only the writes are transactional.
  const dayPlanOps = dbConfigs.map((cfg) => {
    const tdee = cfg.tdeeEstimate ?? cfg.calorieTarget + (plan.deficitKcal ?? DEFICIT_KCAL);
    const targets: DayTypeTargets = {
      tdeeEstimate: tdee,
      calorieTarget: cfg.calorieTarget,
      proteinG: cfg.proteinG,
      carbsG: cfg.carbsG,
      fatG: cfg.fatG,
    };
    const slots = buildSlotsForTargets(cfg.dayType as DayType, targets);
    return db.dayPlan.updateMany({
      where: { mealPlanId: planId, dayType: cfg.dayType },
      data: {
        tdeeEstimate: tdee,
        calorieTarget: cfg.calorieTarget,
        proteinG: cfg.proteinG,
        carbsG: cfg.carbsG,
        fatG: cfg.fatG,
        slots: slots as unknown as object,
      },
    });
  });

  // ── Transactional write ──
  await db.$transaction([
    db.computedMealSlot.deleteMany({ where: { planId } }),
    db.computedMealSlot.createMany({ data: allNewSlots }),
    ...dayPlanOps,
    db.coachingLog.create({
      data: {
        userId: plan.userId,
        action: `cascade:${trigger}`,
        data: {
          planId,
          trigger,
          dayTypes: [...result.plans.keys()],
          totalSlots: allNewSlots.length,
        } as object,
        reason,
      },
    }),
  ]);

  return { success: true, errors: [], trigger, reason };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function sumItems(items: FixedSlotItem[]) {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, cost = 0;
  for (const item of items) {
    kcal += item.kcal;
    protein += item.protein;
    carbs += item.carbs;
    fat += item.fat;
    cost += item.cost;
  }
  return { kcal, protein, carbs, fat, cost };
}

function mapDayPlanToSlotRows(
  planId: string,
  dayType: string,
  plan: ComputedDayPlan,
  out: SlotRow[],
): void {
  // Fixed slots
  for (const [slotName, slotData] of Object.entries(plan.fixedSlots)) {
    const totals = sumItems(slotData.items);
    out.push({
      planId,
      dayType,
      slotName,
      recipeId: null,
      recipeName: null,
      items: slotData.items as object,
      totalKcal: totals.kcal,
      totalProtein: totals.protein,
      totalCarbs: totals.carbs,
      totalFat: totals.fat,
      totalCost: totals.cost,
    });
  }

  // Flex dessert
  if (plan.flexDessert?.enabled) {
    const totals = sumItems(plan.flexDessert.items);
    out.push({
      planId,
      dayType,
      slotName: "postMealDessert",
      recipeId: null,
      recipeName: null,
      items: plan.flexDessert.items as object,
      totalKcal: totals.kcal,
      totalProtein: totals.protein,
      totalCarbs: totals.carbs,
      totalFat: totals.fat,
      totalCost: totals.cost,
    });
  }

  // MainMeal (variable — from scaled recipe)
  out.push({
    planId,
    dayType,
    slotName: "mainMeal",
    recipeId: plan.mainMeal.recipeId,
    recipeName: plan.mainMeal.recipeName,
    items: [...plan.mainMeal.components, ...plan.mainMeal.sauces] as object,
    totalKcal: plan.mainMeal.totals.kcal,
    totalProtein: plan.mainMeal.totals.protein,
    totalCarbs: plan.mainMeal.totals.carbs,
    totalFat: plan.mainMeal.totals.fat,
    totalCost: plan.mainMeal.totals.cost,
  });

  // Dinner (variable — from scaled recipe)
  out.push({
    planId,
    dayType,
    slotName: "dinner",
    recipeId: plan.dinner.recipeId,
    recipeName: plan.dinner.recipeName,
    items: [...plan.dinner.components, ...plan.dinner.sauces] as object,
    totalKcal: plan.dinner.totals.kcal,
    totalProtein: plan.dinner.totals.protein,
    totalCarbs: plan.dinner.totals.carbs,
    totalFat: plan.dinner.totals.fat,
    totalCost: plan.dinner.totals.cost,
  });
}
