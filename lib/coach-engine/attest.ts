// Building blocks for retroactive session confirmation — Sprint 3.0. Pure.
//
// The athlete trains but does not open the completion wizard. The nightly
// Garmin import fills in everything a watch can measure; these builders fill in
// what it cannot, after the fact:
//
//   - a shin score merged into an already-imported Garmin payload, without
//     touching a single byte of what Garmin delivered
//   - an executedSession for a session Garmin never saw
//   - the prescribed sets, materialised, when the athlete confirms the session
//     ran as written
//
// No db, no next/*.
//
// Sprint 3.2a — nothing here may pass the plan off as a measurement any more.
// A confirmed session without watch data is `source: "attested"`, and a
// duration nobody measured or typed in is carried as `durationEstimated: true`.
// For strength, the athlete enters the top set of each training-max lift; the
// "as prescribed" claim only fills in the rest and never reaches the TM review
// (its sets carry no RPE, see evaluateCycleClean).

import { TM_COMPOUNDS } from "./strength-coach/progression-mode";
import type { Exercise, SessionPlan, StrengthExecutedSession } from "./types";

/** Noon UTC on the workout's own day — never `new Date()`. A backdated
 *  confirmation has to land in the cycle it belongs to, and midday keeps the
 *  timestamp inside its own day under any timezone rendering. */
