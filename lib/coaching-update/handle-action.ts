// Action router for POST /api/coaching-update.
// Each action: validates input, applies DB change, writes CoachingLog entry.
// Sprint v0.16 Phase A1.4

import { z } from "zod";
import { db } from "@/lib/db/client";
import { dayKey } from "@/lib/db/queries/sensors";
import { buildAllDayPlans } from "@/lib/nutrition/build-all-day-plans";
import { calibrateMealPlan } from "@/lib/nutrition/calibration";
import { cascadeNutritionUpdate } from "@/lib/nutrition/cascade";
import { ATHLETE_WEIGHT_KG } from "@/lib/nutrition/day-type-configs";
import { DEFICIT_KCAL } from "@/lib/nutrition/constants";
import type { DayTypeTargets } from "@/lib/nutrition/day-type";
import { RECIPE_TEMPLATES } from "@/lib/nutrition/recipe-templates";
import { dbConfigToEngineConfig, seedDayTypeConfigs, forceReseedDayTypeConfigs } from "@/lib/nutrition/seed-day-type-configs";
import { buildSlotsForTargets, templateDayPlan } from "@/lib/nutrition/template";
import type { DayType, DayTypeConfig } from "@/lib/nutrition/types";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";

const TherapyPhaseSchema = z.object({
  phase: z.enum(["REACTIVE", "DISREPAIR", "REMODELING", "SPORT_SPECIFIC"]),
});

const ActiveInjuriesSchema = z.object({
  injuries: z.array(z.string().min(1).max(100)).max(20),
});

const PreventionExercisesSchema = z.object({
  exercises: z.array(z.string().min(1).max(200)).max(50),
});

// ── Nutrition action schemas (Phase B9) ───────────────────────────────────

const DayTypeEnum = z.enum(["strength_run", "threshold", "long_run", "rest"]);
const SlotKeyEnum = z.enum([
  "morning",
  "preTraining",
  "mainMeal",
  "postMealDessert",
  "afternoonSnack",
  "dinner",
  "eveningSnack",
]);

const MealItemSchema = z.object({
  name: z.string().min(1).max(120),
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(0).max(500),
  carbs: z.number().min(0).max(500),
  fat: z.number().min(0).max(500),
  costEur: z.number().min(0).max(100),
});

// updateMealPlan: replace items in a single slot of a DayPlan.
const UpdateMealPlanSchema = z.object({
  dayType: DayTypeEnum,
  slot: SlotKeyEnum,
  items: z.array(MealItemSchema).max(20),
});

const UpdateCalorieTargetsSchema = z.object({
  dayType: DayTypeEnum,
  calorieTarget: z.number().int().min(800).max(6000),
  proteinG: z.number().int().min(0).max(500),
  carbsG: z.number().int().min(0).max(800),
  fatG: z.number().int().min(0).max(300),
});

const TriggerCalibrationSchema = z.object({}).strict();

const AdjustDaySlotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: SlotKeyEnum,
  action: z.enum(["remove", "reduce", "add"]),
  item: MealItemSchema.optional(),
});

const SeedMealPlanSchema = z.object({}).strict();

// ── v1.1 action schemas ─────────────────────────────────────────────────

const SwapRecipeSchema = z.object({
  dayType: DayTypeEnum,
  slot: z.enum(["mainMeal", "dinner"]),
  newRecipeId: z.string().min(1).max(50),
});

const AdjustBudgetRatioSchema = z.object({
  dayType: DayTypeEnum,
  mainMealRatio: z.number().min(0.3).max(0.7),
});

const ToggleFlexDessertSchema = z.object({
  dayType: DayTypeEnum,
  enabled: z.boolean(),
});

// v1.2 — Global deficit adjustment
const AdjustDeficitSchema = z.object({
  deficit: z.number().int().min(0).max(1500),
});

const ForceReseedSchema = z.object({}).strict();

