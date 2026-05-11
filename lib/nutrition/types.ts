// Nutrition module types — Sprint v0.16 Part B.
// Shapes for JSON columns in MealPlan / DayPlan / DailyNutritionLog and
// the daily-adjustment engine output.

// ── Day types ─────────────────────────────────────────────────────────────

export type DayType = "strength_run" | "threshold" | "long_run" | "rest";

// ── Meal slot structure (DayPlan.slots JSON) ──────────────────────────────

export interface MealItem {
  name: string;
  kcal: number;
  protein: number; // grams
  carbs: number; // grams
  fat: number; // grams
  costEur: number;
}

export interface MealSlot {
  items: MealItem[];
  // Optional: alternative items the user may swap in (e.g. snack rotation)
  alternatives?: (MealItem & { maxPerWeek?: number })[];
  // Optional: recipe key for the main meal / dinner — references RECIPES in
  // lib/nutrition/recipes.ts. Engine uses this to resolve cooking instructions.
  recipe?: string;
  // True if this slot is the primary "flex lever" for next-day adjustment
  // (post-meal dessert / Skyr is the canonical example).
  flexible?: boolean;
}

export interface MealSlots {
  morning: MealSlot;
  preTraining: MealSlot;
  mainMeal: MealSlot;
  postMealDessert: MealSlot;
  afternoonSnack: MealSlot;
  dinner: MealSlot;
  eveningSnack: MealSlot;
}

export type SlotKey = keyof MealSlots;

// ── Daily adjustment (B5) ────────────────────────────────────────────────

export type AdjustmentAction = "remove" | "reduce" | "add";

export interface SlotAdjustment {
  slot: SlotKey;
  action: AdjustmentAction;
  kcalEffect: number; // signed: negative when removing/reducing
  reason?: string;
}

export interface DailyAdjustment {
  date: string; // YYYY-MM-DD
  delta: number; // signed kcal: positive = over-ate plan vs target intake
  yesterdayTDEE: number;
  yesterdayPlannedIntake: number;
  yesterdayTargetIntake: number;
  message: string;
  adjustments: SlotAdjustment[];
}

// ── Calibration result (B6) ───────────────────────────────────────────────

export interface CalibrationResult {
  status: "calibrated" | "insufficient_data";
  averages: Partial<Record<DayType, number>>;
  daysAvailable: number;
  message: string;
}
