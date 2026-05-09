// GET /api/nutrition/today
// Returns today's nutrition plan for the current user. Falls back to the
// canonical template when no active MealPlan exists yet (pre-seed).

import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import { dayKey } from "@/lib/db/queries/sensors";
import { getDayType } from "@/lib/nutrition/day-type";
import { templateDayPlan, sumSlotMacros, SLOT_LABELS } from "@/lib/nutrition/template";
import {
  generateShoppingTrip1,
  generateShoppingTrip2,
  nextTripForDate,
} from "@/lib/nutrition/shopping-list";
import {
  WEEKLY_RECIPE_BY_WEEKDAY,
  COOK_DAYS_WEEKDAY,
  RECIPES,
} from "@/lib/nutrition/recipes";
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
    isCookDay: boolean;
  }[];
  slotLabels: Record<string, string>;
}

const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export async function GET() {
  const userId = await getCurrentUserId();
  const today = await userTodayDynamic();
  const dayType = getDayType(today);
  const todayKey = dayKey(today);

  // 1. Active plan + today's DayPlan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activePlan: any = await db.mealPlan.findFirst({
    where: { userId, status: "active" },
    include: {
      dayPlans: {
        where: { dayType },
      },
    },
  });

  // 2. Today's nutrition log (for any persisted adjustment)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const log: any = await db.dailyNutritionLog.findUnique({
    where: { userId_date: { userId, date: todayKey } },
  });

  let source: "active_plan" | "template_fallback" = "template_fallback";
  let dayPlanData: NutritionTodayResponse["dayPlan"];
  let planSummary: NutritionTodayResponse["plan"] = null;

  if (activePlan && activePlan.dayPlans?.[0]) {
    source = "active_plan";
    const dp = activePlan.dayPlans[0];
    dayPlanData = {
      dayType,
      tdeeEstimate: dp.tdeeEstimate,
      calorieTarget: dp.calorieTarget,
      proteinG: dp.proteinG,
      carbsG: dp.carbsG,
      fatG: dp.fatG,
      slots: dp.slots as MealSlots,
    };
    planSummary = {
      name: activePlan.name,
      calibrationStatus: activePlan.calibrationStatus,
      calibratedAt: activePlan.calibratedAt?.toISOString() ?? null,
      budgetPerDay: activePlan.budgetPerDay,
    };
  } else {
    // Fallback to canonical template — works even before seed has run.
    dayPlanData = templateDayPlan(dayType);
  }

  const totals = sumSlotMacros(dayPlanData.slots);

  // 3. Shopping (next trip for today)
  const next = nextTripForDate(today);

  // 4. 7-day overview from today
  const weekOverview: NutritionTodayResponse["weekOverview"] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const w = d.getUTCDay();
    const recipeKey = WEEKLY_RECIPE_BY_WEEKDAY[w];
    weekOverview.push({
      date: d.toISOString().slice(0, 10),
      dayOfWeek: DAY_NAMES[w],
      dayType: getDayType(d),
      recipeKey,
      recipeName: RECIPES[recipeKey].name,
      isCookDay: COOK_DAYS_WEEKDAY.includes(w),
    });
  }

  const adjustment = (log?.adjustment as DailyAdjustment | null) ?? null;

  // Reference unused functions to avoid TS dead-import warnings while keeping
  // the import surface stable for future helpers.
  void generateShoppingTrip1;
  void generateShoppingTrip2;

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
    slotLabels: SLOT_LABELS,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
