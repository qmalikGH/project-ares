// Seed DayTypeConfigs from code constants into DB.
// After initial seed, the DB is the source of truth — code constants are
// only read for missing DayTypes during integrity repair.

import { db } from "@/lib/db/client";
import { DAY_TYPE_CONFIGS } from "./day-type-configs";
import type { DayTypeConfig, FlexSlotDef } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Prisma row shape (flat) ↔ Engine interface (nested)
// ═══════════════════════════════════════════════════════════════════════════

interface PrismaDayTypeConfigRow {
  planId: string;
  dayType: string;
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fixedSlots: unknown; // Json column
  mainMealRecipeId: string;
  mainMealRatio: number;
  dinnerRecipeId: string;
  dinnerRatio: number;
  flexDessertEnabled: boolean;
}

/** Convert a flat Prisma DayTypeConfig row → nested engine DayTypeConfig. */
export function dbConfigToEngineConfig(row: PrismaDayTypeConfigRow): DayTypeConfig {
  const fs = row.fixedSlots as DayTypeConfig["fixedSlots"];
  return {
    dayType: row.dayType,
    calorieTarget: row.calorieTarget,
    macroTargets: {
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
    },
    fixedSlots: {
      morning: fs.morning,
      preTraining: fs.preTraining,
      afternoonSnack: fs.afternoonSnack,
      eveningSnack: fs.eveningSnack,
      flexDessert: row.flexDessertEnabled
        ? (fs.flexDessert ?? { enabled: true, items: [] })
        : ({ enabled: false, items: fs.flexDessert?.items ?? [] } as FlexSlotDef),
    },
    variableSlots: {
      mainMeal: { recipeId: row.mainMealRecipeId, budgetRatio: row.mainMealRatio },
      dinner: { recipeId: row.dinnerRecipeId, budgetRatio: row.dinnerRatio },
    },
  };
}

/** Convert a nested engine DayTypeConfig → flat Prisma create data. */
function engineConfigToDbData(planId: string, config: DayTypeConfig) {
  return {
    planId,
    dayType: config.dayType,
    calorieTarget: config.calorieTarget,
    proteinG: config.macroTargets.proteinG,
    carbsG: config.macroTargets.carbsG,
    fatG: config.macroTargets.fatG,
    fixedSlots: config.fixedSlots as object,
    mainMealRecipeId: config.variableSlots.mainMeal.recipeId,
    mainMealRatio: config.variableSlots.mainMeal.budgetRatio,
    dinnerRecipeId: config.variableSlots.dinner.recipeId,
    dinnerRatio: config.variableSlots.dinner.budgetRatio,
    flexDessertEnabled: config.fixedSlots.flexDessert?.enabled ?? true,
  };
}

/**
 * Seed DayTypeConfigs from code constants into DB for a given plan.
 * Idempotent: existing rows are never overwritten (DB is source of truth).
 */
export async function seedDayTypeConfigs(planId: string): Promise<void> {
  for (const config of DAY_TYPE_CONFIGS) {
    await db.dayTypeConfig.upsert({
      where: { planId_dayType: { planId, dayType: config.dayType } },
      create: engineConfigToDbData(planId, config),
      update: {}, // intentionally empty — don't overwrite existing
    });
  }
}

/**
 * Seed only missing DayTypeConfigs (for integrity repair).
 * Existing rows are preserved.
 */
export async function seedMissingDayTypeConfigs(
  planId: string,
  existingDayTypes: string[],
): Promise<void> {
  const missing = DAY_TYPE_CONFIGS.filter(
    (c) => !existingDayTypes.includes(c.dayType),
  );
  for (const config of missing) {
    await db.dayTypeConfig.create({
      data: engineConfigToDbData(planId, config),
    });
  }
}
