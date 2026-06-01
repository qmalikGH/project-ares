// Sprint 2.1 — Training-Max increment decision logic. Pure helpers, no DB.
import { describe, it, expect } from "vitest";

import {
  evaluateCycleClean,
  decideTmProposal,
} from "@/lib/coach-engine/strength-coach/block-transition";

describe("evaluateCycleClean", () => {
  const target = { reps: 5, rpeCeil: 8 };

  it("returns null with no data", () => {
    expect(evaluateCycleClean([], target)).toBeNull();
  });

  it("clean when top set met reps at/under RPE ceiling", () => {
    const sets = [
      { weightKg: 100, repsCompleted: 5, rpe: 8 },
      { weightKg: 80, repsCompleted: 5, rpe: 6 },
    ];
    expect(evaluateCycleClean(sets, target)).toBe(true);
  });

  it("clean when reps met and RPE missing", () => {
    const sets = [{ weightKg: 100, repsCompleted: 6, rpe: null }];
    expect(evaluateCycleClean(sets, target)).toBe(true);
  });

  it("stall when top set missed reps", () => {
    const sets = [{ weightKg: 100, repsCompleted: 3, rpe: 7 }];
    expect(evaluateCycleClean(sets, target)).toBe(false);
  });

  it("stall when top set over the RPE ceiling", () => {
    const sets = [{ weightKg: 100, repsCompleted: 5, rpe: 10 }];
    expect(evaluateCycleClean(sets, target)).toBe(false);
  });
});

describe("decideTmProposal", () => {
  const base = {
    exerciseName: "Bench Press",
    currentTm: 100,
    isHsr: false,
    prevCycleStalled: false,
    shinNrs: null as number | null,
    bestEstimate: null as number | null,
    dataPoints: 3,
  };

  it("earned clean cycle → +2.5 upper", () => {
    const p = decideTmProposal({ ...base, thisCycleClean: true })!;
    expect(p.reason).toBe("earned");
    expect(p.proposedTm).toBe(102.5);
    expect(p.deltaKg).toBe(2.5);
    expect(p.actionable).toBe(true);
  });

  it("earned clean cycle → +5 lower", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Hex Bar Deadlift",
      isHsr: true,
      currentTm: 140,
      thisCycleClean: true,
    })!;
    expect(p.reason).toBe("earned");
    expect(p.proposedTm).toBe(145);
  });

  it("single stall → hold (no change)", () => {
    const p = decideTmProposal({ ...base, thisCycleClean: false })!;
    expect(p.reason).toBe("hold_stall");
    expect(p.proposedTm).toBe(100);
    expect(p.actionable).toBe(false);
  });

  it("2x stall in a row → −10% reset", () => {
    const p = decideTmProposal({
      ...base,
      thisCycleClean: false,
      prevCycleStalled: true,
    })!;
    expect(p.reason).toBe("reset_double_stall");
    expect(p.proposedTm).toBe(90); // 100 * 0.9 snapped
    expect(p.deltaKg).toBe(-10);
  });

  it("HSR shin >5 steps back −5% (overrides clean)", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Romanian Deadlift",
      isHsr: true,
      currentTm: 100,
      thisCycleClean: true,
      shinNrs: 7,
    })!;
    expect(p.reason).toBe("stepback_shin");
    expect(p.proposedTm).toBe(95);
  });

  it("HSR shin 4–5 holds (overrides clean)", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Hex Bar Deadlift",
      isHsr: true,
      thisCycleClean: true,
      shinNrs: 4,
    })!;
    expect(p.reason).toBe("hold_shin");
    expect(p.proposedTm).toBe(base.currentTm);
  });

  it("HSR shin ≤3 proceeds normally (earned)", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Hex Bar Deadlift",
      isHsr: true,
      currentTm: 140,
      thisCycleClean: true,
      shinNrs: 2,
    })!;
    expect(p.reason).toBe("earned");
    expect(p.proposedTm).toBe(145);
  });

  it("non-HSR ignores shin NRS", () => {
    const p = decideTmProposal({
      ...base,
      thisCycleClean: true,
      shinNrs: 9,
    })!;
    expect(p.reason).toBe("earned");
  });

  it("initial re-baseline when best set implies >10% above current TM", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Hex Bar Deadlift",
      isHsr: true,
      currentTm: 120,
      thisCycleClean: true,
      shinNrs: 1,
      bestEstimate: 147, // +22.5% over 120
    })!;
    expect(p.reason).toBe("initial_rebaseline");
    expect(p.proposedTm).toBe(147.5); // snapped to 2.5
  });

  it("no stored TM + best estimate → initial re-baseline", () => {
    const p = decideTmProposal({
      ...base,
      currentTm: 0,
      thisCycleClean: null,
      bestEstimate: 112.3,
    })!;
    expect(p.reason).toBe("initial_rebaseline");
    expect(p.proposedTm).toBe(112.5);
  });

  it("no data + no baseline → no proposal", () => {
    const p = decideTmProposal({
      ...base,
      currentTm: 0,
      thisCycleClean: null,
      bestEstimate: null,
    });
    expect(p).toBeNull();
  });

  it("no cycle data but has TM → no proposal (nothing earned)", () => {
    const p = decideTmProposal({ ...base, thisCycleClean: null });
    expect(p).toBeNull();
  });
});
