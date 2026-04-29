import { describe, it, expect } from "vitest";
import {
  vdotToPaces,
  paceStringToMinPerKm,
  minPerKmToPaceString,
  calibrateVDOTFromW1,
  generateLongRunProgression,
  generateWeekRunPlan,
  getHrTargetForSession,
} from "@/lib/coach-engine/run-coach";
import type { PhaseConfig } from "@/lib/coach-engine/types";

const block1Config: PhaseConfig = {
  blockNumber: 1,
  phaseName: "ACCUMULATION_AEROBIC_BASE",
  durationWeeks: 4,
  enduranceTID: { z1: 78, z2: 20, z3: 2 },
  strengthMode: "linear_progression",
  strengthRpeCap: 8,
  volumeProgression: "linear_increase",
  vdotTarget: 42,
};

const block4Config: PhaseConfig = {
  ...block1Config,
  blockNumber: 4,
  phaseName: "TRANSMUTATION_VO2MAX",
  enduranceTID: { z1: 72, z2: 13, z3: 15 },
  vdotTarget: 46,
};

describe("vdotToPaces", () => {
  it("returns Q's known paces for VDOT 42", () => {
    const paces = vdotToPaces(42);
    expect(paces.E.from).toBe("5:45");
    expect(paces.E.to).toBe("6:15");
    expect(paces.T).toBe("4:45");
    expect(paces.I).toBe("4:15");
  });

  it("rounds non-integer VDOTs", () => {
    const paces = vdotToPaces(42.4);
    expect(paces.T).toBe("4:45");
  });

  it("falls back to nearest known when exact missing", () => {
    expect(() => vdotToPaces(60)).not.toThrow();
  });

  it("throws for nonsense VDOT", () => {
    expect(() => vdotToPaces(NaN)).toThrow();
    expect(() => vdotToPaces(20)).toThrow();
    expect(() => vdotToPaces(70)).toThrow();
  });
});

describe("Pace conversions", () => {
  it("paceStringToMinPerKm parses correctly", () => {
    expect(paceStringToMinPerKm("4:45")).toBeCloseTo(4.75, 5);
    expect(paceStringToMinPerKm("5:00")).toBe(5);
  });

  it("round-trip preserves value", () => {
    expect(minPerKmToPaceString(paceStringToMinPerKm("5:30"))).toBe("5:30");
    expect(minPerKmToPaceString(paceStringToMinPerKm("4:08"))).toBe("4:08");
  });
});

describe("calibrateVDOTFromW1", () => {
  it("does NOT calibrate if pace within ±5%", () => {
    const result = calibrateVDOTFromW1(42, {
      durationMin: 30,
      distanceKm: 5,
      avgHr: 145,
      maxHr: 165,
      rpe: 6,
    });
    // expected easy pace ≈ 6:15 = 6.25; observed = 30/5 = 6.0 → ~-4%, within tolerance
    expect(result.pacesUpdated).toBe(false);
    expect(result.calibratedVdot).toBe(42);
  });

  it("does NOT calibrate if RPE = 5 (felt right)", () => {
    const result = calibrateVDOTFromW1(42, {
      durationMin: 25,
      distanceKm: 5,
      avgHr: 145,
      maxHr: 165,
      rpe: 5,
    });
    expect(result.pacesUpdated).toBe(false);
  });

  it("bumps VDOT up if observed pace much faster + low RPE", () => {
    const result = calibrateVDOTFromW1(42, {
      durationMin: 25, // 5:00/km — much faster than 6:15
      distanceKm: 5,
      avgHr: 145,
      maxHr: 165,
      rpe: 4,
    });
    expect(result.pacesUpdated).toBe(true);
    expect(result.calibratedVdot).toBeGreaterThan(42);
    expect(result.notification).toContain("VDOT");
  });

  it("drops VDOT down if observed pace much slower + high RPE", () => {
    const result = calibrateVDOTFromW1(42, {
      durationMin: 40, // 8:00/km — much slower than expected
      distanceKm: 5,
      avgHr: 165,
      maxHr: 175,
      rpe: 7,
    });
    expect(result.pacesUpdated).toBe(true);
    expect(result.calibratedVdot).toBeLessThan(42);
  });

  it("handles zero distance gracefully", () => {
    const result = calibrateVDOTFromW1(42, {
      durationMin: 0,
      distanceKm: 0,
      avgHr: 0,
      maxHr: 0,
      rpe: 0,
    });
    expect(result.pacesUpdated).toBe(false);
  });
});