export function sessionTimestampFor(workoutDate: Date): string {
  const d = new Date(workoutDate);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

/**
 * Add the shin score to an existing executedSession without disturbing it.
 *
 * Deliberately a raw spread and NOT a zod round-trip: `.parse()` strips unknown
 * keys, so re-parsing would silently drop anything the Garmin importer learned
 * to store since this row was written. Returns null when there is nothing
 * sensible to merge into, so the caller can fall back to building a fresh one.
 */
export function mergeShinIntoExecuted(
  existing: unknown,
  shinPainNrs: number,
  shinPainNote?: string,
): Record<string, unknown> | null {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return null;
  const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  merged.shinPainNrs = shinPainNrs;
  if (shinPainNote !== undefined) merged.shinPainNote = shinPainNote;
  return merged;
}

/**
 * A run the watch never recorded. Shaped to satisfy RunExecutedSessionSchema —
 * in particular it carries the `type` discriminant, unlike the untyped blob the
 * completion route falls back to, which every safeParse consumer silently drops
 * (and with it the shin score it was carrying).
 *
 * Sprint 3.2a: `durationActualMin` is ONLY a duration the athlete typed in.
 * Without one, the planned duration stands in and is flagged as an estimate —
 * on 31.08. the plan's 30 min were stored as measured for a 13-minute run.
 */
export function buildAttestedRunSession(input: {
  workoutDate: Date;
  durationActualMin: number | null;
  plannedDurationMin?: number | null;
  shinPainNrs: number;
  shinPainNote?: string;
}): Record<string, unknown> {
  const estimated = input.durationActualMin == null;
  const minutes = input.durationActualMin ?? input.plannedDurationMin ?? 0;
  return {
    type: "run",
    source: "attested",
    garminActivityId: null,
    startTimeLocal: sessionTimestampFor(input.workoutDate),
    durationSec: minutes * 60,
    ...(estimated ? { durationEstimated: true } : {}),
    distanceM: null,
    averagePaceSecPerKm: null,
    averageHr: null,
    maxHr: null,
    elevationGainM: null,
    calories: null,
    splits: [],
    shinPainNrs: input.shinPainNrs,
    ...(input.shinPainNote !== undefined ? { shinPainNote: input.shinPainNote } : {}),
  };
}

/**
 * Would this exercise produce ExerciseLog rows if confirmed as prescribed?
 *
 * This is the contract that makes "ran as prescribed" honest: the screen shows
 * the athlete exactly which exercises the tap will record, so nobody attests to
 * work the system then discards. It mirrors the guards in buildExerciseLogRows
 * — warmups excluded, an absolute load required, numeric reps required.
 *
 * False for the accessories by design: Face Pulls, Pallof Press and the like
 * have no loadPct, and unilateral work arrives as "8/leg". Neither carries a
 * usable 1RM signal, and neither is a TM compound.
 */
export function willLogExercise(ex: Exercise): boolean {
  if (ex.isWarmup) return false;
  if (typeof ex.loadAbs !== "number" || ex.loadAbs <= 0) return false;
  if (typeof ex.reps !== "number" || ex.reps <= 0) return false;
  return ex.sets > 0;
}

/**
 * Turn the prescribed exercises into executed sets.
 *
 * The loads come from `loadAbs` on the stored plan — the kg baked in when the
 * plan was generated. They are NOT re-derived from today's training maxes: the
 * athlete lifted the weight that was on the screen that day, and a TM that has
 * moved since would rewrite history.
 *
 * Per-set RPE is null. Nobody rated individual sets, and estimateOneRM without
 * an RPE is plain Epley — a systematically lower, i.e. more conservative, 1RM
 * estimate than a hand-logged session at the same weight.
 */
export function materialisePrescribedSets(
  plannedSession: SessionPlan | null | undefined,
): StrengthExecutedSession["exercises"] {
  const exercises = plannedSession?.exercises ?? [];
  return exercises
    .filter((ex) => !ex.isWarmup)
    .map((ex) => {
      const loggable = willLogExercise(ex);
      const reps = typeof ex.reps === "number" ? ex.reps : 0;
      return {
        name: ex.name,
        plannedSets: ex.sets,
        plannedReps: ex.reps,
        plannedLoadPct: ex.loadPct ?? null,
        actualSets: loggable
          ? Array.from({ length: ex.sets }, () => ({
              reps,
              loadKg: ex.loadAbs as number,
              rpe: null,
              durationSec: null,
            }))
          : [],
        skipped: false,
      };
    });
}

/** A strength executedSession for a session confirmed without watch data.
 *  Same duration rule as the run: only a typed-in duration is a measurement. */
export function buildAttestedStrengthSession(input: {
  workoutDate: Date;
  durationActualMin: number | null;
  plannedDurationMin?: number | null;
  exercises: StrengthExecutedSession["exercises"];
  shinPainNrs: number;
  shinPainNote?: string;
}): Record<string, unknown> {
  const estimated = input.durationActualMin == null;
  return {
    type: "strength",
    source: "attested",
    garminActivityId: null,
    startTimeLocal: sessionTimestampFor(input.workoutDate),
    durationActualMin: input.durationActualMin ?? input.plannedDurationMin ?? 0,
    ...(estimated ? { durationEstimated: true } : {}),
    exercises: input.exercises,
    averageHr: null,
    maxHr: null,
    calories: null,
    shinPainNrs: input.shinPainNrs,
    ...(input.shinPainNote !== undefined ? { shinPainNote: input.shinPainNote } : {}),
  };
}

// ── Sprint 3.2a: top sets ────────────────────────────────────────────────

/** The heaviest set of one training-max lift, as typed in /confirm. */
export interface TopSetInput {
  exercise: string;
  weightKg: number;
  reps: number;
}

/**
 * The lifts in this session whose top set the athlete may enter: training-max
 * compounds the plan actually contains. Accessories carry no usable 1RM signal
 * and never reach the TM review, so asking for them would be work for nothing.
 */
export function topSetLiftsFor(plannedSession: SessionPlan | null | undefined): string[] {
  return (plannedSession?.exercises ?? [])
    .filter((ex) => !ex.isWarmup && TM_COMPOUNDS.has(ex.name))
    .map((ex) => ex.name);
}

/**
 * Executed exercises for a confirmed strength session.
 *
 *   - Each accepted top set becomes ONE set that carries the session RPE. The
 *     heaviest set is what a strength session's RPE is mostly about — a proxy,
 *     but one that can say "too hard" or "too light", which the as-prescribed
 *     claim never could. It is the only path by which /confirm data can move a
 *     training max, in either direction.
 *   - `asPrescribed` fills in the remaining loggable exercises, rpe null, so
 *     volume is recorded without pretending to be evidence.
 *   - A lift with a top set is never materialised a second time.
 *   - Top sets for anything outside topSetLiftsFor are returned as rejected.
 *
 * Pure.
 */
export function buildConfirmedExercises(input: {
  plannedSession: SessionPlan | null | undefined;
  topSets: readonly TopSetInput[];
  asPrescribed: boolean;
  sessionRpe: number;
}): { exercises: StrengthExecutedSession["exercises"]; rejected: string[] } {
  const allowed = new Set(topSetLiftsFor(input.plannedSession));
  const planned = new Map(
    (input.plannedSession?.exercises ?? [])
      .filter((ex) => !ex.isWarmup)
      .map((ex) => [ex.name, ex] as const),
  );

  const rejected: string[] = [];
  const top: StrengthExecutedSession["exercises"] = [];
  const seen = new Set<string>();
  for (const t of input.topSets) {
    if (!allowed.has(t.exercise) || seen.has(t.exercise)) {
      rejected.push(t.exercise);
      continue;
    }
    seen.add(t.exercise);
    const ex = planned.get(t.exercise) as Exercise;
    top.push({
      name: t.exercise,
      plannedSets: ex.sets,
      plannedReps: ex.reps,
      plannedLoadPct: ex.loadPct ?? null,
      actualSets: [{ reps: t.reps, loadKg: t.weightKg, rpe: input.sessionRpe, durationSec: null }],
      skipped: false,
    });
  }

  const rest = input.asPrescribed
    ? materialisePrescribedSets(input.plannedSession).filter((ex) => !seen.has(ex.name))
    : [];

  return { exercises: [...top, ...rest], rejected };
}
