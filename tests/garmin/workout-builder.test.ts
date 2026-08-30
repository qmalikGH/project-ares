import { describe, it, expect } from "vitest";
import {
  buildGarminWorkout,
  isPushableSessionType,
  paceStringToMeterPerSec,
  type GarminStructuredWorkout,
  type ExecutableStep,
  type RepeatGroupStep,
  type VdotPaceLookup,
} from "@/lib/garmin/workout-builder";
import type { SessionPlan } from "@/lib/coach-engine/types";

const PACES: VdotPaceLookup = {
  E: { from: "5:58", to: "6:31" },
  M: "5:16",
  T: "5:00",
  I: "4:30",
  R: "4:08",
};

function s(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    date: new Date("2026-04-28"),
    type: "easy_run",
    durationMin: 45,
    hrTarget: { from: 144, to: 167 },
    paceTarget: { from: "5:58", to: "6:31" },
    intensityZone: 1,
    rpeTarget: 4,
    controlMethod: "hr_first",
    ...overrides,
  };
}

function steps(w: GarminStructuredWorkout) {
  return w.workoutSegments[0].workoutSteps;
}

describe("paceStringToMeterPerSec", () => {
  it("converts mm:ss/km to m/s", () => {
    // 5:00/km = 300 sec/km → 1000/300 ≈ 3.33 m/s
    expect(paceStringToMeterPerSec("5:00")).toBeCloseTo(3.333, 2);
    expect(paceStringToMeterPerSec("4:00")).toBeCloseTo(4.167, 2);
  });
  it("returns 0 for invalid input", () => {
    expect(paceStringToMeterPerSec("garbage")).toBe(0);
    expect(paceStringToMeterPerSec("5")).toBe(0);
  });
});

describe("isPushableSessionType", () => {
  it("includes runs as pushable", () => {
    expect(isPushableSessionType("easy_run")).toBe(true);
    expect(isPushableSessionType("threshold_run")).toBe(true);
    expect(isPushableSessionType("long_run")).toBe(true);
    expect(isPushableSessionType("vo2max_intervals")).toBe(true);
    expect(isPushableSessionType("calibration_run")).toBe(true);
    expect(isPushableSessionType("tempo_run")).toBe(true);
  });
  // Sprint 3.1: strength became pushable. Not as a guided set-by-set workout —
  // as a plain timed block, purely so the resulting activity carries our
  // workoutId and the session can complete itself.
  it("accepts strength sessions", () => {
    expect(isPushableSessionType("strength_a")).toBe(true);
    expect(isPushableSessionType("strength_b")).toBe(true);
    expect(isPushableSessionType("strength_c")).toBe(true);
  });

  it("rejects non-trainable sessions", () => {
    expect(isPushableSessionType("rest")).toBe(false);
    expect(isPushableSessionType("active_recovery")).toBe(false);
    expect(isPushableSessionType("time_trial_5k")).toBe(false);
    expect(isPushableSessionType("cross_training")).toBe(false);
    expect(isPushableSessionType("mobility")).toBe(false);
  });
});

describe("buildGarminWorkout — pushability gate", () => {
  it("rest returns null", () => {
    expect(buildGarminWorkout(s({ type: "rest" }), PACES)).toBeNull();
  });
  it("time_trial_5k returns null (user runs free)", () => {
    expect(buildGarminWorkout(s({ type: "time_trial_5k" }), PACES)).toBeNull();
  });
  it("active_recovery returns null", () => {
    expect(buildGarminWorkout(s({ type: "active_recovery" }), PACES)).toBeNull();
  });
  it("session without hrTarget returns null", () => {
    const noHr = s({ hrTarget: undefined });
    expect(buildGarminWorkout(noHr, PACES)).toBeNull();
  });
});

