import { describe, it, expect } from "vitest";
import {
  ExecutedSessionSchema,
  RunExecutedSessionSchema,
  StrengthExecutedSessionSchema,
} from "@/lib/coach-engine/types";

describe("RunExecutedSessionSchema", () => {
  it("validates a complete Garmin import", () => {
    const data = {
      type: "run",
      source: "garmin_import",
      garminActivityId: 12345,
      startTimeLocal: "2026-04-27T07:00:00",
      durationSec: 2100,
      distanceM: 6200,
      averagePaceSecPerKm: 339,
      averageHr: 142,
      maxHr: 165,
      elevationGainM: 25,
      calories: 380,
      splits: [
        { splitNumber: 1, distanceM: 1000, durationSec: 339, paceSecPerKm: 339, averageHr: 138, maxHr: 145 },
        { splitNumber: 2, distanceM: 1000, durationSec: 340, paceSecPerKm: 340, averageHr: 142, maxHr: 148 },
      ],
    };
    expect(() => RunExecutedSessionSchema.parse(data)).not.toThrow();
  });

  it("allows missing distance for indoor runs", () => {
    const data = {
      type: "run",
      source: "garmin_import",
      garminActivityId: 1,
      startTimeLocal: "2026-04-27T07:00:00",
      durationSec: 2100,
      distanceM: null,
      averagePaceSecPerKm: null,
      averageHr: 142,
      maxHr: 165,
      elevationGainM: null,
      calories: null,
      splits: [],
    };
    expect(() => RunExecutedSessionSchema.parse(data)).not.toThrow();
  });

  it("rejects missing required fields", () => {
    const data = { type: "run", source: "garmin_import" };
    expect(() => RunExecutedSessionSchema.parse(data)).toThrow();
  });

  it("rejects invalid source", () => {
    const data = {
      type: "run",
      source: "imaginary_source",
      garminActivityId: null,
      startTimeLocal: "x",
      durationSec: 1,
      distanceM: null,
      averagePaceSecPerKm: null,
      averageHr: null,
      maxHr: null,
      elevationGainM: null,
      calories: null,
    };
    expect(() => RunExecutedSessionSchema.parse(data)).toThrow();
  });
});

describe("StrengthExecutedSessionSchema", () => {
  it("validates a strength session with multiple sets per exercise", () => {
    const data = {
      type: "strength",
      source: "manual",
      garminActivityId: null,
      startTimeLocal: "2026-04-27T18:00:00",
      durationActualMin: 50,
      averageHr: null,
      maxHr: null,
      calories: null,
      exercises: [
        {
          name: "Hex Bar Deadlift",
          plannedSets: 4,
          plannedReps: 5,
          plannedLoadPct: 82,
          actualSets: [
            { reps: 5, loadKg: 100, rpe: 7, durationSec: null },
            { reps: 5, loadKg: 100, rpe: 7, durationSec: null },
            { reps: 5, loadKg: 100, rpe: 8, durationSec: null },
            { reps: 5, loadKg: 100, rpe: 8, durationSec: null },
          ],
          skipped: false,
        },
        {
          name: "Wall Sit",
          plannedSets: 5,
          plannedReps: "45sec",
          plannedLoadPct: null,
          actualSets: [
            { reps: 1, loadKg: null, rpe: 5, durationSec: 45 },
            { reps: 1, loadKg: null, rpe: 6, durationSec: 45 },
            { reps: 1, loadKg: null, rpe: 6, durationSec: 45 },
            { reps: 1, loadKg: null, rpe: 7, durationSec: 45 },
            { reps: 1, loadKg: null, rpe: 7, durationSec: 45 },
          ],
          skipped: false,
        },
      ],
    };
    expect(() => StrengthExecutedSessionSchema.parse(data)).not.toThrow();
  });

  it("allows skipped exercises", () => {
    const data = {
      type: "strength",
      source: "manual",
      garminActivityId: null,
      startTimeLocal: "2026-04-27T18:00:00",
      durationActualMin: 35,
      averageHr: null,
      maxHr: null,
      calories: null,
      exercises: [
        {
          name: "Broad Jumps",
          plannedSets: 3,
          plannedReps: 5,
          plannedLoadPct: null,
          actualSets: [],
          skipped: true,
          exerciseNotes: "Knee was bothering me — skipped plyo",
        },
      ],
    };
    expect(() => StrengthExecutedSessionSchema.parse(data)).not.toThrow();
  });

  it("rejects rpe out of 1-10 range", () => {
    const bad = {
      type: "strength",
      source: "manual",
      garminActivityId: null,
      startTimeLocal: "x",
      durationActualMin: 30,
      averageHr: null,
      maxHr: null,
      calories: null,
      exercises: [
        {
          name: "x",
          plannedSets: 1,
          plannedReps: 1,
          plannedLoadPct: null,
          actualSets: [{ reps: 1, loadKg: null, rpe: 12, durationSec: null }],
          skipped: false,
        },
      ],
    };
    expect(() => StrengthExecutedSessionSchema.parse(bad)).toThrow();
  });
});

describe("ExecutedSessionSchema (discriminated union)", () => {
  it("dispatches to run schema on type=run", () => {
    const run = {
      type: "run",
      source: "manual",
      garminActivityId: null,
      startTimeLocal: "x",
      durationSec: 1800,
      distanceM: null,
      averagePaceSecPerKm: null,
      averageHr: null,
      maxHr: null,
      elevationGainM: null,
      calories: null,
      splits: [],
    };
    const parsed = ExecutedSessionSchema.parse(run);
    expect(parsed.type).toBe("run");
  });

  it("dispatches to strength schema on type=strength", () => {
    const s = {
      type: "strength",
      source: "manual",
      garminActivityId: null,
      startTimeLocal: "x",
      durationActualMin: 30,
      averageHr: null,
      maxHr: null,
      calories: null,
      exercises: [],
    };
    const parsed = ExecutedSessionSchema.parse(s);
    expect(parsed.type).toBe("strength");
  });

  it("rejects unknown type", () => {
    expect(() =>
      ExecutedSessionSchema.parse({ type: "yoga", source: "manual" }),
    ).toThrow();
  });
});
