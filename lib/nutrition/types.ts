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
  alternatives?: (MealItem & { maxPerWeek?: number })[];
  recipe?: string;
  recipeName?: string;
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

// ── Recipe template engine (v2) ──────────────────────────────────────────

/** A recipe template with per-unit nutritional data. Knows nothing about
 *  portion sizes — the cascade computes those. */
export interface RecipeTemplate {
  id: string; // e.g. "chicken_rice_asia"
  name: string; // e.g. "Hähnchen + Reis + TK Asia-Gemüse"
  components: RecipeComponent[];
  sauces: FixedComponent[]; // < 20 kcal, not scaled, just listed
}

export interface RecipeComponent {
  ingredientId: string; // e.g. "chicken_breast"
  role: "protein" | "carb" | "vegetable";
  portionUnit: "g" | "stück";
  kcalPerUnit: number; // per 1g or per 1 Stück
  proteinPerUnit: number;
  carbsPerUnit: number;
  fatPerUnit: number;
  costPerUnit: number; // EUR
  minimumAmount: number; // e.g. 50g rice, 3 eggs, 100g chicken
  maximumAmount: number; // e.g. 200g rice, 8 eggs, 400g chicken
  stepSize: number; // e.g. 25g (rice scaled in 25g steps)
}

export interface FixedComponent {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  cost: number;
}

/** Result of scaling a RecipeTemplate to a calorie budget. */
export interface ScaledRecipe {
  recipeId: string;
  recipeName: string;
  components: ScaledComponent[];
  sauces: FixedComponent[];
  totals: MacroTotals;
}

export interface ScaledComponent {
  ingredientId: string;
  name: string;
  amount: number; // scaled quantity
  unit: "g" | "stück";
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  cost: number;
}

export interface MacroTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  cost: number;
}

/** Full computed day plan with validation. */
export interface ComputedDayPlan {
  dayType: string;
  calorieTarget: number;
  fixedSlotsTotalKcal: number;
  remainingBudget: number;
  mainMeal: ScaledRecipe;
  dinner: ScaledRecipe;
  fixedSlots: Record<string, { items: FixedSlotItem[]; totalKcal: number }>;
  flexDessert: { enabled: boolean; items: FixedSlotItem[]; totalKcal: number } | null;
  totals: MacroTotals;
  validation: ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[]; // e.g. ["Protein 162g < minimum 184g"]
  warnings: string[]; // e.g. ["Cost €14.80 approaching €15 limit"]
}

// ── DayType configuration (v2 single source of truth) ────────────────────

export interface DayTypeConfig {
  dayType: string;
  calorieTarget: number;
  macroTargets: {
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  fixedSlots: {
    morning: FixedSlotDef;
    preTraining: FixedSlotDef | null; // null on rest days
    afternoonSnack: FixedSlotDef;
    eveningSnack: FixedSlotDef;
    flexDessert: FlexSlotDef | null; // Skyr lever
  };
  variableSlots: {
    mainMeal: {
      recipeId: string; // → RecipeTemplate.id
      budgetRatio: number; // share of remainingBudget (e.g. 0.55)
    };
    dinner: {
      recipeId: string; // → DIFFERENT RecipeTemplate.id
      budgetRatio: number; // e.g. 0.45 — must sum to 1.0 with mainMeal
    };
  };
  // v1.2 — Training timing fields (optional for backward compat)
  tdeeEstimate?: number; // Garmin-calibrated TDEE; calorieTarget = tdeeEstimate - deficit
  trainingWindow?: "morning" | "evening" | "both" | "none";
  dinnerNeedsCarbs?: boolean; // true when dinner = post-workout meal after threshold/long_run
}

export interface FixedSlotDef {
  items: FixedSlotItem[];
}

export interface FixedSlotItem {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  cost: number;
  /** Default true. When false, kcal count but protein is excluded from functional protein validation. */
  functionalProtein?: boolean;
}

export interface FlexSlotDef {
  enabled: boolean;
  items: FixedSlotItem[];
}

// ── Calibration result (B6) ───────────────────────────────────────────────

export interface CalibrationResult {
  status: "calibrated" | "insufficient_data";
  averages: Partial<Record<DayType, number>>;
  daysAvailable: number;
  message: string;
  /** Day-types skipped because a coaching override exists (updateCalorieTargets). */
  skippedCoachingOverride?: string[];
}
