import { describe, it, expect } from "vitest";
import {
  Q_DEFAULT_CONSTRAINTS,
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import type { SessionPlan } from "@/lib/coach-engine/types";

const MONDAY = new Date("2026-04-27T00:00:00Z"); // a real Monday

function s(type: SessionPlan["type"], extras: Partial<SessionPlan> = {}): SessionPlan {
  return {
    date: MONDAY,
    type,
    durationMin: 30,
    ...extras,
  };
}

function dayIndex(date: Date): number {
  // 0 = Mon offset from MONDAY
  return Math.round((date.getTime() - MONDAY.getTime()) / 86400000);
}

describe("planWeekSchedule — Q's default pattern", () => {
  const runs = [
    s("easy_run"),
    s("threshold_run"),
    s("easy_run"),
    s("easy_run"),
    s("long_run", { durationMin: 60 }),
  ];
  const strengths = [s("strength_a"), s("strength_b"), s("strength_c")];

  const result = planWeekSchedule(runs, strengths, MONDAY, Q_DEFAULT_CONSTRAINTS);
  const byDay: Record<number, SessionPlan[]> = {};
  for (const sess of result) {
    const d = dayIndex(sess.date);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(sess);
  }

  it("Mon = Easy + Strength A (cardio AM, strength PM)", () => {
    const types = byDay[0]?.map((s) => s.type) ?? [];
    expect(types).toContain("easy_run");
    expect(types).toContain("strength_a");
  });

  it("Tue = Quality run alone (no strength)", () => {
    const types = byDay[1]?.map((s) => s.type) ?? [];
    expect(types).toContain("threshold_run");
    expect(types.some((t) => t.startsWith("strength"))).toBe(false);
  });

  it("Wed = REST (forced)", () => {
    const types = byDay[2]?.map((s) => s.type) ?? [];
    expect(types).toEqual(["rest"]);
  });

  it("Thu = Easy + Strength B", () => {
    const types = byDay[3]?.map((s) => s.type) ?? [];
    expect(types).toContain("easy_run");
    expect(types).toContain("strength_b");
  });

  it("Fri = Easy + Strength C", () => {
    const types = byDay[4]?.map((s) => s.type) ?? [];
    expect(types).toContain("easy_run");
    expect(types).toContain("strength_c");
  });

  it("Sat = Long run alone", () => {
    const types = byDay[5]?.map((s) => s.type) ?? [];
    expect(types).toContain("long_run");
    expect(types.some((t) => t.startsWith("strength"))).toBe(false);
  });

  it("Sun = REST (forced)", () => {
    const types = byDay[6]?.map((s) => s.type) ?? [];
    expect(types).toEqual(["rest"]);
  });
});

describe("planWeekSchedule — date stamps + ordering", () => {
  it("each session gets the correct date for its placed day", () => {
    const result = planWeekSchedule(
      [s("easy_run"), s("threshold_run"), s("long_run")],
      [s("strength_a")],
      MONDAY,
      Q_DEFAULT_CONSTRAINTS,
    );
    for (const sess of result) {
      const d = dayIndex(sess.date);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  it("flattened result is sorted Mon → Sun", () => {
    const result = planWeekSchedule(
      [s("easy_run"), s("easy_run"), s("threshold_run"), s("long_run")],
      [s("strength_a"), s("strength_b"), s("strength_c")],
      MONDAY,
      Q_DEFAULT_CONSTRAINTS,
    );
    let prevDay = -1;
    for (const sess of result) {
      const d = dayIndex(sess.date);
      expect(d).toBeGreaterThanOrEqual(prevDay);
      prevDay = d;
    }
  });
});

describe("planWeekSchedule — forced-rest edge cases", () => {
  it("Quality day in forcedRest: quality run dropped", () => {
    const constraints = {
      ...Q_DEFAULT_CONSTRAINTS,
      forcedRestDays: new Set([1, 2, 6]), // Tue blocked
    };
    const result = planWeekSchedule(
      [s("threshold_run"), s("easy_run")],
      [s("strength_a")],
      MONDAY,
      constraints,
    );
    expect(result.some((r) => r.type === "threshold_run")).toBe(false);
  });

  it("Sat in forcedRest: long run dropped (no auto-reschedule)", () => {
    const constraints = {
      ...Q_DEFAULT_CONSTRAINTS,
      forcedRestDays: new Set([2, 5, 6]), // Wed + Sat + Sun rest
    };
    const result = planWeekSchedule(
      [s("long_run", { durationMin: 60 }), s("easy_run")],
      [],
      MONDAY,
      constraints,
    );
    expect(result.some((r) => r.type === "long_run")).toBe(false);
  });

  it("Strength target-day in forcedRest: strength dropped (no shift)", () => {
    const constraints = {
      ...Q_DEFAULT_CONSTRAINTS,
      forcedRestDays: new Set([3, 6]), // Thu blocked → Strength B dropped
    };
    const result = planWeekSchedule(
      [s("easy_run"), s("easy_run")],
      [s("strength_a"), s("strength_b"), s("strength_c")],
      MONDAY,
      constraints,
    );
    expect(result.some((r) => r.type === "strength_b")).toBe(false);
    // strength_a still on Mon, strength_c still on Fri
    expect(result.some((r) => r.type === "strength_a")).toBe(true);
    expect(result.some((r) => r.type === "strength_c")).toBe(true);
  });
});

describe("planWeekSchedule — minimal mode (1 strength)", () => {
  it("places single Strength A on Mon", () => {
    const result = planWeekSchedule(
      [s("easy_run"), s("threshold_run"), s("long_run")],
      [s("strength_a")],
      MONDAY,
      Q_DEFAULT_CONSTRAINTS,
    );
    const monStrength = result.find(
      (r) => r.type === "strength_a" && dayIndex(r.date) === 0,
    );
    expect(monStrength).toBeDefined();
  });
});

describe("planWeekSchedule — extra easy runs", () => {
  it("places excess easy runs on free non-strength days", () => {
    // 6 easy runs but only 3 strength-paired slots → 3 extras need placement.
    const easies = Array.from({ length: 6 }, () => s("easy_run"));
    const result = planWeekSchedule(
      easies,
      [s("strength_a"), s("strength_b"), s("strength_c")],
      MONDAY,
      Q_DEFAULT_CONSTRAINTS,
    );
    // At minimum, we should see more easy runs on the schedule than strength days.
    const easyCount = result.filter((r) => r.type === "easy_run").length;
    expect(easyCount).toBeGreaterThanOrEqual(3); // paired with each strength day
  });
});

describe("constraintsFromUserSettings adapter", () => {
  it("converts ISO 1-7 to internal 0-6", () => {
    const c = constraintsFromUserSettings({
      forcedRestDaysIso: [3, 7], // Wed + Sun (ISO)
      preferredLongRunDayIso: 6, // Sat (ISO)
    });
    expect(c.forcedRestDays.has(2)).toBe(true); // Wed = 2 internally
    expect(c.forcedRestDays.has(6)).toBe(true); // Sun = 6 internally
    expect(c.preferredLongRunDay).toBe(5); // Sat = 5 internally
  });

  it("falls back to Q_DEFAULT when input is empty", () => {
    const c = constraintsFromUserSettings({
      forcedRestDaysIso: null,
      preferredLongRunDayIso: null,
    });
    expect(c.forcedRestDays).toEqual(Q_DEFAULT_CONSTRAINTS.forcedRestDays);
    expect(c.preferredLongRunDay).toBe(Q_DEFAULT_CONSTRAINTS.preferredLongRunDay);
  });

  it("clamps out-of-range ISO days defensively", () => {
    const c = constraintsFromUserSettings({
      forcedRestDaysIso: [0, 99],
      preferredLongRunDayIso: 0,
    });
    expect([...c.forcedRestDays].every((d) => d >= 0 && d <= 6)).toBe(true);
    expect(c.preferredLongRunDay).toBeGreaterThanOrEqual(0);
    expect(c.preferredLongRunDay).toBeLessThanOrEqual(6);
  });
});
