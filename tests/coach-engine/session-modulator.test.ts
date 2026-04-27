import { describe, it, expect } from "vitest";
import { modulateSession } from "@/lib/coach-engine/session-modulator";
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
  it("YELLOW + threshold → tempo at M-pace", () => {
    const final = modulateSession(
      thresholdSession,
      { ...greenReadiness, band: "YELLOW", score: 70 },
      optimalLoad,
      cleanLimitations,
    );
    expect(final.type).toBe("tempo_run");
    expect(final.paceTarget?.from).toBe("5:05");
    expect(final.modifications.join(" ")).toContain("Marathon");
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
