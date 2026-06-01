// Progression-mode taxonomy (Sprint 2.1) — pure module, no I/O.
//
// Single source of truth for HOW each exercise progresses load:
//   - "training_max": real loaded compounds. Load = `%×TM`; the TM (stored in
//     UserSettings.exerciseMaxEstimates) increments at the W4 cycle review.
//   - "rep_rpe": accessories, carries, plyos. Progress via reps/RPE or
//     "last week + increment" — NEVER a 1RM/TM.
//   - "none": pure isometrics / activation (Wall Sit, Short Foot). No load
//     progression tracked at all.
//
// Used by generateWeekStrengthPlan (stamps Exercise.progressionMode), the
// TM-increment proposal (block-transition.ts), and the "last week" UI.

/**
 * The loaded compounds that run on a Training Max. Lower-body hinge/press get a
 * larger absolute jump than upper-body lifts (#1 increment rule).
 *
 * NOTE: only lifts that are genuinely driven by `%×TM` in the templates. DB Row
 * is intentionally NOT here — it rotates as an accessory horizontal-pull and
 * often carries no loadPct, so it progresses via reps/RPE.
 */
const TM_LOWER: ReadonlySet<string> = new Set([
  "Hex Bar Deadlift",
  "Romanian Deadlift",
  "RDL",
  "Hip Thrust",
  "Single-Leg Hip Thrust",
]);

const TM_UPPER: ReadonlySet<string> = new Set([
  "Bench Press",
  "DB Bench Press",
  "Incline DB Press",
  "Barbell Row",
  "DB Shoulder Press",
]);

/** All Training-Max compounds (lower ∪ upper). */
export const TM_COMPOUNDS: ReadonlySet<string> = new Set([
  ...TM_LOWER,
  ...TM_UPPER,
]);

/** Pure isometrics / activation — no load progression. */
const NO_PROGRESSION: ReadonlySet<string> = new Set([
  "Wall Sit",
  "Short Foot Exercise",
]);

export type ProgressionMode = "training_max" | "rep_rpe" | "none";

/**
 * Classify how an exercise progresses. Default is "rep_rpe" — accessories,
 * carries, plyos, calf raises, core, prehab all progress via reps/RPE.
 */
export function progressionModeFor(name: string): ProgressionMode {
  if (TM_COMPOUNDS.has(name)) return "training_max";
  if (NO_PROGRESSION.has(name)) return "none";
  return "rep_rpe";
}

/**
 * Absolute TM increment (kg) earned on a clean cycle, per #1:
 *   +5 kg lower-body hinge/press, +2.5 kg upper-body. 0 for non-TM exercises.
 */
export function tmIncrementKg(name: string): number {
  if (TM_LOWER.has(name)) return 5;
  if (TM_UPPER.has(name)) return 2.5;
  return 0;
}
