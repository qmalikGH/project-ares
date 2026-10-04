// Sprint 2.1 — Training-Max increment decision logic. Pure helpers, no DB.
import { describe, it, expect } from "vitest";

import {
  bestRatedEstimate,
  evaluateCycleClean,
  decideTmProposal,
} from "@/lib/coach-engine/strength-coach/block-transition";

describe("bestRatedEstimate (Sprint 3.2a)", () => {
  it("ignores unrated and easy sets — 13.08. RDL 60×10 @5 must not lower a TM of 115", () => {
    expect(
      bestRatedEstimate([
        { rpe: 5, estimatedOneRM: 90 },
        { rpe: null, estimatedOneRM: 101 },
      ]),
    ).toBeNull();
  });

  it("takes the best set at RPE ≥ 7", () => {
    expect(
      bestRatedEstimate([
        { rpe: 7, estimatedOneRM: 104 },
        { rpe: 9, estimatedOneRM: 110 },
        { rpe: 6, estimatedOneRM: 130 },
      ]),
    ).toBe(110);
  });
});

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

  // Sprint 3.2a — this used to be `true`. The /confirm "as prescribed" tap
  // writes exactly this shape (prescribed weight × reps, rpe null), so one tap
  // earned an increment and nothing could ever stall.
  it("no evidence when the only sets carry no RPE (as-prescribed tap)", () => {
    // 31.08.: Hex 4×5 @120 kg, confirmed by tap — Garmin has no session that day.
    const sets = Array.from({ length: 4 }, () => ({ weightKg: 120, repsCompleted: 5, rpe: null }));
    expect(evaluateCycleClean(sets, target)).toBeNull();
  });

  it("unrated sets are ignored, the rated top set decides", () => {
    const sets = [
      { weightKg: 120, repsCompleted: 5, rpe: null },
      { weightKg: 100, repsCompleted: 5, rpe: 9 },
    ];
    expect(evaluateCycleClean(sets, target)).toBe(false);
  });

  it("no evidence when a clean set was lifted below the block load (comeback ramp)", () => {
    // TM 145, block load 82% → regular 118.9 kg, floor 95% ≈ 113 kg.
    // Ramp week 1 prescribes ×0.75 → 89 kg; reps at RPE 6 are trivially met.
    const t = { reps: 5, rpeCeil: 8, minLoadKg: (145 * 82 * 0.95) / 100 };
    expect(evaluateCycleClean([{ weightKg: 89, repsCompleted: 5, rpe: 6 }], t)).toBeNull();
  });

  it("clean at the regular block load", () => {
    const t = { reps: 5, rpeCeil: 8, minLoadKg: (145 * 82 * 0.95) / 100 };
    expect(evaluateCycleClean([{ weightKg: 120, repsCompleted: 5, rpe: 8 }], t)).toBe(true);
  });

  it("a struggle below the block load is still a stall", () => {
    const t = { reps: 5, rpeCeil: 8, minLoadKg: (145 * 82 * 0.95) / 100 };
    expect(evaluateCycleClean([{ weightKg: 89, repsCompleted: 4, rpe: 9 }], t)).toBe(false);
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

  it("Sprint 2.3: initial re-baseline BYPASSES the HSR shin gate (data correction, not progression)", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Romanian Deadlift",
      isHsr: true,
      currentTm: 100,
      thisCycleClean: false, // would be hold normally
      shinNrs: 5, // HSR gate would hold...
      bestEstimate: 114, // ...but a >10% under-anchor corrects anyway
    })!;
    expect(p.reason).toBe("initial_rebaseline");
    expect(p.proposedTm).toBe(115);
  });

  it("HSR shin gate still holds earned/stall progression (no big under-anchor)", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Romanian Deadlift",
      isHsr: true,
      currentTm: 100,
      thisCycleClean: true,
      shinNrs: 5,
      bestEstimate: 104, // <10% over TM → no rebaseline → gate holds
    })!;
    expect(p.reason).toBe("hold_shin");
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

  // ── Sprint 3.2a: re-baseline down ──────────────────────────────────────
  // After a layoff and ~6 kg of weight loss the TMs from 09.08. are likely too
  // high. Before this rule a TM could only fall after two stalled cycles, and
  // /confirm could not produce a stall at all.

  it("rated heavy set >10% below the TM → re-baseline down", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Hex Bar Deadlift",
      isHsr: true,
      currentTm: 145,
      thisCycleClean: true,
      bestRatedEstimate: 122, // −16%
    })!;
    expect(p.reason).toBe("rebaseline_down");
    expect(p.proposedTm).toBe(122.5);
    expect(p.deltaKg).toBe(-22.5);
    expect(p.actionable).toBe(true);
  });

  it("re-baseline down also fires under the HSR shin gate (data correction, lower is safe)", () => {
    const p = decideTmProposal({
      ...base,
      exerciseName: "Romanian Deadlift",
      isHsr: true,
      currentTm: 115,
      thisCycleClean: null,
      shinNrs: 6,
      bestRatedEstimate: 95,
    })!;
    expect(p.reason).toBe("rebaseline_down");
    expect(p.proposedTm).toBe(95);
  });

  it("within 10% of the TM → no re-baseline down, normal path decides", () => {
    const p = decideTmProposal({
      ...base,
      currentTm: 100,
      thisCycleClean: true,
      bestRatedEstimate: 92,
    })!;
    expect(p.reason).toBe("earned");
  });

  it("re-baseline up still wins when the best set is far above the TM", () => {
    const p = decideTmProposal({
      ...base,
      currentTm: 100,
      thisCycleClean: true,
      bestEstimate: 120,
      bestRatedEstimate: 120,
    })!;
    expect(p.reason).toBe("initial_rebaseline");
  });
});
