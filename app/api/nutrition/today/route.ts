// GET /api/nutrition/today
// Returns today's nutrition plan for the current user. Falls back to the
// canonical template when no active MealPlan exists yet (pre-seed).

import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import { dayKey } from "@/lib/db/queries/sensors";
import { getDayType, INITIAL_TARGETS } from "@/lib/nutrition/day-type";
import type { DayTypeTargets } from "@/lib/nutrition/day-type";
import {
  templateDayPlan,
  buildSlotsForWeekday,
  buildWeekdaySlotsMap,
  sumSlotMacros,
  SLOT_LABELS,
} from "@/lib/nutrition/template";
import {
  generateShoppingTrip1,
  generateShoppingTrip2,
  nextTripForDate,
} from "@/lib/nutrition/shopping-list";
import type { WeekdaySlotsMap } from "@/lib/nutrition/shopping-list";
import {
  WEEKLY_RECIPE_BY_WEEKDAY,
  COOK_DAYS_WEEKDAY,
  RECIPES,
} from "@/lib/nutrition/recipes";
import { findDayTypeConfig } from "@/lib/nutrition/day-type-configs";
import { ensureNutritionIntegrity } from "@/lib/nutrition/ensure-integrity";
import { findRecipeTemplate } from "@/lib/nutrition/recipe-templates";
import type { DayType, MealSlots, DailyAdjustment } from "@/lib/nutrition/types";

export const dynamic = "force-dynamic";

interface NutritionTodayResponse {
  date: string;
  dayOfWeek: string;
  dayType: DayType;
  source: "active_plan" | "template_fallback";
  plan: {
    name: string;
    calibrationStatus: string;
    calibratedAt: string | null;
    budgetPerDay: number;
  } | null;
  dayPlan: {
    dayType: DayType;
    tdeeEstimate: number;
    calorieTarget: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    slots: MealSlots;
  };
  totals: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    costEur: number;
  };
  adjustment: DailyAdjustment | null;
  shopping: {
    next: ReturnType<typeof generateShoppingTrip1>;
  };
  weekOverview: {
    date: string;
    dayOfWeek: string;
    dayType: DayType;
    recipeKey: string;
    recipeName: string;
    /** v2: mainMeal recipe name (different from dinner). */
    mainMealRecipeName: string;
    /** v2: dinner recipe name (different from mainMeal). */
    dinnerRecipeName: string;
    isCookDay: boolean;
  }[];
  /** Weekday-keyed slots (0=Sun..6=Sat). Each weekday has the correct
   *  recipe from the weekly rotation (chicken/hack/egg). */
  weekdaySlots: Record<number, MealSlots>;
  slotLabels: Record<string, string>;
}

