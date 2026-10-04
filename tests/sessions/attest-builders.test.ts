// Pure builders for retroactive confirmation — Sprint 3.0.
import { describe, expect, it, vi, afterEach } from "vitest";

import {
  buildAttestedRunSession,
  buildAttestedStrengthSession,
  buildConfirmedExercises,
  materialisePrescribedSets,
  mergeShinIntoExecuted,
  sessionTimestampFor,
  topSetLiftsFor,
  willLogExercise,
} from "@/lib/coach-engine/attest";
import { buildExerciseLogRows } from "@/lib/db/queries/exercise-log-write";
import {
  RunExecutedSessionSchema,
  StrengthExecutedSessionSchema,
} from "@/lib/coach-engine/types";
import type { Exercise, SessionPlan } from "@/lib/coach-engine/types";

const WORKOUT_DATE = new Date("2026-08-24T00:00:00.000Z");

function ex(over: Partial<Exercise> = {}): Exercise {
  return { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, loadAbs: 120, ...over };
}

afterEach(() => vi.useRealTimers());

describe("willLogExercise — the contract behind 'ran as prescribed'", () => {
  it("logs a TM compound with an absolute load", () => {
    expect(willLogExercise(ex())).toBe(true);
  });

  it("never logs a warmup", () => {
    expect(willLogExercise(ex({ isWarmup: true }))).toBe(false);
  });

  it("does not log an accessory without an absolute load", () => {
    // Face Pulls, Pallof Press, DB Row: no loadPct → fillAbsoluteLoads leaves
    // loadAbs undefined → no usable 1RM signal.
    expect(willLogExercise(ex({ name: "Face Pulls", loadPct: undefined, loadAbs: undefined }))).toBe(false);
  });

  it("does not log unilateral or isometric work (string reps)", () => {
    expect(willLogExercise(ex({ name: "Bulgarian Split Squat", reps: "8/leg" }))).toBe(false);
    expect(willLogExercise(ex({ name: "Wall Sit", reps: "45sec", loadAbs: undefined }))).toBe(false);
  });
});

describe("materialisePrescribedSets", () => {
  const planned: SessionPlan = {
    type: "strength_a",
    exercises: [
      ex({ name: "Warmup Goblet Squat", isWarmup: true }),
      ex({ name: "Hex Bar Deadlift", sets: 4, reps: 5, loadAbs: 120 }),
      ex({ name: "Face Pulls", sets: 3, reps: 15, loadPct: undefined, loadAbs: undefined }),
      ex({ name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", loadAbs: undefined }),
    ],
  } as unknown as SessionPlan;

  it("drops warmups entirely", () => {
    const out = materialisePrescribedSets(planned);
    expect(out.map((e) => e.name)).not.toContain("Warmup Goblet Squat");
  });

  it("produces one set per prescribed set at the prescribed load", () => {
    const hex = materialisePrescribedSets(planned).find((e) => e.name === "Hex Bar Deadlift")!;
    expect(hex.actualSets).toHaveLength(4);
    expect(hex.actualSets.every((s) => s.loadKg === 120 && s.reps === 5)).toBe(true);
  });

  it("leaves per-set RPE null — nobody rated individual sets", () => {
    const hex = materialisePrescribedSets(planned).find((e) => e.name === "Hex Bar Deadlift")!;
    expect(hex.actualSets.every((s) => s.rpe === null)).toBe(true);
  });

  it("keeps unloggable exercises in the payload but with no sets", () => {
    // They belong in executedSession as a record of what was prescribed; they
    // just must not reach ExerciseLog.
    const out = materialisePrescribedSets(planned);
    expect(out.find((e) => e.name === "Face Pulls")!.actualSets).toHaveLength(0);
    expect(out.find((e) => e.name === "Bulgarian Split Squat")!.actualSets).toHaveLength(0);
  });

  it("handles a session with no exercises", () => {
    expect(materialisePrescribedSets(null)).toEqual([]);
  });

  // The load-bearing agreement: what the screen promises equals what is written.
  it("willLog agrees with the rows the writer actually produces", () => {
    const exercises = materialisePrescribedSets(planned);
    const rows = buildExerciseLogRows({
      userId: "u1", workoutId: "w1", slot: "strength_a",
      date: WORKOUT_DATE, weekInBlock: 2, isDeload: false, exercises,
    });
    const promised = (planned.exercises ?? []).filter(willLogExercise);
    const expectedRows = promised.reduce((n, e) => n + e.sets, 0);
    expect(rows).toHaveLength(expectedRows);
    expect(new Set(rows.map((r) => r.exerciseName))).toEqual(new Set(promised.map((e) => e.name)));
  });
});

describe("timestamps come from the workout, not the clock", () => {
  it("uses the workout's own day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T18:00:00.000Z"));
    expect(sessionTimestampFor(WORKOUT_DATE).slice(0, 10)).toBe("2026-08-24");
  });

  it("both builders inherit that", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T18:00:00.000Z"));
    const run = buildAttestedRunSession({ workoutDate: WORKOUT_DATE, durationActualMin: 45, shinPainNrs: 1 });
    const str = buildAttestedStrengthSession({ workoutDate: WORKOUT_DATE, durationActualMin: 60, exercises: [], shinPainNrs: 1 });
    expect((run.startTimeLocal as string).slice(0, 10)).toBe("2026-08-24");
    expect((str.startTimeLocal as string).slice(0, 10)).toBe("2026-08-24");
  });
});

