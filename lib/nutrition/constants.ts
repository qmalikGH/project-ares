// Nutrition engine constants — leaf module (no imports) to avoid cycles.
//
// DEFICIT_KCAL is the single source of truth for the calorie deficit applied
// uniformly across all day types (Intake = TDEE − DEFICIT_KCAL). Both
// day-type-configs.ts (static intake targets) and daily-adjustment.ts (live
// Garmin-TDEE compensation) derive from it.

/**
 * Sprint 2.7 (A5): uniform deficit lowered −600 → −300 kcal across all day types.
 *
 * The −600 of v1.7 was justified by the Garthe rate ceiling alone (0.7 %/week at
 * ~90 kg ≈ 693 kcal), which only bounds how FAST mass comes off — it says nothing
 * about whether the athlete has enough energy left to remodel bone. At −600 the
 * energy availability landed at ≈23–29 kcal/kg FFM on ALL four day types, i.e.
 * below the 30 kcal/kg threshold where bone turnover measurably suffers, on an
 * athlete with an active bone-stress injury (shin splints). −300 lifts every day
 * type to ≈27–33.
 *
 * NOTE: this constant is only the SEED. At runtime `MealPlan.deficitKcal` is the
 * authority (see calibration.ts); the constant reaches the DB exclusively through
 * force-reseed / the forceReseed coaching action. Editing it alone changes nothing.
 * The live deficit is additionally resolved through `resolveDeficitKcal` (deficit.ts),
 * which tapers it to 0 as the athlete approaches `targetWeightKg`.
 */
export const DEFICIT_KCAL = 300;

// Sprint v1.7 — Two-tier protein (Helms/Morton; FFM protection in a deficit).
/** HARD floor (g/kg): below this the plan FAILS validation. */
export const PROTEIN_HARD_FLOOR_PER_KG = 1.8;
/** SOFT target (g/kg): maximize-toward, NOT a hard fail. */
export const PROTEIN_SOFT_TARGET_PER_KG = 2.2;

/**
 * Sprint 2.7 (A5): THE protein target in grams for a given body mass.
 *
 * Before this there were three competing authorities writing `proteinG`: the
 * static day-type configs (200 g), the morning-input weight cascade
 * (`ceil(kg × 2.0)`) and the calibration engine (a hardcoded 190 g). Whichever
 * ran last won. All three now derive from PROTEIN_SOFT_TARGET_PER_KG, which is
 * also what `scale-variable-slots` already maximizes toward — so the config
 * target and the engine's own target finally agree instead of silently
 * overriding one another.
 */
export function proteinTargetG(weightKg: number): number {
  return Math.round(weightKg * PROTEIN_SOFT_TARGET_PER_KG);
}

/**
 * Carbohydrate floors (g/kg). Until Sprint 2.7 carbohydrate was the only
 * macronutrient without a lower bound anywhere: `computeMacros` derived it as
 * the pure residual with a silent `Math.max(0, …)`, so every kcal the deficit
 * took came out of the one macro that fuels the training. Observed live
 * consequence: the 2026-06-15 calibration produced a rest day with 42 g.
 *
 * ACSM/Burke give 3–5 g/kg/d for light training and 5–7 g/kg/d for ~1 h/d of
 * moderate training. TRAINING = 3.0 is therefore the bottom of the LIGHTEST
 * recommendation — deliberately below the target band, so the floor only ever
 * catches broken inputs and never shapes a healthy plan. REST = 2.0 sits below
 * even that, justified by CNS glucose demand plus glycogen carry-over into the
 * next day's session.
 */
export const CARB_FLOOR_PER_KG_TRAINING = 3.0;
export const CARB_FLOOR_PER_KG_REST = 2.0;

/**
 * Minimum budget left for the two variable slots after the fixed slots are
 * paid for. Below this `computeDayPlan` throws rather than shipping a plan.
 * Lives here (not in compute-day-plan.ts) so `min-intake.ts` derives its
 * structural floor from the SAME number the validator enforces — otherwise the
 * floor and the thing it protects against could drift apart.
 */
export const MIN_REMAINING_BUDGET = 400;

/**
 * Atwater realism factor for the derived intake floor.
 *
 * The macro floors are expressed in grams and converted with textbook Atwater
 * (4/4/9), but real foods carry passengers: chicken breast costs ~5.0 kcal per
 * gram of protein, dry rice ~4.5 kcal per gram of carbohydrate. A floor built
 * on bare Atwater would therefore claim a target is feasible ~8 % before it
 * actually is.
 */
export const FOOD_REALISM_FACTOR = 1.08;

// Fat guard-rails. Floor protects hormones/satiety. v1.9: 0.55 → 0.50 g/kg —
// 0.5 g/kg (~46g) is the common minimum-fat guideline; 0.55 made lean
// fueling days (2 rice bags + lean protein) fail by ~2g for no real reason.
export const FAT_FLOOR_PER_KG = 0.5;
export const FAT_MAX_G = 85;

// ── Sprint v1.8 #4 — Dynamic deficit guards ────────────────────────────────

/**
 * General TDEE plausibility floor (all day types). Garmin non-wear / corrupt
 * days produce implausibly low totals (observed 839 / 1534 kcal); below this
 * floor a day is excluded from the rolling-TDEE average so it can't poison the
 * calorie targets. Rest days additionally have REST_DAY_TDEE_FLOOR (2000).
 */
export const TDEE_PLAUSIBILITY_FLOOR = 1800;

/** Garthe et al. — max ~0.7 %/week body-mass loss to preserve FFM. */
export const GARTHE_MAX_WEEKLY_RATE = 0.007;
/** kcal per kg body mass (energy density of weight change). */
export const KCAL_PER_KG = 7700;

/**
 * Max daily kcal deficit that keeps the loss rate ≤ Garthe's 0.7 %/week ceiling
 * at a given body mass. At 90 kg ≈ 693 kcal/d (so −600 is safe); the cap only
 * bites as weight drops below ~77 kg.
 */
export function gartheMaxDeficit(weightKg: number): number {
  return Math.round((GARTHE_MAX_WEEKLY_RATE * weightKg * KCAL_PER_KG) / 7);
}
