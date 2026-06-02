// Sprint 2.2 — threshold interval structure: capped threshold time, ladder
// progression, shin/RHR gate, and watch⇔app segment parity. Pure, no DB.
import { describe, it, expect } from "vitest";

import {
  thresholdStructureFor,
  thresholdDurationMin,
  generateWeekRunPlan,
  vdotToPaces,
} from "@/lib/coach-engine/run-coach";
import { buildGarminWorkout } from "@/lib/garmin/workout-builder";
import type { PhaseConfig, SessionPlan } from "@/lib/coach-engine/types";
import type { RepeatGroupStep } from "@/lib/garmin/workout-builder";

const cfg = (blockNumber: 1 | 2 | 3 | 4): PhaseConfig => ({
  blockNumber,
  phaseName: "ACCUMULATION_AEROBIC_BASE",
  durationWeeks: 4,
  enduranceTID: { z1: 78, z2: 20, z3: 2 },
  strengthMode: "linear_progression",
  strengthRpeCap: 8,
  volumeProgression: "linear_increase",
  vdotTarget: 42,
});
const monday = new Date("2026-04-27T00:00:00.000Z");
const hrCtx = { hrMax: 205, hrRest: 53 };

describe("thresholdStructureFor — ladder", () => {
  it("B1 starts conservative 2×10 (W1-2), then 3×8 (W3)", () => {
    expect(thresholdStructureFor(1, 1, true)).toMatchObject({ reps: 2, workMin: 10 });
    expect(thresholdStructureFor(1, 2, true)).toMatchObject({ reps: 2, workMin: 10 });
    expect(thresholdStructureFor(1, 3, true)).toMatchObject({ reps: 3, workMin: 8 });
  });
  it("B2: 3×8 (W1) → 3×10 (W2-3)", () => {
    expect(thresholdStructureFor(2, 1, true)).toMatchObject({ reps: 3, workMin: 8 });
    expect(thresholdStructureFor(2, 2, true)).toMatchObject({ reps: 3, workMin: 10 });
  });
  it("B3: 3×10 (W1) → 2×15 (W2-3)", () => {
    expect(thresholdStructureFor(3, 1, true)).toMatchObject({ reps: 3, workMin: 10 });
    expect(thresholdStructureFor(3, 2, true)).toMatchObject({ reps: 2, workMin: 15 });
  });
  it("W4 is a deload (2×8), regardless of block", () => {
    expect(thresholdStructureFor(2, 4, true)).toMatchObject({ reps: 2, workMin: 8 });
    expect(thresholdStructureFor(3, 4, true)).toMatchObject({ reps: 2, workMin: 8 });
  });
});

describe("thresholdStructureFor — shin/RHR gate", () => {
  it("not green → clamp to conservative 2×10 even on advanced block/week", () => {
    expect(thresholdStructureFor(3, 2, false)).toMatchObject({ reps: 2, workMin: 10 });
    expect(thresholdStructureFor(2, 2, false)).toMatchObject({ reps: 2, workMin: 10 });
  });
});

describe("threshold time is capped (~≤30 min), never a growing continuous block", () => {
  it("total threshold work ≤ 30 min across all threshold blocks/weeks", () => {
    for (const b of [1, 2, 3] as const) {
      for (const w of [1, 2, 3, 4] as const) {
        const lvl = thresholdStructureFor(b, w, true);
        const thresholdMin = lvl.reps * lvl.workMin;
        expect(thresholdMin).toBeLessThanOrEqual(30);
      }
    }
  });
  it("durationMin is derived from the structure (2×10 → 44 min)", () => {
    expect(thresholdDurationMin(thresholdStructureFor(1, 1, true))).toBe(44);
  });
});

describe("generateWeekRunPlan — threshold day carries structure", () => {
  it("B1 W2 threshold has structure with workIntervals", () => {
    const plan = generateWeekRunPlan(cfg(1), 2, 42, monday, hrCtx);
    const t = plan.sessions.find((s) => s.type === "threshold_run")!;
    expect(t.structure?.workIntervals?.[0]).toMatchObject({ repeats: 2, durationMin: 10, restMin: 2 });
  });
  it("durationMin == Σ structure (+ activation), not the old volume balloon", () => {
    const plan = generateWeekRunPlan(cfg(2), 6, 42, monday, hrCtx);
    const t = plan.sessions.find((s) => s.type === "threshold_run")!;
    // B2 W2 → 3×10: structure sum 12 + 3×13 + 8 = 59 (+ pre-run activation min).
    const sum = thresholdDurationMin(thresholdStructureFor(2, 2, true));
    expect((t.durationMin ?? 0)).toBeGreaterThanOrEqual(sum);
    expect((t.durationMin ?? 0)).toBeLessThanOrEqual(sum + 10);
  });
  it("not-green clamps the generated threshold to 2×10", () => {
    const plan = generateWeekRunPlan(cfg(3), 10, 42, monday, hrCtx, null, false);
    const t = plan.sessions.find((s) => s.type === "threshold_run")!;
    expect(t.structure?.workIntervals?.[0]).toMatchObject({ repeats: 2, durationMin: 10 });
  });
  it("Block 4 quality day is vo2max (threshold ladder is blocks 1-3 only)", () => {
    const plan = generateWeekRunPlan(cfg(4), 14, 46, monday, hrCtx);
    expect(plan.sessions[1].type).toBe("vo2max_intervals");
  });
});

describe("watch ⇔ app parity — Garmin steps mirror the structure", () => {
  it("threshold pushes warmup + repeat(reps) + cooldown matching structure", () => {
    const plan = generateWeekRunPlan(cfg(2), 6, 42, monday, hrCtx); // B2 W2 → 3×10
    const t = plan.sessions.find((s) => s.type === "threshold_run") as SessionPlan;
    const iv = t.structure!.workIntervals![0];
    const w = buildGarminWorkout(t, vdotToPaces(42))!;
    const steps = w.workoutSegments[0].workoutSteps;
    expect(steps).toHaveLength(3);
    expect(steps[0].stepType.stepTypeKey).toBe("warmup");
    expect(steps[1].stepType.stepTypeKey).toBe("repeat");
    expect(steps[2].stepType.stepTypeKey).toBe("cooldown");
    const rg = steps[1] as RepeatGroupStep;
    expect(rg.numberOfIterations).toBe(iv.repeats);
    expect(rg.workoutSteps[0].endConditionValue).toBe((iv.durationMin ?? 0) * 60);
    expect(rg.workoutSteps[1].endConditionValue).toBe((iv.restMin ?? 0) * 60);
  });
});
