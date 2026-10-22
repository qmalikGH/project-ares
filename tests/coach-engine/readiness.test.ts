import { describe, it, expect } from "vitest";
import {
  computeReadiness,
  computeBaselines,
  scoreFromDeviation,
  scoreFromAbsolute,
} from "@/lib/coach-engine/readiness";
import type { DailySensorInputs, SensorBaselines } from "@/lib/coach-engine/types";

const baselines: SensorBaselines = {
  hrv28dAvg: 50,
  hrv28dSd: 8,
  sleep28dAvg: 80,
  sleep28dSd: 5,
  rhr28dAvg: 52,
  rhr28dSd: 3,
};

const baseInputs: DailySensorInputs = {
  date: new Date("2026-04-26"),
  garmin: {
    hrvStatus: "BALANCED",
    hrvRmssd: 50,
    sleepScore: 80,
    sleepDurationMin: 7 * 60,
    bodyBatteryMorning: 80,
    rhr: 52,
  },
  userMorning: {
    subjectiveRecovery: 8,
    morningStiffness: 3,
    stairsScore: 3,
  },
};

describe("scoreFromDeviation", () => {
  it("at baseline returns 80", () => {
    expect(scoreFromDeviation(50, 50, 8)).toBe(80);
  });

  it("+1 SD returns 95", () => {
    expect(scoreFromDeviation(58, 50, 8)).toBe(95);
  });

  it("-1 SD returns 60", () => {
    expect(scoreFromDeviation(42, 50, 8)).toBe(60);
  });

  it("inverted (+1 SD = worse for RHR) returns 60", () => {
    expect(scoreFromDeviation(60, 52, 8, true)).toBe(60);
  });

  it("clamps to [0, 100]", () => {
    expect(scoreFromDeviation(100, 50, 1)).toBe(100);
    expect(scoreFromDeviation(0, 50, 1)).toBe(0);
  });

  it("zero SD returns neutral 80", () => {
    expect(scoreFromDeviation(50, 50, 0)).toBe(80);
  });
});

describe("scoreFromAbsolute", () => {
  it("at baseline returns 80", () => {
    expect(scoreFromAbsolute(80, 80)).toBe(80);
  });

  it("above baseline returns >80", () => {
    expect(scoreFromAbsolute(90, 80)).toBeGreaterThan(80);
  });

  it("below baseline returns <80", () => {
    expect(scoreFromAbsolute(70, 80)).toBeLessThan(80);
  });

  it("zero value returns 0", () => {
    expect(scoreFromAbsolute(0, 80)).toBe(0);
  });
});