describe("built sessions survive the schema", () => {
  it("run payload parses and keeps its discriminant", () => {
    const p = RunExecutedSessionSchema.safeParse(
      buildAttestedRunSession({ workoutDate: WORKOUT_DATE, durationActualMin: 45, shinPainNrs: 2 }),
    );
    expect(p.success).toBe(true);
    if (p.success) {
      expect(p.data.type).toBe("run");
      expect(p.data.shinPainNrs).toBe(2);
      expect(p.data.durationSec).toBe(2700);
    }
  });

  // Sprint 3.2a — was "manual", which made a confirmation without any watch
  // data indistinguishable from a hand-logged session with real numbers.
  it("strength payload parses and is stamped attested", () => {
    const p = StrengthExecutedSessionSchema.safeParse(
      buildAttestedStrengthSession({
        workoutDate: WORKOUT_DATE, durationActualMin: 60,
        exercises: materialisePrescribedSets({ type: "strength_a", exercises: [ex()] } as unknown as SessionPlan),
        shinPainNrs: 3,
      }),
    );
    expect(p.success).toBe(true);
    if (p.success) {
      expect(p.data.source).toBe("attested");
      expect(p.data.durationEstimated).toBeUndefined();
    }
  });
});

describe("Sprint 3.2a — the plan is never passed off as a measurement", () => {
  it("run without a typed-in duration: plan stands in, flagged, and survives zod", () => {
    // 31.08.: the plan's 30 min were stored as measured for a 13-minute run.
    const p = RunExecutedSessionSchema.safeParse(
      buildAttestedRunSession({
        workoutDate: WORKOUT_DATE, durationActualMin: null, plannedDurationMin: 30, shinPainNrs: 0,
      }),
    );
    expect(p.success).toBe(true);
    if (p.success) {
      expect(p.data.source).toBe("attested");
      expect(p.data.durationSec).toBe(1800);
      // The flag must survive a parse — zod strips unknown keys.
      expect(p.data.durationEstimated).toBe(true);
    }
  });

  it("run with a typed-in duration is not flagged", () => {
    const run = buildAttestedRunSession({
      workoutDate: WORKOUT_DATE, durationActualMin: 13, plannedDurationMin: 30, shinPainNrs: 0,
    });
    expect(run.durationSec).toBe(780);
    expect(run).not.toHaveProperty("durationEstimated");
  });

  it("strength without a typed-in duration is flagged", () => {
    const p = StrengthExecutedSessionSchema.safeParse(
      buildAttestedStrengthSession({
        workoutDate: WORKOUT_DATE, durationActualMin: null, plannedDurationMin: 59,
        exercises: [], shinPainNrs: 0,
      }),
    );
    expect(p.success).toBe(true);
    if (p.success) {
      expect(p.data.durationActualMin).toBe(59);
      expect(p.data.durationEstimated).toBe(true);
    }
  });
});

