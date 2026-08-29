// ExerciseLog write helpers — extracted from POST /api/sessions/complete in
// Sprint 3.0 so the confirmation screen produces byte-identical rows.
//
// Two copies of the ExerciseLog contract would drift the first time one of them
// learned a new column — the same argument the codebase already makes about the
// Garmin run payload builder.

import { db } from "@/lib/db/client";
import { estimateOneRM } from "@/lib/coach-engine/strength-coach/one-rm";
import { weekInBlockOf } from "@/lib/coach-engine/strength-coach/periodization";
import type { PhaseConfig, StrengthExecutedSession } from "@/lib/coach-engine/types";

export interface ExerciseLogRow {
  userId: string;
  exerciseName: string;
  weightKg: number;
  repsCompleted: number;
  rpe: number | null;
  estimatedOneRM: number;
  date: Date;
  workoutId: string;
  slot: string;
  isDeload: boolean;
  weekInBlock: number | null;
}

/**
 * Sprint 2.1 #0: resolve the periodization snapshot at WRITE time so it stays
 * stable against a later resetBlock renumbering the weeks. `weekInBlock` comes
 * from the WeeklyPlan covering the workout date, using `config.durationWeeks`
 * (the same source the plan generator uses) — NOT the `Phase.durationWeeks`
 * column, which resetBlock extends.
 *
 * Keyed off the workout's own date, never today: a backdated confirmation must
 * land in the cycle it belongs to.
 */
export async function resolveWeekInBlockSnapshot(
  userId: string,
  workoutDate: Date,
): Promise<{ weekInBlock: number | null; isDeload: boolean }> {
  try {
    const coveringPlan = await db.weeklyPlan.findFirst({
      where: {
        phase: { macrocycle: { userId, status: "active" } },
        startDate: { lte: workoutDate },
        endDate: { gt: workoutDate },
      },
      include: { phase: true },
    });
    if (!coveringPlan) return { weekInBlock: null, isDeload: false };
    const cfg = coveringPlan.phase.config as unknown as PhaseConfig;
    const dur = cfg?.durationWeeks ?? 4;
    const weekInBlock = weekInBlockOf(coveringPlan.weekNumber, dur);
    return { weekInBlock, isDeload: weekInBlock === 4 };
  } catch (e) {
    console.error("[exercise-log-write] weekInBlock snapshot resolution failed:", e);
    return { weekInBlock: null, isDeload: false };
  }
}

/**
 * Turn executed strength exercises into ExerciseLog rows. Pure.
 *
 * The three skip rules are load-bearing, not tidiness: a skipped exercise, an
 * isometric with no load (Wall Sit), or a unilateral set whose reps arrive as
 * a string ("8/leg") carry no usable 1RM signal, and letting them through
 * would put noise into the training-max evaluation.
 */
export function buildExerciseLogRows(input: {
  userId: string;
  workoutId: string;
  slot: string;
  date: Date;
  weekInBlock: number | null;
  isDeload: boolean;
  exercises: StrengthExecutedSession["exercises"];
}): ExerciseLogRow[] {
  const rows: ExerciseLogRow[] = [];
  for (const ex of input.exercises) {
    if (ex.skipped) continue;
    for (const set of ex.actualSets) {
      if (!set.loadKg || set.loadKg <= 0) continue;
      if (!set.reps || set.reps <= 0) continue;
      const est = estimateOneRM(set.loadKg, set.reps, set.rpe ?? undefined);
      if (est <= 0) continue;
      rows.push({
        userId: input.userId,
        exerciseName: ex.name,
        weightKg: set.loadKg,
        repsCompleted: set.reps,
        rpe: set.rpe ?? null,
        estimatedOneRM: est,
        date: input.date,
        workoutId: input.workoutId,
        slot: input.slot,
        isDeload: input.isDeload,
        weekInBlock: input.weekInBlock,
      });
    }
  }
  return rows;
}

/**
 * Replace this workout's ExerciseLog rows.
 *
 * ExerciseLog has no unique constraint and, until Sprint 3.0, nothing ever
 * deleted from it — so a second confirmation of the same session wrote a
 * complete duplicate set of rows. Duplicates inflate `dataPoints` in the W4
 * review, shift the rolling 1RM median, and can flip the `initial_rebaseline`
 * branch that runs BEFORE the HSR shin gate.
 *
 * Delete-then-insert rather than skip-if-exists, because the likely correction
 * is un-claiming a session ("actually I did not lift as prescribed") — that has
 * to remove rows, not merely decline to add more. The delete is deliberately
 * scoped to one workoutId; it is the only ExerciseLog delete in the codebase.
 */
export async function replaceExerciseLogsForWorkout(
  userId: string,
  workoutId: string,
  rows: ExerciseLogRow[],
): Promise<void> {
  await db.$transaction([
    db.exerciseLog.deleteMany({ where: { userId, workoutId } }),
    ...(rows.length > 0 ? [db.exerciseLog.createMany({ data: rows })] : []),
  ]);
}
