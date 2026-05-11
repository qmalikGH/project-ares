// POST /api/admin/calibrate-nutrition
// Triggers calibrateMealPlan() for the current user. Pulls 14-day rolling
// Garmin TDEE averages, computes new calorieTargets per day-type, and
// CASCADES the change into meal slot portions (protein-first backward compute).
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { calibrateMealPlan } from "@/lib/nutrition/calibration";

export async function POST() {
  const userId = await getCurrentUserId();
  const result = await calibrateMealPlan(userId);
  return NextResponse.json(result);
}
