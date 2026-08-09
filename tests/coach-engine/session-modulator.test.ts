import { describe, it, expect } from "vitest";
import { modulateSession } from "@/lib/coach-engine/session-modulator";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import type {
  LimitationsOutput,
  LoadOutput,
  ReadinessOutput,
  SessionPlan,
} from "@/lib/coach-engine/types";

const baseDate = new Date("2026-04-28");

const greenReadiness: ReadinessOutput = {
  score: 85,
  band: "GREEN",
  components: { hrv: 90, sleep: 85, battery: 90, rhrDev: 85, subjective: 90, knee: 85 },
  trend7d: "stable",
};

const optimalLoad: LoadOutput = {
  dailyLoadAu: 400,
  acute7d: 400,
  chronic28d: 400,
  acwrRolling: 1.0,
  acwrEwma: 1.0,
  band: "OPTIMAL",
  daysOfData: 28,
};

const cleanLimitations: LimitationsOutput = {
  kneeScoreToday: 2,
  kneeBaseline28d: 2,
  kneeTrend7d: "stable",
  therapyPhase: "REMODELING",
  constraints: [],
  illnessRecoveryDays: null,
};

const thresholdSession: SessionPlan = {
  date: baseDate,
  type: "threshold_run",
  durationMin: 50,
  paceTarget: { from: "4:45", to: "4:45" },
  intensityZone: 2,
  rpeTarget: 7,
};

const strengthASession: SessionPlan = {
  date: baseDate,
  type: "strength_a",
  durationMin: 50,
  exercises: [
    { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8 },
    { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8 },
    { name: "Reverse Lunge", sets: 3, reps: "10/leg", loadPct: 60, rpeCap: 7 },
  ],
};

const vo2Session: SessionPlan = {
  date: baseDate,
  type: "vo2max_intervals",
  durationMin: 50,
  intensityZone: 3,
  paceTarget: { from: "4:15", to: "4:15" },
};

describe("modulateSession — happy path", () => {
  it("passes through with no modifications when all green", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, cleanLimitations);
    expect(final.wasModified).toBe(false);
    expect(final.modifications).toEqual([]);
    expect(final.type).toBe("threshold_run");
    expect(final.durationMin).toBe(50);
  });

  it("does not mutate the input plan", () => {
    const before = JSON.stringify(thresholdSession);
    modulateSession(thresholdSession, greenReadiness, optimalLoad, cleanLimitations);
    expect(JSON.stringify(thresholdSession)).toBe(before);
  });
});

describe("modulateSession — hard constraints", () => {
  it("knee >= 8 → active recovery regardless of plan", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      kneeScoreToday: 8,
    });
    expect(final.type).toBe("active_recovery");
    expect(final.modifications.join(" ")).toContain("Knee");
  });

  it("RED + ACWR > 1.4 → rest", () => {
    const final = modulateSession(
      thresholdSession,
      { ...greenReadiness, band: "RED", score: 40 },
      { ...optimalLoad, acwrRolling: 1.5, band: "DANGER" },
      cleanLimitations,
    );
    expect(final.type).toBe("rest");
  });

  it("RED + knee 5 → active recovery (multi-risk)", () => {
    const final = modulateSession(
      thresholdSession,
      { ...greenReadiness, band: "RED", score: 40 },
      optimalLoad,
      { ...cleanLimitations, kneeScoreToday: 5 },
    );
    expect(final.type).toBe("active_recovery");
  });
});

describe("modulateSession — readiness modifications", () => {
  it("YELLOW + threshold → tempo at the athlete's M-pace", () => {
    // Sprint 2.5: this used to assert the hardcoded "5:05" — a VDOT-42 marathon
    // pace that was FASTER than threshold pace for any athlete below VDOT ~42,
    // i.e. the rule made a bad day harder. The pace now comes from the caller.
    const paces = vdotToPaces(42);
    const final = modulateSession(
      thresholdSession,
      { ...greenReadiness, band: "YELLOW", score: 70 },
      optimalLoad,
      cleanLimitations,
      paces,
    );
    expect(final.type).toBe("tempo_run");
    expect(final.paceTarget?.from).toBe(paces.M);
    expect(final.modifications.join(" ")).toContain("Marathon");
  });

  it("YELLOW + threshold without paces: type downgraded, pace untouched", () => {
    const final = modulateSession(
      thresholdSession,
      { ...greenReadiness, band: "YELLOW", score: 70 },
      optimalLoad,
      cleanLimitations,
    );
    expect(final.type).toBe("tempo_run");
    expect(final.paceTarget).toEqual(thresholdSession.paceTarget);
  });

  it("ORANGE on Z3 session drops to Z2 + 80% volume", () => {
    const final = modulateSession(
      vo2Session,
      { ...greenReadiness, band: "ORANGE", score: 55 },
      optimalLoad,
      cleanLimitations,
    );
    expect(final.intensityZone).toBe(2);
    expect(final.durationMin).toBeCloseTo(40, 0); // 80% of 50
  });
});

