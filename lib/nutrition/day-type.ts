// Day-type engine — Nutrition v2, derived from DayTypeConfigs.
//
// Maps weekdays to nutrition day-types and provides initial calorie/macro
// targets for the pre-calibration window.
//
// INITIAL_TARGETS and SLOT_PRESENCE are now DERIVED from DAY_TYPE_CONFIGS
// (the single source of truth in day-type-configs.ts). Changing a target
// or slot presence there automatically cascades here.

import { DAY_TYPE_CONFIGS } from "./day-type-configs";
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

// ── Initial pre-calibration targets — DERIVED from DAY_TYPE_CONFIGS ──────
// These are the starting values until the calibration engine has 14+ days
// of Garmin TDEE data. Real averages overwrite them at that point.
// tdeeEstimate = calorieTarget + 500 (conservative deficit assumption).

export interface DayTypeTargets {
  tdeeEstimate: number;
  calorieTarget: number; // tdee - deficitKcal
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const DEFAULT_DEFICIT = 500;

export const INITIAL_TARGETS: Record<DayType, DayTypeTargets> = Object.fromEntries(
  DAY_TYPE_CONFIGS.map((c) => [
    c.dayType,
    {
      tdeeEstimate: c.calorieTarget + DEFAULT_DEFICIT,
      calorieTarget: c.calorieTarget,
      proteinG: c.macroTargets.proteinG,
      carbsG: c.macroTargets.carbsG,
      fatG: c.macroTargets.fatG,
    },
  ]),
) as Record<DayType, DayTypeTargets>;

// ── Slot variation per day-type — DERIVED from DAY_TYPE_CONFIGS ──────────
// Which slots are present on each day-type.

export interface SlotPresence {
  morning: boolean;
  preTraining: boolean;
  mainMeal: boolean;
  postMealDessert: boolean; // Skyr — flex lever
  afternoonSnack: boolean;
  dinner: boolean;
  eveningSnack: boolean;
}

export const SLOT_PRESENCE: Record<DayType, SlotPresence> = Object.fromEntries(
  DAY_TYPE_CONFIGS.map((c) => [
    c.dayType,
    {
      morning: true,
      preTraining: c.fixedSlots.preTraining !== null,
      mainMeal: true,
      postMealDessert: c.fixedSlots.flexDessert?.enabled ?? false,
      afternoonSnack: true,
      dinner: true,
      eveningSnack: true,
    },
  ]),
) as Record<DayType, SlotPresence>;
