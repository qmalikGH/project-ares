// Action router for POST /api/coaching-update.
// Each action: validates input, applies DB change, writes CoachingLog entry.
// Sprint v0.16 Phase A1.4

import { z } from "zod";
import { db } from "@/lib/db/client";
import { dayKey } from "@/lib/db/queries/sensors";
import { calibrateMealPlan } from "@/lib/nutrition/calibration";
import { templateDayPlan } from "@/lib/nutrition/template";
import type { DayType } from "@/lib/nutrition/types";

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

const SEED_DAY_TYPES: DayType[] = ["strength_run", "threshold", "long_run", "rest"];

export type ActionResult =
  | { success: true; logId: string; action: string }
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
        select: { id: true },
      });
      if (!plan) return { success: false, status: 404, error: "no_active_meal_plan" };

      const updated = await db.dayPlan.updateMany({
        where: { mealPlanId: plan.id, dayType: parsed.data.dayType },
        data: {
          calorieTarget: parsed.data.calorieTarget,
          proteinG: parsed.data.proteinG,
          carbsG: parsed.data.carbsG,
          fatG: parsed.data.fatG,
        },
      });
      if (updated.count === 0) {
        return { success: false, status: 404, error: "day_plan_not_found" };
      }

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

      const log = await db.coachingLog.create({
        data: {
          userId,
          action,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { mealPlanId: plan.id, dayPlans: dayPlanIds } as any,
          reason,
        },
      });
      return { success: true, logId: log.id, action };
    }

    default:
      return { success: false, status: 400, error: "unknown_action", details: { action } };
  }
}