const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export async function GET() {
  // Resilient against missing DB (preview deploys, ephemeral builds, DB
  // outages): every DB call is wrapped, and a template-based response is
  // returned when any of them fail. This keeps the UI reviewable even
  // when the connection string is a placeholder.
  const today = await userTodayDynamic();
  const dayType = getDayType(today);
  const todayWeekday = today.getUTCDay();

  let userId: string | null = null;
  try {
    userId = await getCurrentUserId();
  } catch {
    userId = null;
  }

  const todayKey = dayKey(today);

  // 1. Active plan + all DayPlans
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activePlan: any = null;
  try {
    if (userId) {
      activePlan = await db.mealPlan.findFirst({
        where: { userId, status: "active" },
        include: { dayPlans: true },
      });
    }
  } catch {
    activePlan = null;
  }

  // 1b. Integrity check — auto-repair missing DayTypeConfigs / ComputedMealSlots
  try {
    if (activePlan) {
      await ensureNutritionIntegrity(activePlan.id);
    }
  } catch {
    // Integrity check failure is non-fatal — proceed with what we have
  }

  // 2. Today's nutrition log (for any persisted adjustment)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let log: any = null;
  try {
    if (userId) {
      log = await db.dailyNutritionLog.findUnique({
        where: { userId_date: { userId, date: todayKey } },
      });
    }
  } catch {
    log = null;
  }

  let source: "active_plan" | "template_fallback" = "template_fallback";
  let dayPlanData: NutritionTodayResponse["dayPlan"];
  let planSummary: NutritionTodayResponse["plan"] = null;

  // Build per-dayType targets map from DayPlans, then compute weekday-keyed
  // slots (each weekday gets the correct recipe from the rotation).
  let weekdaySlots: Record<number, MealSlots>;

  // v1.1: Load DB-backed configs and computed slots
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dbDayTypeConfigs: any[] = [];
  try {
    if (activePlan) {
      dbDayTypeConfigs = await db.dayTypeConfig.findMany({
        where: { planId: activePlan.id },
      });
    }
  } catch {
    dbDayTypeConfigs = [];
  }

  if (activePlan && activePlan.dayPlans?.length) {
    // Extract targets per dayType from stored DayPlans
    const targetsByDayType: Partial<Record<DayType, DayTypeTargets>> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const dp of activePlan.dayPlans as any[]) {
      targetsByDayType[dp.dayType as DayType] = {
        tdeeEstimate: dp.tdeeEstimate,
        calorieTarget: dp.calorieTarget,
        proteinG: dp.proteinG,
        carbsG: dp.carbsG,
        fatG: dp.fatG,
      };
    }

    // Build weekday-keyed slots with correct recipe rotation
    weekdaySlots = buildWeekdaySlotsMap(targetsByDayType);

    // Today's plan data — use weekday-computed slots (correct recipe)
    const todayTargets = targetsByDayType[dayType];
    if (todayTargets) {
      source = "active_plan";
      dayPlanData = {
        dayType,
        ...todayTargets,
        slots: weekdaySlots[todayWeekday],
      };
    } else {
      dayPlanData = templateDayPlan(dayType);
    }

    planSummary = {
      name: activePlan.name,
      calibrationStatus: activePlan.calibrationStatus,
      calibratedAt: activePlan.calibratedAt?.toISOString() ?? null,
      budgetPerDay: activePlan.budgetPerDay,
    };
  } else {
    // Fallback to canonical template — works even before seed has run
    // and on preview deploys without DB access.
    dayPlanData = templateDayPlan(dayType);
    weekdaySlots = buildWeekdaySlotsMap(INITIAL_TARGETS);
    // Override today's slots with weekday-correct recipe
    dayPlanData = { ...dayPlanData, slots: weekdaySlots[todayWeekday] };
  }

  const totals = sumSlotMacros(dayPlanData.slots);

  // 3. Shopping (next trip for today, derived from weekday-keyed slots)
  const weekdaySlotsMap: WeekdaySlotsMap = weekdaySlots;
  const next = nextTripForDate(today, weekdaySlotsMap);

  // 4. 7-day overview from today
  // Build a DB config lookup for recipe names (prefer DB over code constants)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbConfigByDayType: Record<string, any> = {};
  for (const c of dbDayTypeConfigs) {
    dbConfigByDayType[c.dayType] = c;
  }

  const weekOverview: NutritionTodayResponse["weekOverview"] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const w = d.getUTCDay();
    const recipeKey = WEEKLY_RECIPE_BY_WEEKDAY[w];
    const dt = getDayType(d);

    // Prefer DB config for recipe names, fall back to code constants
    let mainMealName: string;
    let dinnerName: string;
    const dbCfg = dbConfigByDayType[dt];
    if (dbCfg) {
      const mmTemplate = findRecipeTemplate(dbCfg.mainMealRecipeId);
      const dTemplate = findRecipeTemplate(dbCfg.dinnerRecipeId);
      mainMealName = mmTemplate.name;
      dinnerName = dTemplate.name;
    } else {
      const dtConfig = findDayTypeConfig(dt);
      const mmTemplate = findRecipeTemplate(dtConfig.variableSlots.mainMeal.recipeId);
      const dTemplate = findRecipeTemplate(dtConfig.variableSlots.dinner.recipeId);
      mainMealName = mmTemplate.name;
      dinnerName = dTemplate.name;
    }

    weekOverview.push({
      date: d.toISOString().slice(0, 10),
      dayOfWeek: DAY_NAMES[w],
      dayType: dt,
      recipeKey,
      recipeName: RECIPES[recipeKey].name,
      mainMealRecipeName: mainMealName,
      dinnerRecipeName: dinnerName,
      isCookDay: COOK_DAYS_WEEKDAY.includes(w),
    });
  }

  const adjustment = (log?.adjustment as DailyAdjustment | null) ?? null;

  // Reference unused functions to avoid TS dead-import warnings while keeping
  // the import surface stable for future helpers.
  void generateShoppingTrip1;
  void generateShoppingTrip2;
  void buildSlotsForWeekday;

  const body: NutritionTodayResponse = {
    date: today.toISOString().slice(0, 10),
    dayOfWeek: DAY_NAMES[today.getUTCDay()],
    dayType,
    source,
    plan: planSummary,
    dayPlan: dayPlanData,
    totals,
    adjustment,
    shopping: { next },
    weekOverview,
    weekdaySlots,
    slotLabels: SLOT_LABELS,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
