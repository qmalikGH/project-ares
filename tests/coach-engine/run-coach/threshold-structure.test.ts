// Sprint 2.2 — threshold interval structure: capped threshold time, ladder
// progression, shin/RHR gate, and watch⇔app segment parity. Pure, no DB.
import { describe, it, expect } from "vitest";

import {
  thresholdStructureFor,
  thresholdDurationMin,
  generateWeekRunPlan,
  vdotToPaces,
} from "@/lib/coach-engine/run-coach";
import { BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";
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

// Sprint 2.3 #3 — run-volume pain governor (composes with the threshold gate).
describe("run-volume pain governor (shinVolumeGate)", () => {
  const longMin = (plan: { sessions: SessionPlan[] }) =>
    plan.sessions.find((s) => s.type === "long_run")!.durationMin!;

  it("regress (shin≥4): quality cancelled → easy run, long volume −20%", () => {
    const normal = generateWeekRunPlan(cfg(1), 2, 39, monday, hrCtx, null, true, "progress");
    const regress = generateWeekRunPlan(cfg(1), 2, 39, monday, hrCtx, null, false, "regress");
    // Tue quality day becomes an easy run (no threshold intensity on an angry shin).
    expect(normal.sessions[1].type).toBe("threshold_run");
    expect(regress.sessions[1].type).toBe("easy_run");
    expect(regress.sessions.find((s) => s.type === "threshold_run")).toBeUndefined();
    // Long-run volume reduced ~20%.
    expect(longMin(regress)).toBeLessThan(longMin(normal));
  });

  it("regress also cancels vo2max quality in blocks 4-5", () => {
    const regress = generateWeekRunPlan(cfg(4), 14, 46, monday, hrCtx, null, false, "regress");
    expect(regress.sessions[1].type).toBe("easy_run");
    expect(regress.sessions.find((s) => s.type === "vo2max_intervals")).toBeUndefined();
  });

  it("hold (shin=3): threshold clamped to 2×10 floor, volume UNCHANGED (no double penalty)", () => {
    const progress = generateWeekRunPlan(cfg(1), 3, 39, monday, hrCtx, null, true, "progress");
    const hold = generateWeekRunPlan(cfg(1), 3, 39, monday, hrCtx, null, false, "hold");
    // W3 progress → ladder 3×8; hold → conservative 2×10 floor.
    expect(progress.sessions.find((s) => s.type === "threshold_run")!.structure?.workIntervals?.[0])
      .toMatchObject({ repeats: 3, durationMin: 8 });
    expect(hold.sessions.find((s) => s.type === "threshold_run")!.structure?.workIntervals?.[0])
      .toMatchObject({ repeats: 2, durationMin: 10 });
    // Volume identical — hold only touches the structure, not the run volume.
    expect(longMin(hold)).toBe(longMin(progress));
  });

  it("progress / no gate: full volume + ladder threshold (back-compat)", () => {
    const withGate = generateWeekRunPlan(cfg(1), 2, 39, monday, hrCtx, null, true, "progress");
    const noGate = generateWeekRunPlan(cfg(1), 2, 39, monday, hrCtx, null, true);
    expect(longMin(withGate)).toBe(longMin(noGate));
    expect(noGate.sessions[1].type).toBe("threshold_run");
  });
});

// Sprint 2.4 #2 — return-to-training ramp. This is the scenario that produced
// the sprint: Block 2 W1 after a 9-week layoff would otherwise prescribe
// 235 min of running including 24 min of threshold at the pre-layoff T-pace.
describe("comeback ramp (return to training after a layoff)", () => {
  const totalMin = (plan: { sessions: SessionPlan[] }) =>
    plan.sessions.reduce((acc, s) => acc + (s.durationMin ?? 0), 0);
  const longMin = (plan: { sessions: SessionPlan[] }) =>
    plan.sessions.find((s) => s.type === "long_run")!.durationMin!;

  // Use the REAL block config here, not the trimmed local `cfg()` — the whole
  // point is what production actually prescribes on the first Monday back.
  // B2 W1 = weekNumber 5 with 4-week phases.
  const b2w1 = (comeback: 1 | 2 | 3 | null) =>
    generateWeekRunPlan(BLOCK_CONFIGS[2], 5, 35, monday, hrCtx, null, true, "progress", comeback);

  it("week 1 has NO threshold session — the quality day becomes an easy run", () => {
    const normal = b2w1(null);
    const ramped = b2w1(1);
    expect(normal.sessions.find((s) => s.type === "threshold_run")).toBeDefined();
    expect(ramped.sessions.find((s) => s.type === "threshold_run")).toBeUndefined();
    expect(ramped.sessions[1].type).toBe("easy_run");
    expect(ramped.sessions[1].notes).toContain("Wiedereinstieg");
  });

  it("week 1 cuts total run volume to roughly half of the block prescription", () => {
    const normal = totalMin(b2w1(null));
    const ramped = totalMin(b2w1(1));
    expect(normal).toBe(235); // the number this sprint exists for
    expect(ramped).toBeLessThan(140);
    expect(ramped).toBeGreaterThan(100); // still real training, not a token week
  });

  it("volume climbs monotonically across the three ramp weeks and then returns", () => {
    const w1 = totalMin(b2w1(1));
    const w2 = totalMin(b2w1(2));
    const w3 = totalMin(b2w1(3));
    const off = totalMin(b2w1(null));
    expect(w1).toBeLessThan(w2);
    expect(w2).toBeLessThan(w3);
    expect(w3).toBeLessThan(off);
  });

  it("week 3 brings the quality day back, but at the conservative 2×10 floor", () => {
    // B2 W1's ladder position is 3×8; after months off the ladder position is
    // meaningless, so the first threshold back is always the floor.
    const ramped = b2w1(3);
    const threshold = ramped.sessions.find((s) => s.type === "threshold_run");
    expect(threshold).toBeDefined();
    expect(threshold!.structure?.workIntervals?.[0]).toMatchObject({ repeats: 2, durationMin: 10 });
  });

  it("also suppresses vo2max quality in blocks 4-5", () => {
    const ramped = generateWeekRunPlan(cfg(4), 13, 35, monday, hrCtx, null, true, "progress", 1);
    expect(ramped.sessions.find((s) => s.type === "vo2max_intervals")).toBeUndefined();
    expect(ramped.sessions[1].type).toBe("easy_run");
  });

  it("a shin flare during the ramp does not compound — the stricter brake wins", () => {
    // 0.55 (ramp) and 0.8 (regress) must not multiply to 0.44.
    const rampOnly = longMin(b2w1(1));
    const both = generateWeekRunPlan(cfg(2), 5, 35, monday, hrCtx, null, false, "regress", 1);
    expect(longMin(both)).toBe(rampOnly);
  });

  it("a milder ramp week still yields to a harsher pain gate", () => {
    // Ramp week 3 is 0.85, regress is 0.8 → the pain gate is stricter and wins.
    const w3 = generateWeekRunPlan(cfg(2), 5, 35, monday, hrCtx, null, true, "progress", 3);
    const w3Flared = generateWeekRunPlan(cfg(2), 5, 35, monday, hrCtx, null, false, "regress", 3);
    expect(longMin(w3Flared)).toBeLessThan(longMin(w3));
  });

  it("no ramp argument behaves exactly as before (back-compat)", () => {
    const withNull = generateWeekRunPlan(cfg(2), 5, 35, monday, hrCtx, null, true, "progress", null);
    const omitted = generateWeekRunPlan(cfg(2), 5, 35, monday, hrCtx, null, true, "progress");
    expect(totalMin(withNull)).toBe(totalMin(omitted));
  });
});
