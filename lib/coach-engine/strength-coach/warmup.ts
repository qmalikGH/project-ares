// Warmup-Set-Generator (Sprint v0.13) — pure module.
//
// Generates progressive ramp-up sets for compound lifts before working sets.
// Only applies to exercises with loadPct >= 60% (compounds). Accessories,
// bodyweight exercises, and plyometrics don't get warmup sets.
//
// Evidence base:
//   - Viveiros 2024 (RCT, n=15): WU at 80% of working load → significantly
//     higher Total Training Volume than 40% or 60%.
//   - Ribeiro 2020 (RCT, n=40): WU80 → higher Mean Propulsive Velocity in
//     squats vs WU40.
//   - Morrison 2022: HSR protocols often violate progressive loading principles.
//   - Kraemer 2024: Progression to heavy loading requires phased ramp-up.
//
// Protocol: 3-stage ramp for exercises with loadPct >= 60%:
//   Stage 1: ~50% of working loadPct × 5 reps
//   Stage 2: ~70% of working loadPct × 3 reps
//   Stage 3: ~85% of working loadPct × 2 reps
//
// Pure — does not mutate inputs; returns a new array with warmup sets prepended.

import type { Exercise } from "../types";
import { loadPctToKg } from "./one-rm";

/** Minimum loadPct threshold for generating warmup sets. Below this,
 *  the exercise is light enough that ramp-up is unnecessary. */
const WARMUP_THRESHOLD_PCT = 60;

/** Movement pattern groups for warmup deduplication.
 *  Once any exercise in a group gets ramp-up sets, all subsequent
 *  exercises in the SAME group skip ramp-up (muscles are already warm). */
type MovementGroup = "lower_body" | "upper_push" | "upper_pull" | "full_body";

const EXERCISE_MOVEMENT_GROUP: Record<string, MovementGroup> = {
  // Lower Body — hip hinge, knee dominant, glutes, calves, carries
  "Hex Bar Deadlift": "lower_body",
  "Romanian Deadlift": "lower_body",
  "Conventional Deadlift": "lower_body",
  "Reverse Lunge": "lower_body",
  "Bulgarian Split Squat": "lower_body",
  "Front Squat": "lower_body",
  "Hip Thrust": "lower_body",
  "Single-Leg Hip Thrust": "lower_body",
  "Standing Calf Raises": "lower_body",
  "Seated Calf Raises": "lower_body",
  "Single-Leg Calf Raises": "lower_body",
  "Farmer's Carry": "lower_body",
  "Suitcase Carry": "lower_body",
  // Upper Push
  "Bench Press": "upper_push",
  "DB Bench Press": "upper_push",
  "Incline DB Press": "upper_push",
  "Push-ups": "upper_push",
  "DB Shoulder Press": "upper_push",
  // Upper Pull
  "Pull-ups": "upper_pull",
  "Lat Pulldown": "upper_pull",
  "Barbell Row": "upper_pull",
};

function getMovementGroup(exerciseName: string): MovementGroup | null {
  return EXERCISE_MOVEMENT_GROUP[exerciseName] ?? null;
}

/** Ramp-up stages as fractions of the working loadPct. */
const RAMP_STAGES: readonly { fraction: number; reps: number }[] = [
  { fraction: 0.5, reps: 5 },
  { fraction: 0.7, reps: 3 },
  { fraction: 0.85, reps: 2 },
];

/** Rest between warmup sets — shorter than working sets. */
const WARMUP_REST_SEC = 60;

/**
 * Generate warmup sets for a single exercise.
 * Returns an array of warmup Exercise objects.
 * Returns empty array if exercise doesn't qualify (no loadPct, or < threshold).
 */
export function generateWarmupSetsForExercise(
  exercise: Exercise,
  oneRM?: number | null,
): Exercise[] {
  if (
    exercise.loadPct === undefined ||
    exercise.loadPct < WARMUP_THRESHOLD_PCT
  ) {
    return [];
  }

  return RAMP_STAGES.map((stage) => {
    const warmupLoadPct = Math.round(exercise.loadPct! * stage.fraction);
    const warmupExercise: Exercise = {
      name: exercise.name,
      sets: 1,
      reps: stage.reps,
      loadPct: warmupLoadPct,
      rpeCap: Math.max(3, (exercise.rpeCap ?? 8) - 3), // WU RPE much lower
      tempo: exercise.tempo,
      restSec: WARMUP_REST_SEC,
      isWarmup: true,
    };
    // Fill absolute kg if 1RM is known.
    if (typeof oneRM === "number" && oneRM > 0) {
      warmupExercise.loadAbs = loadPctToKg(oneRM, warmupLoadPct);
    }
    return warmupExercise;
  });
}

/**
 * Insert warmup sets before the first working set of each qualifying exercise
 * in a session's exercise array.
 *
 * Deduplication is by movement pattern group (lower_body, upper_push,
 * upper_pull, full_body). Once any exercise in a group has been ramped up,
 * all subsequent exercises in the same group skip ramp-up — the muscles
 * are already warm. Exercises not mapped to a group do not receive warmup.
 *
 * Pure — returns a new array; inputs are not mutated.
 */
export function insertWarmupSets(
  exercises: Exercise[],
  maxEstimates?: Record<string, number> | null,
): Exercise[] {
  const warmedUpGroups = new Set<MovementGroup>();
  const result: Exercise[] = [];

  for (const ex of exercises) {
    // Pass through pre-existing warmup sets and mark their group as warm
    // so a subsequent working set in the same group doesn't get re-ramped.
    if (ex.isWarmup) {
      const group = getMovementGroup(ex.name);
      if (group !== null) {
        warmedUpGroups.add(group);
      }
      result.push(ex);
      continue;
    }

    const group = getMovementGroup(ex.name);
    // Generate warmup sets only if:
    //   1. Exercise qualifies (loadPct >= 60%)
    //   2. Exercise is mapped to a movement group
    //   3. No other exercise in the same movement group has been warmed up yet
    if (
      ex.loadPct !== undefined &&
      ex.loadPct >= WARMUP_THRESHOLD_PCT &&
      group !== null &&
      !warmedUpGroups.has(group)
    ) {
      const oneRM = maxEstimates?.[ex.name] ?? null;
      const warmupSets = generateWarmupSetsForExercise(ex, oneRM);
      result.push(...warmupSets);
      warmedUpGroups.add(group);
    }

    result.push(ex);
  }

  return result;
}
