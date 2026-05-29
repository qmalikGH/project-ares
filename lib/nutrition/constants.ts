// Nutrition engine constants — leaf module (no imports) to avoid cycles.
//
// DEFICIT_KCAL is the single source of truth for the calorie deficit applied
// uniformly across all day types (Intake = TDEE − DEFICIT_KCAL). Both
// day-type-configs.ts (static intake targets) and daily-adjustment.ts (live
// Garmin-TDEE compensation) derive from it.

/**
 * Sprint v1.7: uniform deficit raised −500 → −600 kcal across all day types.
 * Centralized here so the future v1.8 "dynamic deficit" (rolling Garmin TDEE −
 * DEFICIT_KCAL) is a one-liner. Rate ≤ Garthe 0.7 %/week ceiling at ~90 kg.
 */
export const DEFICIT_KCAL = 600;

// Sprint v1.7 — Two-tier protein (Helms/Morton; FFM protection in a deficit).
/** HARD floor (g/kg): below this the plan FAILS validation. */
export const PROTEIN_HARD_FLOOR_PER_KG = 1.8;
/** SOFT target (g/kg): maximize-toward, NOT a hard fail. */
export const PROTEIN_SOFT_TARGET_PER_KG = 2.2;

// Sprint v1.7 — Fat guard-rails. Floor protects hormones/satiety after the
// −600 cut + Eiklar swap; cap stays from the documented range (50–85g).
export const FAT_FLOOR_PER_KG = 0.55;
export const FAT_MAX_G = 85;
