// Day-type engine — Sprint v0.16 Phase B2.
// Maps weekdays to nutrition day-types and provides initial calorie/macro
// targets for the pre-calibration window.

import type { DayType } from "./types";

// ── Weekday → DayType mapping ────────────────────────────────────────────
// Mirrors Q's training rhythm:
//   Mon: Easy + Strength A     → strength_run
//   Tue: Threshold/Calibration → threshold
//   Wed: Rest
//   Thu: Easy + Strength B     → strength_run
//   Fri: Easy + Strength C     → strength_run
//   Sat: Long Run              → long_run
//   Sun: Rest
//
// Keyed by JS getUTCDay() values: 0=Sun, 1=Mon, ..., 6=Sat.
export const DAY_TYPE_BY_WEEKDAY: Record<number, DayType> = {
  0: "rest",
  1: "strength_run",
  2: "threshold",
  3: "rest",
  4: "strength_run",
  5: "strength_run",
  6: "long_run",
};

/**
 * Returns the nutrition day-type for the given date, evaluated in UTC.
 * Callers that need timezone-aware "today" should pass the result of
 * `userTodayDynamic()` (already a UTC-midnight Date for the user's TZ).
 */
export function getDayType(date: Date): DayType {
  return DAY_TYPE_BY_WEEKDAY[date.getUTCDay()] ?? "rest";
}

// ── Initial pre-calibration targets (B2.2) ───────────────────────────────
// These are conservative estimates used until the calibration engine has
// 14 days of Garmin TDEE data. Real averages overwrite them at that point.

export interface DayTypeTargets {
  tdeeEstimate: number;
  calorieTarget: number; // tdee - deficitKcal
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const DEFAULT_DEFICIT = 500;
const DEFAULT_PROTEIN_G = 190;
const DEFAULT_FAT_G = 70;

function compute(tdee: number): DayTypeTargets {
  const calorieTarget = tdee - DEFAULT_DEFICIT;
  // Macro split: 190g protein × 4 kcal + 70g fat × 9 kcal = 1390 kcal.
  // Carbs fill the remainder.
  const carbsKcal = calorieTarget - DEFAULT_PROTEIN_G * 4 - DEFAULT_FAT_G * 9;
  return {
    tdeeEstimate: tdee,
    calorieTarget,
    proteinG: DEFAULT_PROTEIN_G,
    carbsG: Math.max(0, Math.round(carbsKcal / 4)),
    fatG: DEFAULT_FAT_G,
  };
}

export const INITIAL_TARGETS: Record<DayType, DayTypeTargets> = {
  strength_run: compute(3000),
  threshold: compute(2800),
  long_run: compute(3200),
  rest: compute(2200),
};

// ── Slot variation per day-type (B2.3) ───────────────────────────────────
// Which slots are present on each day-type. Rest days drop pre-training
// (no nitrate priming needed) and downsize dinner / no Skyr → ~500 kcal less.

export interface SlotPresence {
  morning: boolean;
  preTraining: boolean;
  mainMeal: boolean;
  postMealDessert: boolean; // Skyr — flex lever
  afternoonSnack: boolean;
  dinner: boolean;
  eveningSnack: boolean;
}

export const SLOT_PRESENCE: Record<DayType, SlotPresence> = {
  strength_run: {
    morning: true,
    preTraining: true,
    mainMeal: true,
    postMealDessert: true,
    afternoonSnack: true,
    dinner: true,
    eveningSnack: true,
  },
  threshold: {
    morning: true,
    preTraining: true,
    mainMeal: true,
    postMealDessert: true,
    afternoonSnack: true,
    dinner: true,
    eveningSnack: true,
  },
  long_run: {
    morning: true,
    preTraining: true,
    mainMeal: true,
    postMealDessert: true,
    afternoonSnack: true,
    dinner: true,
    eveningSnack: true,
  },
  rest: {
    morning: true,
    preTraining: false, // no run/lift → skip nitrate priming
    mainMeal: true,
    postMealDessert: false, // drop Skyr (~130 kcal)
    afternoonSnack: true,
    dinner: true, // smaller portion handled at slot-content level
    eveningSnack: true,
  },
};