describe("Sprint 3.2a — top sets", () => {
  const plan = {
    type: "strength_a",
    exercises: [
      ex({ name: "Warmup Goblet Squat", isWarmup: true }),
      ex({ name: "Hex Bar Deadlift", sets: 3, reps: 5, loadAbs: 87.5 }),
      ex({ name: "Incline DB Press", sets: 2, reps: 8, loadAbs: 17.5 }),
      ex({ name: "Face Pulls", sets: 2, reps: 15, loadPct: undefined, loadAbs: undefined }),
      ex({ name: "Bulgarian Split Squat", sets: 2, reps: "8/leg", loadAbs: undefined }),
    ],
  } as unknown as SessionPlan;

  it("offers a top-set field only for training-max lifts the plan contains", () => {
    expect(topSetLiftsFor(plan)).toEqual(["Hex Bar Deadlift", "Incline DB Press"]);
  });

  it("a top set becomes ONE set carrying the session RPE", () => {
    const { exercises, rejected } = buildConfirmedExercises({
      plannedSession: plan,
      topSets: [{ exercise: "Hex Bar Deadlift", weightKg: 100, reps: 5 }],
      asPrescribed: false,
      sessionRpe: 8,
    });
    expect(rejected).toEqual([]);
    expect(exercises).toHaveLength(1);
    expect(exercises[0].actualSets).toEqual([{ reps: 5, loadKg: 100, rpe: 8, durationSec: null }]);
  });

  it("as-prescribed fills in the rest but never doubles a lift with a top set", () => {
    const { exercises } = buildConfirmedExercises({
      plannedSession: plan,
      topSets: [{ exercise: "Hex Bar Deadlift", weightKg: 100, reps: 5 }],
      asPrescribed: true,
      sessionRpe: 8,
    });
    const hex = exercises.filter((e) => e.name === "Hex Bar Deadlift");
    expect(hex).toHaveLength(1);
    expect(hex[0].actualSets).toHaveLength(1);
    const incline = exercises.find((e) => e.name === "Incline DB Press")!;
    expect(incline.actualSets.every((s) => s.rpe === null)).toBe(true);
  });

  it("rejects top sets for accessories, unknown lifts and duplicates", () => {
    const { exercises, rejected } = buildConfirmedExercises({
      plannedSession: plan,
      topSets: [
        { exercise: "Face Pulls", weightKg: 25, reps: 15 },
        { exercise: "Bench Press", weightKg: 80, reps: 5 },
        { exercise: "Incline DB Press", weightKg: 20, reps: 8 },
        { exercise: "Incline DB Press", weightKg: 22, reps: 8 },
      ],
      asPrescribed: false,
      sessionRpe: 7,
    });
    expect(rejected).toEqual(["Face Pulls", "Bench Press", "Incline DB Press"]);
    expect(exercises.map((e) => e.name)).toEqual(["Incline DB Press"]);
  });

  it("nothing entered and no claim → no sets", () => {
    const { exercises } = buildConfirmedExercises({
      plannedSession: plan, topSets: [], asPrescribed: false, sessionRpe: 7,
    });
    expect(exercises).toEqual([]);
  });
});

describe("mergeShinIntoExecuted — the imported payload must survive untouched", () => {
  const garmin = {
    type: "run", source: "garmin_auto", garminActivityId: 24151655312,
    startTimeLocal: "2026-08-28 19:57:00", durationSec: 840, distanceM: 2332,
    averagePaceSecPerKm: 360, averageHr: 157, maxHr: 170, elevationGainM: 5, calories: 190,
    splits: [{ splitNumber: 1, distanceM: 1000, durationSec: 360, paceSecPerKm: 360, averageHr: 150, maxHr: 160 }],
    garminHrZones: { zone1Sec: 10, zone2Sec: 20, zone3Sec: 30, zone4Sec: 0, zone5Sec: 0 },
    polarizedTID: { z1Sec: 30, z2Sec: 30, z3Sec: 0, z1Pct: 50, z2Pct: 50, z3Pct: 0, totalSec: 60 },
  };

  it("adds the shin score and changes nothing else", () => {
    const merged = mergeShinIntoExecuted(garmin, 2)!;
    expect(merged.shinPainNrs).toBe(2);
    for (const key of Object.keys(garmin)) {
      expect(merged[key], key).toEqual((garmin as Record<string, unknown>)[key]);
    }
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(garmin);
    mergeShinIntoExecuted(garmin, 4);
    expect(JSON.stringify(garmin)).toBe(before);
  });

  it("refuses null and arrays rather than producing nonsense", () => {
    expect(mergeShinIntoExecuted(null, 2)).toBeNull();
    expect(mergeShinIntoExecuted([1, 2], 2)).toBeNull();
    expect(mergeShinIntoExecuted("nope", 2)).toBeNull();
  });

  it("carries the optional note only when given", () => {
    expect(mergeShinIntoExecuted(garmin, 2)!.shinPainNote).toBeUndefined();
    expect(mergeShinIntoExecuted(garmin, 2, "linkes Schienbein")!.shinPainNote).toBe("linkes Schienbein");
  });
});