describe("modulateSession — knee modifications", () => {
  it("knee 5 + strength → 70% load cap", () => {
    const final = modulateSession(strengthASession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      kneeScoreToday: 5,
    });
    final.exercises?.forEach((ex) => {
      if (ex.loadPct !== undefined) {
        expect(ex.loadPct).toBeLessThanOrEqual(70);
      }
    });
  });

  it("knee 5 + run with Z3 → reduced to Z2", () => {
    const final = modulateSession(vo2Session, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      kneeScoreToday: 5,
    });
    expect(final.intensityZone).toBeLessThanOrEqual(2);
  });

  it("knee 7 → vo2max → easy", () => {
    const final = modulateSession(vo2Session, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      kneeScoreToday: 7,
    });
    expect(final.type).toBe("easy_run");
    expect(final.intensityZone).toBe(1);
  });
});

describe("modulateSession — load modifications", () => {
  it("ACWR 1.4 → volume 90%", () => {
    const final = modulateSession(
      thresholdSession,
      greenReadiness,
      { ...optimalLoad, acwrRolling: 1.4, band: "HIGH" },
      cleanLimitations,
    );
    expect(final.durationMin).toBe(45); // 50 × 0.9
  });
});

describe("modulateSession — therapy phase", () => {
  it("REACTIVE + run with intensity → easy only", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      therapyPhase: "REACTIVE",
    });
    expect(final.type).toBe("easy_run");
    expect(final.intensityZone).toBe(1);
    expect(final.modifications.join(" ")).toContain("REACTIVE");
  });

  it("REACTIVE + strength → wall sit prepended", () => {
    const final = modulateSession(strengthASession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      therapyPhase: "REACTIVE",
    });
    expect(final.exercises?.[0].name).toBe("Wall Sit");
  });

  it("DISREPAIR + strength → wall sit prepended", () => {
    const final = modulateSession(strengthASession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      therapyPhase: "DISREPAIR",
    });
    expect(final.exercises?.[0].name).toBe("Wall Sit");
  });

  it("DISREPAIR does not duplicate existing wall sit", () => {
    const sessionWithWallSit: SessionPlan = {
      ...strengthASession,
      exercises: [
        { name: "Wall Sit", sets: 5, reps: "45sec" },
        ...strengthASession.exercises!,
      ],
    };
    const final = modulateSession(sessionWithWallSit, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      therapyPhase: "DISREPAIR",
    });
    const wallSitCount = (final.exercises ?? []).filter((e) => e.name === "Wall Sit").length;
    expect(wallSitCount).toBe(1);
  });
});

