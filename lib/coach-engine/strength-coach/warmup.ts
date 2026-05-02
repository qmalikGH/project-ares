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
 * Deduplication: if two exercises share the same name (e.g. Hex Bar DL appears
 * in both Strength A and C), warmup sets are only generated for the FIRST
 * occurrence. The second occurrence benefits from the prior activation.
 *
 * Pure — returns a new array; inputs are not mutated.
 */
export function insertWarmupSets(
  exercises: Exercise[],
  maxEstimates?: Record<string, number> | null,
): Exercise[] {
  const warmedUpExercises = new Set<string>();
  const result: Exercise[] = [];

  for (const ex of exercises) {
    // Skip exercises that are already warmup sets (guard against double-insertion).
    // Track the name so we don't generate new warmups for the subsequent working set.
    if (ex.isWarmup) {
      warmedUpExercises.add(ex.name);
      result.push(ex);
      continue;
    }

    // Generate warmup sets only for first occurrence of qualifying exercises.
    if (
      ex.loadPct !== undefined &&
      ex.loadPct >= WARMUP_THRESHOLD_PCT &&
      !warmedUpExercises.has(ex.name)
    ) {
      const oneRM = maxEstimates?.[ex.name] ?? null;
      const warmupSets = generateWarmupSetsForExercise(ex, oneRM);
      result.push(...warmupSets);
      warmedUpExercises.add(ex.name);
    }

    result.push(ex);
  }

  return result;
}