describe("generateLongRunProgression", () => {
  it("Block 1 W1 starts at 50min", () => {
    expect(generateLongRunProgression(1, 1).durationMin).toBe(50);
  });

  it("Block 1 W3 reaches 70min", () => {
    expect(generateLongRunProgression(3, 1).durationMin).toBe(70);
  });

  it("Block 1 W4 is a deload (~10% lower than W3)", () => {
    const w3 = generateLongRunProgression(3, 1).durationMin;
    const w4 = generateLongRunProgression(4, 1).durationMin;
    expect(w4).toBeLessThan(w3);
  });

  it("Block 5 W18 has no long run (time trial week)", () => {
    expect(generateLongRunProgression(18, 5).durationMin).toBe(0);
  });

  it("Block 1 long runs include 'flach' note", () => {
    expect(generateLongRunProgression(1, 1).notes).toContain("FLACH");
  });
});

describe("generateWeekRunPlan", () => {
  const monday = new Date("2026-04-27"); // a Monday

  it("generates 7 sessions for the week", () => {
    const plan = generateWeekRunPlan(block1Config, 1, 42, monday);
    expect(plan.sessions).toHaveLength(7);
  });

  it("Block 1 W1 Tue is calibration run", () => {
    const plan = generateWeekRunPlan(block1Config, 1, 42, monday);
    expect(plan.sessions[1].type).toBe("calibration_run");
  });

  it("Block 1 W2+ Tue is threshold run", () => {
    const plan = generateWeekRunPlan(block1Config, 2, 42, monday);
    expect(plan.sessions[1].type).toBe("threshold_run");
  });

  it("Block 4 Tue is VO2max intervals", () => {
    const plan = generateWeekRunPlan(block4Config, 13, 46, monday);
    expect(plan.sessions[1].type).toBe("vo2max_intervals");
  });

  it("Thu is rest", () => {
    const plan = generateWeekRunPlan(block1Config, 1, 42, monday);
    expect(plan.sessions[3].type).toBe("rest");
  });

  it("Sun is rest", () => {
    const plan = generateWeekRunPlan(block1Config, 1, 42, monday);
    expect(plan.sessions[6].type).toBe("rest");
  });

  it("paces match Q's VDOT 42", () => {
    const plan = generateWeekRunPlan(block1Config, 1, 42, monday);
    expect(plan.paces.T).toBe("4:45");
  });

  it("is deterministic", () => {
    const a = generateWeekRunPlan(block1Config, 2, 42, monday);
    const b = generateWeekRunPlan(block1Config, 2, 42, monday);
    expect(a).toEqual(b);
  });

  it("weekly volume includes long run", () => {
    const plan = generateWeekRunPlan(block1Config, 1, 42, monday);
    expect(plan.weeklyVolumeMinTarget).toBeGreaterThan(150);
  });

  it("threads HR context into easy/threshold/vo2 sessions when provided (Sprint v0.7)", () => {
    const plan = generateWeekRunPlan(block1Config, 2, 42, monday, {
      hrMax: 205,
      hrRest: 53,
    });
    const easy = plan.sessions.find((s) => s.type === "easy_run")!;
    expect(easy.hrTarget).toBeDefined();
    // Karvonen Easy 60-75% HRR = 144-167 for HRmax 205, HRrest 53
    expect(easy.hrTarget!.from).toBeGreaterThanOrEqual(140);
    expect(easy.hrTarget!.to).toBeLessThanOrEqual(170);
    expect(easy.controlMethod).toBe("hr_first");
    expect(easy.paceTarget).toBeDefined(); // pace stays as orientierend
  });

  it("omits hrTarget when hr context missing (back-compat)", () => {
    const plan = generateWeekRunPlan(block1Config, 2, 42, monday);
    const easy = plan.sessions.find((s) => s.type === "easy_run")!;
    expect(easy.hrTarget).toBeUndefined();
  });
});

