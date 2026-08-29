// Pins the ExerciseLog row contract extracted from POST /api/sessions/complete
// in Sprint 3.0. Written BEFORE the route was rewired, so a behaviour change
// during the extraction would have shown up here.
import { describe, expect, it } from "vitest";

import { buildExerciseLogRows } from "@/lib/db/queries/exercise-log-write";
import type { StrengthExecutedSession } from "@/lib/coach-engine/types";

type Exercises = StrengthExecutedSession["exercises"];

const BASE = {
  userId: "u1",
  workoutId: "w1",
  slot: "strength_a",
  date: new Date("2026-08-24T12:00:00.000Z"),
  weekInBlock: 2,
  isDeload: false,
};

function exercise(over: Partial<Exercises[number]> = {}): Exercises[number] {
  return {
    name: "Hex Bar Deadlift",
    plannedSets: 3,
    plannedReps: 5,
    plannedLoadPct: 82,
    actualSets: [{ reps: 5, loadKg: 120, rpe: 8, durationSec: null }],
    skipped: false,
    ...over,
  } as Exercises[number];
}

describe("buildExerciseLogRows — skip rules", () => {
  it("writes one row per loaded set", () => {
    const rows = buildExerciseLogRows({
      ...BASE,
      exercises: [exercise({ actualSets: [
        { reps: 5, loadKg: 120, rpe: 8, durationSec: null },
        { reps: 5, loadKg: 120, rpe: 9, durationSec: null },
      ] })],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].estimatedOneRM).toBeGreaterThan(120);
  });

  it("skips an exercise marked skipped", () => {
    expect(buildExerciseLogRows({ ...BASE, exercises: [exercise({ skipped: true })] })).toHaveLength(0);
  });

  it("skips sets with no load — isometrics like Wall Sit", () => {
    expect(buildExerciseLogRows({ ...BASE, exercises: [exercise({
      name: "Wall Sit", actualSets: [{ reps: 1, loadKg: null, rpe: null, durationSec: 45 }],
    })] })).toHaveLength(0);
  });

  it("skips sets with zero or missing reps", () => {
    expect(buildExerciseLogRows({ ...BASE, exercises: [exercise({
      actualSets: [{ reps: 0, loadKg: 120, rpe: null, durationSec: null }],
    })] })).toHaveLength(0);
  });

  it("keeps a set without RPE — Epley without the RIR projection", () => {
    const rows = buildExerciseLogRows({ ...BASE, exercises: [exercise({
      actualSets: [{ reps: 5, loadKg: 120, rpe: null, durationSec: null }],
    })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].rpe).toBeNull();
  });

  it("a missing RPE yields a lower — i.e. more conservative — 1RM estimate", () => {
    const withRpe = buildExerciseLogRows({ ...BASE, exercises: [exercise({
      actualSets: [{ reps: 5, loadKg: 120, rpe: 8, durationSec: null }],
    })] })[0].estimatedOneRM;
    const without = buildExerciseLogRows({ ...BASE, exercises: [exercise({
      actualSets: [{ reps: 5, loadKg: 120, rpe: null, durationSec: null }],
    })] })[0].estimatedOneRM;
    expect(without).toBeLessThan(withRpe);
  });
});

describe("buildExerciseLogRows — the periodization snapshot", () => {
  it("stamps every row with the passed date, slot and week", () => {
    const rows = buildExerciseLogRows({ ...BASE, exercises: [exercise()] });
    expect(rows[0].date).toEqual(BASE.date);
    expect(rows[0].slot).toBe("strength_a");
    expect(rows[0].weekInBlock).toBe(2);
    expect(rows[0].isDeload).toBe(false);
    expect(rows[0].workoutId).toBe("w1");
    expect(rows[0].userId).toBe("u1");
  });

  it("uses the workout's date, never the clock", () => {
    // A backdated confirmation must land in the cycle it belongs to; the
    // training-max evaluation windows are date-bounded.
    const rows = buildExerciseLogRows({ ...BASE, exercises: [exercise()] });
    expect(rows[0].date.toISOString().slice(0, 10)).toBe("2026-08-24");
  });
});