describe("computeReadiness", () => {
  it("returns GREEN band for high recovery", () => {
    const result = computeReadiness(baseInputs, baselines);
    expect(result.band).toBe("GREEN");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("returns RED band for low recovery", () => {
    const lowInputs: DailySensorInputs = {
      ...baseInputs,
      garmin: {
        ...baseInputs.garmin!,
        hrvRmssd: 30, // -2.5 SD
        sleepScore: 50, // way below
        bodyBatteryMorning: 30,
        rhr: 60, // +2.7 SD (worse)
      },
      userMorning: {
        subjectiveRecovery: 3,
        morningStiffness: 7,
        stairsScore: 7,
      },
    };
    const result = computeReadiness(lowInputs, baselines);
    expect(result.band).toBe("RED");
  });

  it("handles missing Garmin data gracefully", () => {
    const noGarmin: DailySensorInputs = {
      date: baseInputs.date,
      userMorning: baseInputs.userMorning,
    };
    const result = computeReadiness(noGarmin, baselines);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.components.hrv).toBe(80); // neutral fallback
  });

  it("returns score in [0, 100]", () => {
    const result = computeReadiness(baseInputs, baselines);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("is deterministic across 10 runs", () => {
    const first = computeReadiness(baseInputs, baselines);
    for (let i = 0; i < 10; i++) {
      expect(computeReadiness(baseInputs, baselines)).toEqual(first);
    }
  });

  it("ORANGE band for moderate decline", () => {
    const orangeInputs: DailySensorInputs = {
      ...baseInputs,
      garmin: {
        ...baseInputs.garmin!,
        hrvRmssd: 38, // -1.5 SD
        sleepScore: 65,
        bodyBatteryMorning: 50,
        rhr: 56,
      },
      userMorning: {
        subjectiveRecovery: 5,
        morningStiffness: 5,
        stairsScore: 5,
      },
    };
    const result = computeReadiness(orangeInputs, baselines);
    expect(["ORANGE", "RED"]).toContain(result.band);
  });
});

describe("computeBaselines", () => {
  it("returns sensible defaults for empty history", () => {
    const b = computeBaselines([]);
    expect(b.hrv28dAvg).toBeGreaterThan(0);
    expect(b.hrv28dSd).toBeGreaterThan(0);
  });

  it("computes from history when present", () => {
    const history: DailySensorInputs[] = Array.from({ length: 28 }, (_, i) => ({
      date: new Date(Date.now() - i * 86400000),
      garmin: {
        hrvStatus: "BALANCED",
        hrvRmssd: 45 + (i % 5),
        sleepScore: 75 + (i % 5),
        sleepDurationMin: 420,
        bodyBatteryMorning: 70,
        rhr: 50 + (i % 3),
      },
      userMorning: { subjectiveRecovery: 7, morningStiffness: 3, stairsScore: 3 },
    }));
    const b = computeBaselines(history);
    expect(b.hrv28dAvg).toBeCloseTo(47, 0);
    expect(b.hrv28dSd).toBeGreaterThan(0);
  });
});

// Sprint 3.3 (C1): a morning with RHR and Body Battery only, HRV and sleep not
// synced yet. Missing keys arrive as undefined, cleared fields as null — both
// used to be scored (NaN → band RED, score serialized as null; null → 0).
describe("computeReadiness — partial Garmin data (Sprint 3.3)", () => {
  const partialUndefined = {
    ...baseInputs,
    garmin: { rhr: 52, bodyBatteryMorning: 80 } as unknown as DailySensorInputs["garmin"],
  };
  const partialNull = {
    ...baseInputs,
    garmin: { ...baseInputs.garmin!, hrvRmssd: null, sleepScore: null } as unknown as DailySensorInputs["garmin"],
  };

  it.each([
    ["missing keys", partialUndefined],
    ["null values", partialNull],
  ])("%s: finite score, missing components null, not RED", (_label, inputs) => {
    const r = computeReadiness(inputs, baselines);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.components.hrv).toBeNull();
    expect(r.components.sleep).toBeNull();
    expect(r.components.battery).toBe(80);
    expect(r.band).not.toBe("RED");
  });

  it("renormalizes over the present components", () => {
    // RHR at baseline (80), BB 80, subjective 80, knee from the fixture.
    const full = computeReadiness(baseInputs, baselines);
    const partial = computeReadiness(partialUndefined, baselines);
    expect(Math.abs(partial.score - full.score)).toBeLessThanOrEqual(5);
  });

  it("no Garmin component at all → the neutral fallback, as before", () => {
    const none = computeReadiness({ ...baseInputs, garmin: {} as unknown as DailySensorInputs["garmin"] }, baselines);
    const absent = computeReadiness({ ...baseInputs, garmin: undefined }, baselines);
    expect(none).toEqual(absent);
    expect(absent.components.hrv).toBe(80);
  });
});

describe("computeBaselines — only values that arrived (Sprint 3.3)", () => {
  const day = (i: number, garmin: Record<string, unknown>): DailySensorInputs => ({
    date: new Date(Date.now() - i * 86400000),
    garmin: garmin as unknown as DailySensorInputs["garmin"],
    userMorning: { subjectiveRecovery: 7, morningStiffness: 3, stairsScore: 3 },
  });

  it("fewer than 7 real values → default, never NaN", () => {
    const history = Array.from({ length: 10 }, (_, i) => day(i, i < 4 ? { hrvRmssd: 60, rhr: 50 } : { rhr: 50 }));
    const b = computeBaselines(history);
    expect(b.hrv28dAvg).toBe(50); // default — only 4 HRV values
    expect(b.rhr28dAvg).toBe(50); // 10 real values
    expect(Object.values(b).every(Number.isFinite)).toBe(true);
  });

  it("null and missing fields do not pull the average down", () => {
    const history = Array.from({ length: 10 }, (_, i) => day(i, i % 2 ? { hrvRmssd: 60 } : { hrvRmssd: null }));
    expect(computeBaselines(history).hrv28dAvg).toBe(50); // 5 values only → default
    const enough = Array.from({ length: 16 }, (_, i) => day(i, i % 2 ? { hrvRmssd: 60 } : { hrvRmssd: null }));
    expect(computeBaselines(enough).hrv28dAvg).toBe(60);
  });
});