describe("getHrTargetForSession (Sprint v0.7)", () => {
  it("Q's Easy zone (HRmax 205, HRrest 53): 144-167 bpm", () => {
    const t = getHrTargetForSession({
      sessionType: "easy_run",
      hrMax: 205,
      hrRest: 53,
    });
    expect(t).not.toBeNull();
    expect(t!.from).toBe(144);
    expect(t!.to).toBe(167);
  });

  it("Threshold zone is tighter (78-87% HRR)", () => {
    const t = getHrTargetForSession({
      sessionType: "threshold_run",
      hrMax: 205,
      hrRest: 53,
    });
    expect(t).not.toBeNull();
    expect(t!.from).toBe(172);
    expect(t!.to).toBe(185);
  });

  it("VO2max intervals at 87-95% HRR", () => {
    const t = getHrTargetForSession({
      sessionType: "vo2max_intervals",
      hrMax: 205,
      hrRest: 53,
    });
    expect(t).not.toBeNull();
    expect(t!.from).toBe(185);
    expect(t!.to).toBe(197);
  });

  it("returns null for sessions without HR mapping (rest, time_trial)", () => {
    expect(
      getHrTargetForSession({ sessionType: "rest", hrMax: 205, hrRest: 53 }),
    ).toBeNull();
    expect(
      getHrTargetForSession({ sessionType: "time_trial_5k", hrMax: 205, hrRest: 53 }),
    ).toBeNull();
  });
});

// ============================================
// Sprint v0.11 — zone label fix
// ============================================
import { getZoneLabel } from "@/lib/coach-engine/run-coach";

describe("getZoneLabel (Sprint v0.11 polarized 3-zone model)", () => {
  it("Z1 · Easy (sub-LT1) for easy/long/recovery/calibration runs", () => {
    expect(getZoneLabel("easy_run")).toBe("Z1 · Easy (sub-LT1)");
    expect(getZoneLabel("long_run")).toBe("Z1 · Easy (sub-LT1)");
    expect(getZoneLabel("active_recovery")).toBe("Z1 · Easy (sub-LT1)");
    expect(getZoneLabel("calibration_run")).toBe("Z1 · Easy (sub-LT1)");
  });

  it("Z2 · Threshold (LT1-LT2) for threshold/tempo runs", () => {
    expect(getZoneLabel("threshold_run")).toBe("Z2 · Threshold (LT1-LT2)");
    expect(getZoneLabel("tempo_run")).toBe("Z2 · Threshold (LT1-LT2)");
  });

  it("Z3 · VO2max (supra-LT2) for VO2max + time-trial", () => {
    expect(getZoneLabel("vo2max_intervals")).toBe("Z3 · VO2max (supra-LT2)");
    expect(getZoneLabel("time_trial_5k")).toBe("Z3 · VO2max (supra-LT2)");
  });

  it("returns empty string for non-run types", () => {
    expect(getZoneLabel("rest")).toBe("");
    expect(getZoneLabel("strength_a")).toBe("");
  });
});

describe("generateWeekRunPlan attaches zoneLabel to every run session", () => {
  const monday = new Date("2026-04-27T00:00:00.000Z");
  it("easy_run gets Z1 label", () => {
    const plan = generateWeekRunPlan(block1Config, 2, 42, monday);
    const easy = plan.sessions.find((s) => s.type === "easy_run");
    expect(easy?.zoneLabel).toBe("Z1 · Easy (sub-LT1)");
  });

  it("threshold_run gets Z2 label", () => {
    const plan = generateWeekRunPlan(block1Config, 2, 42, monday);
    const threshold = plan.sessions.find((s) => s.type === "threshold_run");
    expect(threshold?.zoneLabel).toBe("Z2 · Threshold (LT1-LT2)");
  });
});