// Sprint v1.5 — Block Reset: regenerate W1-W4 of a Block.
// loadPreset W1 = full ramp-up (no override). W2 = W1 volume + W2 loads.
//
// targetBlockNumber re-runs a specific Block instead of the one containing
// today. Needed after a long layoff, where the calendar has advanced past the
// Block the athlete actually wants to resume from.
// dryRun computes the full change set without writing anything (no DB
// mutation, no CoachingLog entry).
const ResetBlockSchema = z.object({
  loadPreset: z.enum(["W1", "W2"]).default("W2"),
  targetBlockNumber: z.number().int().min(1).max(5).optional(),
  dryRun: z.boolean().default(false),
}).strict();

const SEED_DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];

export type ActionResult =
  | { success: true; logId: string; action: string; details?: unknown }
  | { success: false; status: number; error: string; details?: unknown };


/**
 * Apply one coaching action atomically: DB change + CoachingLog entry.
 * Validates `reason` (required, non-trivial) and `data` (per-action schema).
 */
export async function handleCoachingAction(
  userId: string,
  action: string,
  data: unknown,
  reason: string,
): Promise<ActionResult> {
  if (typeof reason !== "string" || reason.trim().length < 3) {
    return { success: false, status: 400, error: "reason_required" };
  }

  switch (action) {
    case "updateTherapyPhase": {
      const parsed = TherapyPhaseSchema.safeParse(data);
      if (!parsed.success) {
        return {
          success: false,
          status: 400,
          error: "invalid_data",
          details: parsed.error.flatten(),
        };
      }
      await db.userSettings.upsert({
        where: { userId },
        update: { therapyPhaseOverride: parsed.data.phase },
        create: { userId, therapyPhaseOverride: parsed.data.phase },
      });
      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "updateActiveInjuries": {
      const parsed = ActiveInjuriesSchema.safeParse(data);
      if (!parsed.success) {
        return {
          success: false,
          status: 400,
          error: "invalid_data",
          details: parsed.error.flatten(),
        };
      }
      await db.userSettings.upsert({
        where: { userId },
        update: { activeInjuries: parsed.data.injuries },
        create: { userId, activeInjuries: parsed.data.injuries },
      });
      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "updatePreventionExercises": {
      const parsed = PreventionExercisesSchema.safeParse(data);
      if (!parsed.success) {
        return {
          success: false,
          status: 400,
          error: "invalid_data",
          details: parsed.error.flatten(),
        };
      }
      await db.userSettings.upsert({
        where: { userId },
        update: { preventionExercises: parsed.data.exercises },
        create: { userId, preventionExercises: parsed.data.exercises },
      });
      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "updateMealPlan": {
      const parsed = UpdateMealPlanSchema.safeParse(data);
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dayPlan: any = await db.dayPlan.findUnique({
        where: { mealPlanId_dayType: { mealPlanId: plan.id, dayType: parsed.data.dayType } },
      });
      if (!dayPlan) return { success: false, status: 404, error: "day_plan_not_found" };

      // Patch the single slot, leave others intact.
      const slots = (dayPlan.slots ?? {}) as Record<string, unknown>;
      slots[parsed.data.slot] = { items: parsed.data.items };
      await db.dayPlan.update({
        where: { id: dayPlan.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { slots: slots as any },
      });

      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "updateCalorieTargets": {
      const parsed = UpdateCalorieTargetsSchema.safeParse(data);
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true, deficitKcal: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      // Dry-run: load all configs, apply change, validate
      const dryRunResult = await dryRunConfigChange(plan.id, userId, (configs) => {
        const idx = configs.findIndex((c) => c.dayType === parsed.data.dayType);
        if (idx === -1) return `DayTypeConfig not found for ${parsed.data.dayType}`;
        configs[idx] = {
          ...configs[idx],
          calorieTarget: parsed.data.calorieTarget,
          macroTargets: {
            proteinG: parsed.data.proteinG,
            carbsG: parsed.data.carbsG,
            fatG: parsed.data.fatG,
          },
        };
        return null;
      });
      if (!dryRunResult.ok) {
        return { success: false, status: 422, error: "dry_run_failed", details: dryRunResult.errors };
      }

      // Apply: update DayTypeConfig in DB
      await db.dayTypeConfig.update({
        where: { planId_dayType: { planId: plan.id, dayType: parsed.data.dayType } },
        data: {
          calorieTarget: parsed.data.calorieTarget,
          proteinG: parsed.data.proteinG,
          carbsG: parsed.data.carbsG,
          fatG: parsed.data.fatG,
        },
      });

      // Backward-compat: also update DayPlan targets
      const tdeeEstimate = parsed.data.calorieTarget + (plan.deficitKcal ?? 500);
      const targets: DayTypeTargets = {
        tdeeEstimate,
        calorieTarget: parsed.data.calorieTarget,
        proteinG: parsed.data.proteinG,
        carbsG: parsed.data.carbsG,
        fatG: parsed.data.fatG,
      };
      const slots = buildSlotsForTargets(parsed.data.dayType as DayType, targets);
      const dayPlans = await db.dayPlan.findMany({
        where: { mealPlanId: plan.id, dayType: parsed.data.dayType },
        select: { id: true },
      });
      for (const dp of dayPlans) {
        await db.dayPlan.update({
          where: { id: dp.id },
          data: {
            tdeeEstimate,
            calorieTarget: parsed.data.calorieTarget,
            proteinG: parsed.data.proteinG,
            carbsG: parsed.data.carbsG,
            fatG: parsed.data.fatG,
            slots: slots as unknown as object,
          },
        });
      }

      // Cascade: recompute all ComputedMealSlots
      await cascadeNutritionUpdate(plan.id, "config_change", reason);

      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "triggerCalibration": {
      const parsed = TriggerCalibrationSchema.safeParse(data ?? {});
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }
      const result = await calibrateMealPlan(userId);
      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: result as any, reason },
      });
      if (result.status === "insufficient_data") {
        // We still log the attempt, but signal back so the coach knows.
        return {
          success: false,
          status: 422,
          error: "insufficient_data",
          details: { message: result.message, daysAvailable: result.daysAvailable },
        };
      }
      return { success: true, logId: log.id, action };
    }

    case "adjustDaySlot": {
      const parsed = AdjustDaySlotSchema.safeParse(data);
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }
      const date = dayKey(new Date(`${parsed.data.date}T00:00:00.000Z`));
      // Upsert a DailyNutritionLog row with a free-form adjustment payload.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing: any = await db.dailyNutritionLog.findUnique({
        where: { userId_date: { userId, date } },
      });
      const adjustment = {
        slot: parsed.data.slot,
        action: parsed.data.action,
        item: parsed.data.item ?? null,
        source: "coach_manual",
        reason,
      };
      if (existing) {
        await db.dailyNutritionLog.update({
          where: { id: existing.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { adjustment: adjustment as any },
        });
      } else {
        // No log row yet — create with placeholder calorieTarget; cron will
        // overwrite once it computes today's adjustment.
        await db.dailyNutritionLog.create({
          data: {
            userId,
            date,
            dayType: "rest",
            calorieTarget: 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            adjustment: adjustment as any,
          },
        });
      }
      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "seedMealPlan": {
      const parsed = SeedMealPlanSchema.safeParse(data ?? {});
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true, name: true },
      });
      if (existing) {
        return {
          success: false,
          status: 409,
          error: "MealPlan already exists",
          details: { id: existing.id, name: existing.name },
        };
      }

      // Same logic as scripts/v0_16_seed_meal_plan.ts. Create the canonical
      // Block 1 plan + 4 DayPlans from the templates.
      const plan = await db.mealPlan.create({
        data: {
          userId,
          name: "Block 1 Standard",
          status: "active",
          budgetPerDay: 15.0,
          proteinTarget: 190,
          deficitKcal: 500,
          calibrationStatus: "pending",
        },
      });

      const dayPlanIds: Array<{ dayType: DayType; id: string; calorieTarget: number }> = [];
      for (const dayType of SEED_DAY_TYPES) {
        const template = templateDayPlan(dayType);
        const dp = await db.dayPlan.create({
          data: {
            mealPlanId: plan.id,
            dayType,
            tdeeEstimate: template.tdeeEstimate,
            calorieTarget: template.calorieTarget,
            proteinG: template.proteinG,
            carbsG: template.carbsG,
            fatG: template.fatG,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            slots: template.slots as any,
          },
        });
        dayPlanIds.push({ dayType, id: dp.id, calorieTarget: template.calorieTarget });
      }

      // Seed DayTypeConfigs from code constants (idempotent)
      await seedDayTypeConfigs(plan.id);

      // Cascade: compute all slots from DB configs and persist
      const cascadeResult = await cascadeNutritionUpdate(plan.id, "seed", reason);

      const log = await db.coachingLog.create({
        data: {
          userId,
          action,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { mealPlanId: plan.id, dayPlans: dayPlanIds, cascadeSuccess: cascadeResult.success } as any,
          reason,
        },
      });
      return { success: true, logId: log.id, action };
    }

    // ── v1.1 actions ────────────────────────────────────────────────────

    case "swapRecipe": {
      const parsed = SwapRecipeSchema.safeParse(data);
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }
      const recipeExists = RECIPE_TEMPLATES.some((r) => r.id === parsed.data.newRecipeId);
      if (!recipeExists) {
        return { success: false, status: 400, error: "recipe_not_found", details: { recipeId: parsed.data.newRecipeId } };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      // Pre-check: mainMeal ≠ dinner after swap
      const existingConfig = await db.dayTypeConfig.findUnique({
        where: { planId_dayType: { planId: plan.id, dayType: parsed.data.dayType } },
      });
      if (!existingConfig) {
        return { success: false, status: 404, error: "config_not_found" };
      }
      const otherRecipeId = parsed.data.slot === "mainMeal"
        ? existingConfig.dinnerRecipeId
        : existingConfig.mainMealRecipeId;
      if (otherRecipeId === parsed.data.newRecipeId) {
        return { success: false, status: 422, error: "same_recipe", details: "Cannot use same recipe for mainMeal and dinner" };
      }

      // Dry-run
      const dryRunResult = await dryRunConfigChange(plan.id, userId, (configs) => {
        const idx = configs.findIndex((c) => c.dayType === parsed.data.dayType);
        if (idx === -1) return `DayTypeConfig not found for ${parsed.data.dayType}`;
        const slot = parsed.data.slot === "mainMeal" ? "mainMeal" : "dinner";
        configs[idx] = {
          ...configs[idx],
          variableSlots: {
            ...configs[idx].variableSlots,
            [slot]: { ...configs[idx].variableSlots[slot], recipeId: parsed.data.newRecipeId },
          },
        };
        return null;
      });
      if (!dryRunResult.ok) {
        return { success: false, status: 422, error: "dry_run_failed", details: dryRunResult.errors };
      }

      // Apply
      const fieldToUpdate = parsed.data.slot === "mainMeal" ? "mainMealRecipeId" : "dinnerRecipeId";
      await db.dayTypeConfig.update({
        where: { planId_dayType: { planId: plan.id, dayType: parsed.data.dayType } },
        data: { [fieldToUpdate]: parsed.data.newRecipeId },
      });
      await cascadeNutritionUpdate(plan.id, "recipe_change", reason);

      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "adjustBudgetRatio": {
      const parsed = AdjustBudgetRatioSchema.safeParse(data);
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }
      const dinnerRatio = +(1.0 - parsed.data.mainMealRatio).toFixed(2);
      if (Math.abs(parsed.data.mainMealRatio + dinnerRatio - 1.0) > 0.001) {
        return { success: false, status: 422, error: "ratio_sum_invalid" };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      // Dry-run
      const dryRunResult = await dryRunConfigChange(plan.id, userId, (configs) => {
        const idx = configs.findIndex((c) => c.dayType === parsed.data.dayType);
        if (idx === -1) return `DayTypeConfig not found for ${parsed.data.dayType}`;
        configs[idx] = {
          ...configs[idx],
          variableSlots: {
            mainMeal: { ...configs[idx].variableSlots.mainMeal, budgetRatio: parsed.data.mainMealRatio },
            dinner: { ...configs[idx].variableSlots.dinner, budgetRatio: dinnerRatio },
          },
        };
        return null;
      });
      if (!dryRunResult.ok) {
        return { success: false, status: 422, error: "dry_run_failed", details: dryRunResult.errors };
      }

      // Apply
      await db.dayTypeConfig.update({
        where: { planId_dayType: { planId: plan.id, dayType: parsed.data.dayType } },
        data: { mainMealRatio: parsed.data.mainMealRatio, dinnerRatio },
      });
      await cascadeNutritionUpdate(plan.id, "config_change", reason);

      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: { ...parsed.data, dinnerRatio } as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "toggleFlexDessert": {
      const parsed = ToggleFlexDessertSchema.safeParse(data);
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      // Dry-run
      const dryRunResult = await dryRunConfigChange(plan.id, userId, (configs) => {
        const idx = configs.findIndex((c) => c.dayType === parsed.data.dayType);
        if (idx === -1) return `DayTypeConfig not found for ${parsed.data.dayType}`;
        const current = configs[idx];
        configs[idx] = {
          ...current,
          fixedSlots: {
            ...current.fixedSlots,
            flexDessert: current.fixedSlots.flexDessert
              ? { ...current.fixedSlots.flexDessert, enabled: parsed.data.enabled }
              : parsed.data.enabled ? { enabled: true, items: [] } : null,
          },
        };
        return null;
      });
      if (!dryRunResult.ok) {
        return { success: false, status: 422, error: "dry_run_failed", details: dryRunResult.errors };
      }

      // Apply
      await db.dayTypeConfig.update({
        where: { planId_dayType: { planId: plan.id, dayType: parsed.data.dayType } },
        data: { flexDessertEnabled: parsed.data.enabled },
      });
      await cascadeNutritionUpdate(plan.id, "config_change", reason);

      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: parsed.data as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    // ── v1.2 actions ────────────────────────────────────────────────────

    case "adjustDeficit": {
      const parsed = AdjustDeficitSchema.safeParse(data);
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true, deficitKcal: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      const newDeficit = parsed.data.deficit;
      const oldDeficit = plan.deficitKcal ?? 500;

      // Load all DayTypeConfigs and recalculate calorieTargets
      const dbConfigs = await db.dayTypeConfig.findMany({ where: { planId: plan.id } });
      if (dbConfigs.length === 0) {
        return { success: false, status: 404, error: "no_day_type_configs" };
      }

      // Dry-run: compute new targets and validate
      const dryRunResult = await dryRunConfigChange(plan.id, userId, (configs) => {
        for (let i = 0; i < configs.length; i++) {
          const tdee = configs[i].tdeeEstimate;
          if (!tdee) {
            return `DayType ${configs[i].dayType} has no tdeeEstimate — run calibration first`;
          }
          configs[i] = {
            ...configs[i],
            calorieTarget: tdee - newDeficit,
          };
        }
        return null;
      });
      if (!dryRunResult.ok) {
        return { success: false, status: 422, error: "dry_run_failed", details: dryRunResult.errors };
      }

      // Apply: update MealPlan deficit + all DayTypeConfig calorie targets
      await db.mealPlan.update({
        where: { id: plan.id },
        data: { deficitKcal: newDeficit },
      });

      for (const config of dbConfigs) {
        const tdee = config.tdeeEstimate;
        if (tdee != null) {
          await db.dayTypeConfig.update({
            where: { id: config.id },
            data: { calorieTarget: tdee - newDeficit },
          });
        }
      }

      // Cascade: recompute all ComputedMealSlots
      await cascadeNutritionUpdate(plan.id, "config_change", reason);

      const log = await db.coachingLog.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { userId, action, data: { oldDeficit, newDeficit } as any, reason },
      });
      return { success: true, logId: log.id, action };
    }

    case "forceReseed": {
      const parsed = ForceReseedSchema.safeParse(data ?? {});
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan: any = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        select: { id: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      // Sprint v1.8 #6: deficitKcal is the source of truth — align to the code
      // constant so reseed always lands all 4 stores at the same deficit.
      await db.mealPlan.update({
        where: { id: plan.id },
        data: { deficitKcal: DEFICIT_KCAL },
      });

      // Overwrite all DayTypeConfig rows with code constants
      const updated = await forceReseedDayTypeConfigs(plan.id);

      // Cascade: unified path recomputes ComputedMealSlot AND DayPlan rows
      // (DayPlan no longer refreshed manually here — cascade owns it).
      const cascadeResult = await cascadeNutritionUpdate(plan.id, "seed", reason);

      const log = await db.coachingLog.create({
        data: {
          userId,
          action,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { planId: plan.id, updatedDayTypes: updated, cascadeSuccess: cascadeResult.success, cascadeErrors: cascadeResult.errors } as any,
          reason,
        },
      });
      return { success: true, logId: log.id, action };
    }

    // ── Sprint v1.5 — Block Reset (post-illness ramp-up) ──────────────────
    case "resetBlock": {
      const parsed = ResetBlockSchema.safeParse(data ?? {});
      if (!parsed.success) {
        return { success: false, status: 400, error: "invalid_data", details: parsed.error.flatten() };
      }
      const result = await resetCurrentBlock(userId, parsed.data.loadPreset, reason, {
        targetBlockNumber: parsed.data.targetBlockNumber,
        dryRun: parsed.data.dryRun,
      });
      if (!result.ok) return { success: false, status: result.status, error: result.error };
      // A dry run must leave no trace — skip the CoachingLog entirely.
      if (parsed.data.dryRun) {
        return { success: true, logId: "dry-run", action, details: result.details };
      }
      const log = await db.coachingLog.create({
        data: {
          userId,
          action,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: result.details as any,
          reason,
        },
      });
      return { success: true, logId: log.id, action };
    }

    default:
      return { success: false, status: 400, error: "unknown_action", details: { action } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dry-run helper — validates config change via pure engine before DB write
// ═══════════════════════════════════════════════════════════════════════════

async function dryRunConfigChange(
  planId: string,
  userId: string,
  mutate: (configs: DayTypeConfig[]) => string | null,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const dbConfigs = await db.dayTypeConfig.findMany({ where: { planId } });
  if (dbConfigs.length === 0) {
    return { ok: false, errors: ["No DayTypeConfigs found — run seedMealPlan first"] };
  }

  const configs = dbConfigs.map(dbConfigToEngineConfig);
  const mutateError = mutate(configs);
  if (mutateError) {
    return { ok: false, errors: [mutateError] };
  }

  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { currentWeightKg: true, targetWeightKg: true },
  });
  const weight = settings?.currentWeightKg ?? settings?.targetWeightKg ?? ATHLETE_WEIGHT_KG;

  const result = buildAllDayPlans(configs, RECIPE_TEMPLATES, weight);
  if (result.hasErrors) {
    return { ok: false, errors: result.allErrors };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Sprint v1.5 — Block-Reset implementation
// ═══════════════════════════════════════════════════════════════════════════

type ResetBlockResult =
  | { ok: true; details: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Reset a Block for a user:
 *  1. Find active Macrocycle.
 *  2. Pick the target Phase — `targetBlockNumber` when given, otherwise the
 *     Phase whose date range contains "today" (= current Block).
 *  3. Delete that Phase's WeeklyPlan rows (see deletion boundary below).
 *  4. Create 4 fresh WeeklyPlan rows (W1–W4) starting next Monday. The first
 *     row receives `loadOverrideWeek=2` when loadPreset is "W2" (ramp-up).
 *  5. Clear the Phase's completion markers, extend it, and slide every
 *     subsequent Phase (+ its WeeklyPlan rows) forward by the same delta.
 *
 * The new rows have `plannedSessions: []` placeholders — call
 * `regenerateFuturePlans()` (or `POST /api/debug/regenerate-from-now`) after
 * resetBlock to fill them with concrete sessions (the regenerate helper
 * reads loadOverrideWeek and threads it into the periodization engine).
 *
 * With `dryRun` the function performs every read and returns the same details
 * payload, but issues no writes.
 */
async function resetCurrentBlock(
  userId: string,
  loadPreset: "W1" | "W2",
  reason: string,
  opts: { targetBlockNumber?: number; dryRun?: boolean } = {},
): Promise<ResetBlockResult> {
  void reason; // reason is logged by the caller via CoachingLog

  const { targetBlockNumber, dryRun = false } = opts;
  const { getNextMonday, addWeeks, userToday } = await import("@/lib/date");

  // 1. Active macrocycle
  const macro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: { phases: { orderBy: { startDate: "asc" } } },
  });
  if (!macro) return { ok: false, status: 404, error: "no_active_macrocycle" };

  // 2. Target Phase. Explicit blockNumber wins; otherwise the Phase containing
  //    today. After a long layoff those differ — the calendar has moved on
  //    while the athlete has not.
  const today = userToday();
  const currentPhase = targetBlockNumber != null
    ? macro.phases.find((p) => p.blockNumber === targetBlockNumber)
    : (macro.phases.find(
        (p) => p.startDate <= today && p.plannedEndDate > today,
      ) ?? macro.phases.find((p) => p.status === "active"));
  if (!currentPhase) {
    return {
      ok: false,
      status: 404,
      error: targetBlockNumber != null ? "target_block_not_found" : "no_current_phase",
    };
  }

  const nextMonday = getNextMonday(today);

  // 3. Deletion boundary.
  //    For the Phase containing today, keep rows before next Monday — the
  //    current week is already under way and partly executed.
  //    For any other Phase (a past Block being re-run) that cut-off would
  //    match nothing and leave the old rows behind, so drop all of them. Only
  //    WeeklyPlan scaffolding is removed; Workout and ExerciseLog rows — the
  //    actual training record — are never touched here.
  const phaseContainsToday =
    currentPhase.startDate <= today && currentPhase.plannedEndDate > today;
  const deleteFrom = phaseContainsToday ? nextMonday : currentPhase.startDate;

  const deleteWhere = {
    phaseId: currentPhase.id,
    startDate: { gte: deleteFrom },
  };
  const deleted = dryRun
    ? { count: await db.weeklyPlan.count({ where: deleteWhere }) }
    : await db.weeklyPlan.deleteMany({ where: deleteWhere });

  // 4. Generate 4 fresh WeeklyPlan rows (W1–W4 of this Block). plannedSessions
  //    starts as [] — the caller is expected to invoke the regenerate cascade
  //    next, which will fill plannedSessions and honor loadOverrideWeek.
  //
  //    weekNumber is the absolute week within the macrocycle, derived from
  //    the Phase startWeek. We keep the existing weekNumber semantics so the
  //    coach-engine periodization still sees W1-W4 within the block.
  const phaseFirstWeek =
    macro.phases.findIndex((p) => p.id === currentPhase.id) * 4 + 1;

  const newRows: {
    phaseId: string;
    weekNumber: number;
    startDate: Date;
    endDate: Date;
    plannedSessions: object;
    loadOverrideWeek: number | null;
  }[] = [];
  for (let w = 0; w < 4; w++) {
    const start = addWeeks(nextMonday, w);
    const end = addWeeks(start, 1);
    newRows.push({
      phaseId: currentPhase.id,
      weekNumber: phaseFirstWeek + w,
      startDate: start,
      endDate: end,
      plannedSessions: [] as unknown as object,
      // Sprint v1.5: first week of the reset gets the load-override when
      // loadPreset === "W2" (athlete keeps prior strength gain).
      loadOverrideWeek: w === 0 && loadPreset === "W2" ? 2 : null,
    });
  }
  if (!dryRun) await db.weeklyPlan.createMany({ data: newRows });

  // 5. Extend the Phase + shift subsequent Phases by the same delta.
  //
  //    Old Phase 1: [April 27 → May 25]. After reset, Phase 1 spans the
  //    surviving past weeks PLUS the new 4-week window starting next Monday:
  //    [April 27 → nextMonday + 4 weeks]. The delta in weeks (vs the old
  //    plannedEndDate) is added to EVERY subsequent Phase's startDate +
  //    plannedEndDate, and to every WeeklyPlan row in those phases — so
  //    Block 2-5 slide forward instead of overlapping with the new Block 1.
  const newPhaseEnd = addWeeks(nextMonday, 4);
  const oldPhaseEnd = currentPhase.plannedEndDate;
  const phaseShiftMs = newPhaseEnd.getTime() - oldPhaseEnd.getTime();
  const weeksAdded = Math.round(phaseShiftMs / (7 * 86400000));

  // Re-running a Block that was already signed off means clearing its
  // completion markers, or block-review/route.ts still treats it as finished
  // and progress.ts keeps reading the stale actualEndDate. The BlockReview row
  // itself is deliberately NOT deleted — it stays as a record of the first
  // pass, just detached from the Phase.
  if (!dryRun) {
    await db.phase.update({
      where: { id: currentPhase.id },
      data: {
        plannedEndDate: newPhaseEnd,
        durationWeeks: currentPhase.durationWeeks + Math.max(0, weeksAdded),
        status: "active",
        actualEndDate: null,
        blockReviewId: null,
      },
    });
  }

  const clearedReviews: number[] = [];
  if (currentPhase.blockReviewId) clearedReviews.push(currentPhase.blockNumber);

  if (weeksAdded > 0) {
    // Find subsequent phases (block > current.blockNumber)
    const subsequentPhases = macro.phases.filter(
      (p) => p.blockNumber > currentPhase.blockNumber,
    );

    for (const p of subsequentPhases) {
      // These now lie in the future again, so any completion marker from the
      // abandoned run is stale and gets cleared with the same reasoning.
      if (p.blockReviewId) clearedReviews.push(p.blockNumber);
      if (dryRun) continue;
      await db.phase.update({
        where: { id: p.id },
        data: {
          startDate: addWeeks(p.startDate, weeksAdded),
          plannedEndDate: addWeeks(p.plannedEndDate, weeksAdded),
          status: "active",
          actualEndDate: null,
          blockReviewId: null,
        },
      });
      // Shift every WeeklyPlan row in that phase
      const rows = await db.weeklyPlan.findMany({
        where: { phaseId: p.id },
        select: { id: true, startDate: true, endDate: true },
      });
      for (const r of rows) {
        await db.weeklyPlan.update({
          where: { id: r.id },
          data: {
            startDate: addWeeks(r.startDate, weeksAdded),
            endDate: addWeeks(r.endDate, weeksAdded),
          },
        });
      }
    }

    if (!dryRun) {
      await db.macrocycle.update({
        where: { id: macro.id },
        data: {
          endDate: addWeeks(macro.endDate, weeksAdded),
          totalWeeks: macro.totalWeeks + weeksAdded,
        },
      });
    }
  }

  // Sprint v1.6: Materialize Workout rows for the new 4-week block so the
  // Garmin-push cron finds them without needing a manual script.
  const newPhaseEndForMaterialize = addWeeks(nextMonday, 4);
  const materialized = dryRun
    ? { created: 0, updated: 0, deleted: 0 }
    : await materializeWorkouts(userId, nextMonday, newPhaseEndForMaterialize);

  return {
    ok: true,
    details: {
      macrocycleId: macro.id,
      phaseId: currentPhase.id,
      blockNumber: currentPhase.blockNumber,
      loadPreset,
      dryRun,
      targeted: targetBlockNumber != null ? "explicit" : "current",
      deletedRows: deleted.count,
      createdRows: newRows.length,
      newStartDate: nextMonday.toISOString().slice(0, 10),
      newPhaseEnd: newPhaseEnd.toISOString().slice(0, 10),
      weeksAdded,
      clearedBlockReviews: clearedReviews,
      materialized,
    },
  };
}
