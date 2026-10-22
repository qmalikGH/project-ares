// Sprint 3.3 (B1/B2/B5) — run progression from completed sessions. Pure.
import { describe, expect, it } from "vitest";

import {
  isTimeTrialWeek,
  nextThresholdIndex,
  runCapForWeek,
  TIME_TRIAL_EARLIEST,
} from "@/lib/coach-engine/run-progression";
import {
  generateWeekRunPlan,
  thresholdDurationMin,
  thresholdLadderIndexOf,
  thresholdLevelAt,
  timeTrialRun,
  vdotToPaces,
} from "@/lib/coach-engine/run-coach";
import { BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";
import { buildGarminWorkout } from "@/lib/garmin/workout-builder";
import { raceSecForVdot, vdotFrom5kSec, vdotFromRace } from "@/lib/coach-engine/vdot-calculator";
import type { PhaseConfig, SessionPlan } from "@/lib/coach-engine/types";

const DAY = 86400000;
const monday = new Date("2026-11-02T00:00:00.000Z");
const daysBefore = (n: number) => new Date(monday.getTime() - n * DAY);
const hrCtx = { hrMax: 190, hrRest: 60 };

describe("runCapForWeek (B1)", () => {
  it("is 110 % of the longest counted run, rounded down", () => {
    expect(runCapForWeek([{ date: daysBefore(3), minutes: 40 }, { date: daysBefore(10), minutes: 35 }], monday)).toBe(44);
  });

  it("never drops below 30 min — runs up to 30 are always allowed", () => {
    expect(runCapForWeek([], monday)).toBe(30);
    expect(runCapForWeek([{ date: daysBefore(2), minutes: 20 }], monday)).toBe(30);
  });

  it("is monotone: one short run never yields a lower cap than no run", () => {
    const none = runCapForWeek([], monday);
    for (const minutes of [5, 13, 20, 27, 31, 45]) {
      expect(runCapForWeek([{ date: daysBefore(1), minutes }], monday)).toBeGreaterThanOrEqual(none);
    }
  });

  it("only sees the 30 days before the week", () => {
    expect(runCapForWeek([{ date: daysBefore(30), minutes: 60 }], monday)).toBe(66);
    expect(runCapForWeek([{ date: daysBefore(31), minutes: 60 }], monday)).toBe(30);
    // A run inside the week itself does not raise that week's cap.
    expect(runCapForWeek([{ date: monday, minutes: 60 }], monday)).toBe(30);
  });
});

describe("nextThresholdIndex (B2)", () => {
  it("no completed threshold in 28 days → bottom rung", () => {
    expect(nextThresholdIndex([], monday)).toBe(0);
    expect(nextThresholdIndex([{ date: daysBefore(29), index: 2 }], monday)).toBe(0);
  });

  it("one rung above the highest completed rung", () => {
    expect(nextThresholdIndex([{ date: daysBefore(7), index: 0 }, { date: daysBefore(14), index: 1 }], monday)).toBe(2);
  });

  it("tops out at L3 (2×15)", () => {
    expect(nextThresholdIndex([{ date: daysBefore(7), index: 3 }], monday)).toBe(3);
  });

  it("reads the rung from a planned structure; the deload 2×8 is not a rung", () => {
    expect(thresholdLadderIndexOf({ warmupMin: 12, workIntervals: [{ repeats: 3, durationMin: 8, restMin: 2 }], cooldownMin: 8 })).toBe(1);
    expect(thresholdLadderIndexOf({ warmupMin: 10, workIntervals: [{ repeats: 2, durationMin: 8, restMin: 2 }] })).toBeNull();
    expect(thresholdLadderIndexOf(undefined)).toBeNull();
  });
});

describe("isTimeTrialWeek (B5)", () => {
  const base = {
    testDate: new Date("2026-11-24T00:00:00.000Z"),
    isDeloadWeek: true,
    lastTestDate: null,
    capMin: 30,
    testDurationMin: 30,
  };

  it("first eligible: the deload week of 24.11.", () => {
    expect(TIME_TRIAL_EARLIEST.toISOString().slice(0, 10)).toBe("2026-11-24");
    expect(isTimeTrialWeek(base)).toBe(true);
    expect(isTimeTrialWeek({ ...base, testDate: new Date("2026-10-27T00:00:00.000Z") })).toBe(false);
  });

  it("only in deload weeks", () => {
    expect(isTimeTrialWeek({ ...base, isDeloadWeek: false })).toBe(false);
  });

  it("only when the test fits under the cap — otherwise the next deload week", () => {
    expect(isTimeTrialWeek({ ...base, testDurationMin: 31 })).toBe(false);
  });

  it("every second deload week (8 weeks apart)", () => {
    const last = base.testDate;
    expect(isTimeTrialWeek({ ...base, lastTestDate: last, testDate: new Date(last.getTime() + 28 * DAY) })).toBe(false);
    expect(isTimeTrialWeek({ ...base, lastTestDate: last, testDate: new Date(last.getTime() + 56 * DAY) })).toBe(true);
  });
});

describe("generateWeekRunPlan with progression", () => {
  const b2 = BLOCK_CONFIGS[2];
  const b3: PhaseConfig = BLOCK_CONFIGS[3];
  const runs = (plan: { sessions: SessionPlan[] }) =>
    plan.sessions.filter((s) => s.type !== "rest" && (s.durationMin ?? 0) > 0);

  it("no run exceeds the cap — long run 80 becomes 33", () => {
    const capped = generateWeekRunPlan(b3, 9, 35, monday, hrCtx, null, true, "progress", null, {
      capMin: 33, thresholdIndex: 0, timeTrial: false,
    });
    for (const s of runs(capped)) expect(s.durationMin).toBeLessThanOrEqual(33);
    expect(capped.sessions.find((s) => s.type === "long_run")!.durationMin).toBe(33);
  });

  it("threshold steps down to the highest rung that fits", () => {
    // L2 (3×10/3) needs 49 min, L1 (3×8/2) 40 → cap 44 plans L1.
    const plan = generateWeekRunPlan(b2, 6, 35, monday, hrCtx, null, true, "progress", null, {
      capMin: 44, thresholdIndex: 2, timeTrial: false,
    });
    const t = plan.sessions.find((s) => s.type === "threshold_run")!;
    expect(t.structure!.workIntervals![0]).toMatchObject({ repeats: 3, durationMin: 8 });
    expect(t.durationMin).toBe(40);
  });

  it("if L0 (34 min) does not fit, the quality day is an easy run of cap length", () => {
    expect(thresholdDurationMin(thresholdLevelAt(0))).toBe(34);
    const plan = generateWeekRunPlan(b2, 6, 35, monday, hrCtx, null, true, "progress", null, {
      capMin: 33, thresholdIndex: 1, timeTrial: false,
    });
    expect(plan.sessions.find((s) => s.type === "threshold_run")).toBeUndefined();
    expect(plan.sessions[1]).toMatchObject({ type: "easy_run", durationMin: 33 });
    expect(plan.sessions[1].notes).toContain("pausiert");
  });

  it("the rung comes from history, not the calendar (B3 W1 at L0 → 2×10)", () => {
    const plan = generateWeekRunPlan(b3, 9, 35, monday, hrCtx, null, true, "progress", null, {
      capMin: 200, thresholdIndex: 0, timeTrial: false,
    });
    expect(plan.sessions.find((s) => s.type === "threshold_run")!.structure!.workIntervals![0])
      .toMatchObject({ repeats: 2, durationMin: 10 });
  });

  it("a held gate still floors at L0 whatever the history earned", () => {
    const plan = generateWeekRunPlan(b3, 9, 35, monday, hrCtx, null, false, "hold", null, {
      capMin: 200, thresholdIndex: 3, timeTrial: false,
    });
    expect(plan.sessions.find((s) => s.type === "threshold_run")!.structure!.workIntervals![0])
      .toMatchObject({ repeats: 2, durationMin: 10 });
  });

  it("the deload week is 2×8 and fits any cap", () => {
    const plan = generateWeekRunPlan(b2, 8, 35, monday, hrCtx, null, true, "progress", null, {
      capMin: 30, thresholdIndex: 3, timeTrial: false,
    });
    const t = plan.sessions.find((s) => s.type === "threshold_run")!;
    expect(t.structure!.workIntervals![0]).toMatchObject({ repeats: 2, durationMin: 8 });
    expect(t.durationMin).toBe(30);
  });

  it("a test week replaces the deload threshold with the 3-km test", () => {
    const plan = generateWeekRunPlan(b2, 8, 35, monday, hrCtx, null, true, "progress", null, {
      capMin: 30, thresholdIndex: 0, timeTrial: true,
    });
    expect(plan.sessions[1].type).toBe("time_trial_5k");
    expect(plan.sessions.find((s) => s.type === "threshold_run")).toBeUndefined();
  });

  it("no test during the ramp", () => {
    const plan = generateWeekRunPlan(b2, 8, 35, monday, hrCtx, null, true, "progress", 3, {
      capMin: 30, thresholdIndex: 0, timeTrial: true,
    });
    expect(plan.sessions.find((s) => s.type === "time_trial_5k")).toBeUndefined();
  });
});

describe("projection over several weeks (B1 staircase)", () => {
  // The regenerate loop in miniature: plan a week, feed its runs back in as
  // done, plan the next. Starting from nothing, against Block 3's constants
  // (long run 75+, threshold up to 2×15).
  it("no week has a run over 110 % of the 30-day maximum, and the long run climbs", () => {
    const history: { date: Date; minutes: number }[] = [];
    const longRuns: number[] = [];
    for (let w = 0; w < 10; w++) {
      const weekStart = new Date(monday.getTime() + w * 7 * DAY);
      const cap = runCapForWeek(history, weekStart);
      const longest = Math.max(0, ...history
        .filter((r) => r.date.getTime() >= weekStart.getTime() - 30 * DAY && r.date < weekStart)
        .map((r) => r.minutes));
      const plan = generateWeekRunPlan(BLOCK_CONFIGS[3], 9 + w, 35, weekStart, hrCtx, null, true, "progress", null, {
        capMin: cap, thresholdIndex: 0, timeTrial: false,
      });
      for (const s of plan.sessions) {
        if (s.type === "rest" || !s.durationMin) continue;
        expect(s.durationMin).toBeLessThanOrEqual(Math.max(30, Math.floor(longest * 1.1)));
        history.push({ date: s.date, minutes: s.durationMin });
      }
      longRuns.push(plan.sessions.find((s) => s.type === "long_run")?.durationMin ?? 0);
    }
    // A visible staircase instead of the 80-minute cliff.
    expect(longRuns[0]).toBe(30);
    expect(longRuns[1]).toBe(33);
    expect(longRuns[2]).toBe(36);
    expect(longRuns.every((m, i) => i === 0 || m >= longRuns[i - 1])).toBe(true);
  });
});

describe("3-km test session (B5)", () => {
  it("Daniels for any distance agrees with the 5k formula", () => {
    expect(vdotFrom5kSec(27 * 60)).toBe(Math.round(vdotFromRace(5000, 27 * 60)));
    const sec = raceSecForVdot(3000, 35);
    expect(Math.round(vdotFromRace(3000, sec))).toBe(35);
  });

  it("fits a 30-min cap at VDOT 35: 10 warm-up + 4 strides + the predicted 3 km", () => {
    const tt = timeTrialRun(monday, 35);
    expect(tt.durationMin).toBeLessThanOrEqual(30);
    expect(tt.structure!.workIntervals).toContainEqual({ repeats: 1, distanceM: 3000 });
  });

  it("goes to the watch as warm-up, strides and a 3000 m distance step", () => {
    const tt = timeTrialRun(monday, 35);
    const w = buildGarminWorkout(tt, vdotToPaces(35))!;
    const steps = w.workoutSegments[0].workoutSteps;
    expect(steps.map((s) => s.stepType.stepTypeKey)).toEqual(["warmup", "repeat", "interval"]);
    const last = steps[2] as { endCondition: { conditionTypeKey: string }; endConditionValue: number };
    expect(last.endCondition.conditionTypeKey).toBe("distance");
    expect(last.endConditionValue).toBe(3000);
  });

  it("the legacy Block-5 trial without a distance step stays off the watch", () => {
    const legacy: SessionPlan = { date: monday, type: "time_trial_5k", durationMin: 60 };
    expect(buildGarminWorkout(legacy, vdotToPaces(35))).toBeNull();
  });
});