describe("buildGarminWorkout — easy run", () => {
  const w = buildGarminWorkout(s({ type: "easy_run", durationMin: 45 }), PACES)!;

  it("produces a sportType=running workout", () => {
    expect(w.sportType.sportTypeKey).toBe("running");
  });
  it("has WU + steady + CD pattern", () => {
    const ss = steps(w) as ExecutableStep[];
    expect(ss).toHaveLength(3);
    expect(ss[0].stepType.stepTypeKey).toBe("warmup");
    expect(ss[1].stepType.stepTypeKey).toBe("interval");
    expect(ss[2].stepType.stepTypeKey).toBe("cooldown");
  });
  it("HR-targets the steady block at the session's hrTarget range", () => {
    const ss = steps(w) as ExecutableStep[];
    expect(ss[1].targetType.workoutTargetTypeKey).toBe("heart.rate.zone");
    expect(ss[1].targetValueOne).toBe(144);
    expect(ss[1].targetValueTwo).toBe(167);
  });
  it("WU + CD have no targets", () => {
    const ss = steps(w) as ExecutableStep[];
    expect(ss[0].targetType.workoutTargetTypeKey).toBe("no.target");
    expect(ss[2].targetType.workoutTargetTypeKey).toBe("no.target");
  });
  it("estimated duration ~ session.durationMin × 60", () => {
    expect(w.estimatedDurationInSecs).toBeGreaterThanOrEqual(45 * 60 - 10);
    expect(w.estimatedDurationInSecs).toBeLessThanOrEqual(45 * 60 + 10);
  });
});

describe("buildGarminWorkout — threshold run (Sprint 2.2: structured intervals)", () => {
  // The watch must get the SAME segments as the app tile — built from
  // session.structure (warmup + repeat(work + jog recovery) + cooldown),
  // NOT a single continuous block.
  const w = buildGarminWorkout(
    s({
      type: "threshold_run",
      durationMin: 44,
      hrTarget: { from: 172, to: 185 },
      structure: {
        warmupMin: 12,
        workIntervals: [
          { repeats: 2, durationMin: 10, paceTarget: { from: "5:00", to: "5:00" }, restMin: 2 },
        ],
        cooldownMin: 8,
      },
    }),
    PACES,
  )!;

  it("has WU + RepeatGroup(2x) + CD (not one continuous block)", () => {
    const ss = steps(w);
    expect(ss).toHaveLength(3);
    expect(ss[0].stepType.stepTypeKey).toBe("warmup");
    expect(ss[1].stepType.stepTypeKey).toBe("repeat");
    expect(ss[2].stepType.stepTypeKey).toBe("cooldown");
    expect((ss[0] as ExecutableStep).endConditionValue).toBe(12 * 60);
    expect((ss[2] as ExecutableStep).endConditionValue).toBe(8 * 60);
  });

  it("inner repeat group is 2 iterations of work@HR + jog recovery", () => {
    const ss = steps(w);
    const rg = ss[1] as RepeatGroupStep;
    expect(rg.numberOfIterations).toBe(2);
    expect(rg.workoutSteps).toHaveLength(2);
    expect(rg.workoutSteps[0].stepType.stepTypeKey).toBe("interval");
    expect(rg.workoutSteps[0].endConditionValue).toBe(10 * 60);
    expect(rg.workoutSteps[0].targetValueOne).toBe(172);
    expect(rg.workoutSteps[0].targetValueTwo).toBe(185);
    expect(rg.workoutSteps[1].stepType.stepTypeKey).toBe("recovery");
    expect(rg.workoutSteps[1].endConditionValue).toBe(2 * 60);
    expect(rg.workoutSteps[1].targetType.workoutTargetTypeKey).toBe("no.target");
  });

  it("estimated duration == sum of structure (12 + 2×(10+2) + 8 = 44min)", () => {
    expect(w.estimatedDurationInSecs).toBe(44 * 60);
  });

  it("description references the threshold pace", () => {
    expect(w.description).toMatch(/5:00/);
    expect(w.description).toMatch(/[Tt]hreshold/);
  });
});

describe("buildGarminWorkout — long run", () => {
  const w = buildGarminWorkout(
    s({ type: "long_run", durationMin: 90 }),
    PACES,
  )!;

  it("is a single steady step at HR target (no WU/CD)", () => {
    const ss = steps(w) as ExecutableStep[];
    expect(ss).toHaveLength(1);
    expect(ss[0].stepType.stepTypeKey).toBe("interval");
    expect(ss[0].endConditionValue).toBe(90 * 60);
    expect(ss[0].targetValueOne).toBe(144);
    expect(ss[0].targetValueTwo).toBe(167);
  });
});