describe("modulateSession — illness recovery", () => {
  it("day 2: threshold → easy + 70% duration", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 2,
    });
    expect(final.type).toBe("easy_run");
    expect(final.intensityZone).toBe(1);
    expect(final.paceTarget).toBeUndefined();
    expect(final.structure).toBeUndefined();
    expect(final.durationMin).toBe(35); // 50 × 0.7
    expect(final.wasModified).toBe(true);
    expect(final.modifications.some((m) => m.includes("Illness Recovery"))).toBe(true);
  });

  it("day 1: vo2max → easy + 70% duration", () => {
    const final = modulateSession(vo2Session, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 1,
    });
    expect(final.type).toBe("easy_run");
    expect(final.durationMin).toBe(35); // 50 × 0.7
  });

  it("day 3: strength → 80% load cap + sets -1", () => {
    const final = modulateSession(strengthASession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 3,
    });
    // Load capped at 80%
    final.exercises?.forEach((ex) => {
      if (ex.loadPct !== undefined) {
        expect(ex.loadPct).toBeLessThanOrEqual(80);
      }
    });
    // Sets reduced by 1 (min 2)
    expect(final.exercises?.[0].sets).toBe(3); // 4 - 1 = 3
    expect(final.exercises?.[1].sets).toBe(2); // 3 - 1 = 2
    expect(final.exercises?.[2].sets).toBe(2); // 3 - 1 = 2
    expect(final.modifications.some((m) => m.includes("Kraft"))).toBe(true);
  });

  it("day 5: run duration 80% (quality allowed)", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 5,
    });
    expect(final.type).toBe("threshold_run"); // quality stays
    expect(final.durationMin).toBe(40); // 50 × 0.8
  });

  it("day 5: strength → 90% load cap", () => {
    const final = modulateSession(strengthASession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 5,
    });
    final.exercises?.forEach((ex) => {
      if (ex.loadPct !== undefined) {
        expect(ex.loadPct).toBeLessThanOrEqual(90);
      }
    });
  });

  it("day 7: no modulation (taper phase)", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 7,
    });
    expect(final.type).toBe("threshold_run");
    expect(final.durationMin).toBe(50);
    expect(final.wasModified).toBe(false);
  });

  it("null: no modulation", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: null,
    });
    expect(final.type).toBe("threshold_run");
    expect(final.durationMin).toBe(50);
    expect(final.wasModified).toBe(false);
  });

  it("illness recovery fires before readiness (additive)", () => {
    // Day 2 illness + ORANGE readiness: both should fire
    const final = modulateSession(thresholdSession, {
      ...greenReadiness,
      band: "ORANGE",
      score: 55,
    }, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 2,
    });
    // Illness: threshold → easy + 70% (35min)
    // ORANGE: Z3→Z2 (already Z1 from illness), 80% of 35 = 28
    expect(final.type).toBe("easy_run");
    expect(final.durationMin).toBe(28); // 50 × 0.7 = 35 → 35 × 0.8 = 28
    expect(final.modifications.length).toBeGreaterThanOrEqual(2);
  });

  it("easy_run at day 2 stays easy but gets 70% duration", () => {
    const easySession: SessionPlan = {
      date: baseDate,
      type: "easy_run",
      durationMin: 40,
      intensityZone: 1,
    };
    const final = modulateSession(easySession, greenReadiness, optimalLoad, {
      ...cleanLimitations,
      illnessRecoveryDays: 2,
    });
    expect(final.type).toBe("easy_run");
    expect(final.durationMin).toBe(28); // 40 × 0.7
  });
});

describe("modulateSession — combined modifications", () => {
  it("YELLOW + ACWR 1.4 + knee 6 cumulatively modulates", () => {
    const final = modulateSession(
      thresholdSession,
      { ...greenReadiness, band: "YELLOW", score: 70 },
      { ...optimalLoad, acwrRolling: 1.4, band: "HIGH" },
      { ...cleanLimitations, kneeScoreToday: 6 },
    );
    expect(final.modifications.length).toBeGreaterThanOrEqual(2);
    expect(final.wasModified).toBe(true);
  });
});

describe("modulateSession — confidence + explanation", () => {
  it("returns 100% confidence for green/optimal/clean", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, cleanLimitations);
    expect(final.confidence).toBeGreaterThanOrEqual(70);
    expect(final.confidence).toBeLessThanOrEqual(100);
  });

  it("explanation is non-empty", () => {
    const final = modulateSession(thresholdSession, greenReadiness, optimalLoad, cleanLimitations);
    expect(final.explanation.length).toBeGreaterThan(0);
  });
});

describe("modulateSession — determinism", () => {
  it("is deterministic across 10 runs", () => {
    const first = modulateSession(thresholdSession, greenReadiness, optimalLoad, cleanLimitations);
    for (let i = 0; i < 10; i++) {
      expect(modulateSession(thresholdSession, greenReadiness, optimalLoad, cleanLimitations)).toEqual(first);
    }
  });

  it("is deterministic with modifications applied", () => {
    const inputs = {
      session: thresholdSession,
      readiness: { ...greenReadiness, band: "YELLOW" as const, score: 70 },
      load: optimalLoad,
      limit: { ...cleanLimitations, kneeScoreToday: 5 },
    };
    const first = modulateSession(inputs.session, inputs.readiness, inputs.load, inputs.limit);
    for (let i = 0; i < 10; i++) {
      expect(modulateSession(inputs.session, inputs.readiness, inputs.load, inputs.limit)).toEqual(first);
    }
  });
});