describe("buildGarminWorkout — VO2max intervals", () => {
  const w = buildGarminWorkout(
    s({ type: "vo2max_intervals", hrTarget: { from: 185, to: 197 } }),
    PACES,
  )!;

  it("has WU + RepeatGroup(5x) + CD", () => {
    const ss = steps(w);
    expect(ss).toHaveLength(3);
    expect(ss[0].stepType.stepTypeKey).toBe("warmup");
    expect(ss[1].stepType.stepTypeKey).toBe("repeat");
    expect(ss[2].stepType.stepTypeKey).toBe("cooldown");
  });

  it("inner repeat group is 5 iterations of work + recovery", () => {
    const ss = steps(w);
    const rg = ss[1] as RepeatGroupStep;
    expect(rg.numberOfIterations).toBe(5);
    expect(rg.workoutSteps).toHaveLength(2);
    expect(rg.workoutSteps[0].stepType.stepTypeKey).toBe("interval");
    expect(rg.workoutSteps[0].targetValueOne).toBe(185);
    expect(rg.workoutSteps[0].targetValueTwo).toBe(197);
    expect(rg.workoutSteps[1].stepType.stepTypeKey).toBe("recovery");
    expect(rg.workoutSteps[1].targetType.workoutTargetTypeKey).toBe("no.target");
  });
});

describe("buildGarminWorkout — calibration run", () => {
  const w = buildGarminWorkout(
    s({ type: "calibration_run", durationMin: 30 }),
    PACES,
  )!;

  it("is a single HR-targeted block (no WU/CD interferes with calibration)", () => {
    const ss = steps(w) as ExecutableStep[];
    expect(ss).toHaveLength(1);
    expect(ss[0].endConditionValue).toBe(30 * 60);
    expect(ss[0].targetValueOne).toBe(144);
  });
  it("description marks it as calibration", () => {
    expect(w.workoutName).toMatch(/Calibration/);
  });
});

describe("buildGarminWorkout — tempo run", () => {
  const w = buildGarminWorkout(
    s({ type: "tempo_run", durationMin: 40 }),
    PACES,
  )!;

  it("description references M-pace", () => {
    expect(w.description).toMatch(/Marathon pace/);
    expect(w.description).toMatch(/5:16/);
  });
});

describe("buildGarminWorkout — purity (no input mutation)", () => {
  it("does not mutate the SessionPlan input", () => {
    const session = s({ type: "easy_run", durationMin: 45 });
    const before = JSON.stringify(session);
    buildGarminWorkout(session, PACES);
    expect(JSON.stringify(session)).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 3.1 — strength pushed as a plain timed workout
// ═══════════════════════════════════════════════════════════════════════════

describe("buildGarminWorkout — strength", () => {
  const strengthSession = (over: Record<string, unknown> = {}) =>
    s({
      type: "strength_a",
      durationMin: 60,
      hrTarget: undefined,
      exercises: [
        { name: "Warmup Goblet Squat", sets: 2, reps: 10, loadAbs: 20, isWarmup: true },
        { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, loadAbs: 117.5 },
        { name: "Face Pulls", sets: 3, reps: 15 },
      ],
      ...over,
    });

  it("produces a strength_training workout", () => {
    const w = buildGarminWorkout(strengthSession(), PACES)!;
    expect(w).not.toBeNull();
    expect(w.sportType.sportTypeKey).toBe("strength_training");
    expect(w.sportType.sportTypeId).toBe(5);
  });

  // Strength sessions carry no hrTarget; the guard for runs used to drop them
  // before the dispatch ever ran.
  it("does not require an HR target", () => {
    expect(buildGarminWorkout(strengthSession({ hrTarget: undefined }), PACES)).not.toBeNull();
  });

  it("is one open timed block, not a step per set", () => {
    const w = buildGarminWorkout(strengthSession(), PACES)!;
    const steps = w.workoutSegments[0].workoutSteps;
    expect(steps).toHaveLength(1);
    expect(w.estimatedDurationInSecs).toBe(3600);
  });

  it("puts the work sets in the description so the watch can show them", () => {
    const w = buildGarminWorkout(strengthSession(), PACES)!;
    expect(w.description).toContain("Hex Bar Deadlift 4x5 @ 117.5kg");
    expect(w.description).toContain("Face Pulls 3x15");
  });

  it("leaves warmups out of the description", () => {
    const w = buildGarminWorkout(strengthSession(), PACES)!;
    expect(w.description).not.toContain("Warmup Goblet Squat");
  });

  it("survives a session with no exercises", () => {
    const w = buildGarminWorkout(strengthSession({ exercises: [] }), PACES)!;
    expect(w).not.toBeNull();
    expect(w.description).toBe("Krafteinheit");
  });

  it("names the session by slot", () => {
    expect(buildGarminWorkout(strengthSession({ type: "strength_c" }), PACES)!.workoutName).toBe("Kraft C");
  });

  it("floors an implausibly short duration at 10 minutes", () => {
    const w = buildGarminWorkout(strengthSession({ durationMin: 2 }), PACES)!;
    expect(w.estimatedDurationInSecs).toBe(600);
  });
});
