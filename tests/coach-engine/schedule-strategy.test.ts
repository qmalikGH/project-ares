import { describe, it, expect } from "vitest";
import {
  Q_DEFAULT_CONSTRAINTS,
  canMoveSession,
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

// Sprint 3.3 (A1): four training days — Mon A + easy, Tue quality, Thu B +
// easy, Sat long; Wed, Fri, Sun forced rest. The run coach still makes three
// easy runs; the third one has no day and is merged into the other two.
describe("planWeekSchedule — Q's default pattern", () => {
  const runs = [
    s("easy_run"),
    s("threshold_run"),
    s("easy_run"),
    s("easy_run"),
    s("long_run", { durationMin: 60 }),
  ];
  const strengths = [s("strength_a"), s("strength_b")];

  const result = planWeekSchedule(runs, strengths, MONDAY, Q_DEFAULT_CONSTRAINTS);
  const byDay: Record<number, SessionPlan[]> = {};
  for (const sess of result) {
    const d = dayIndex(sess.date);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(sess);
  }

  it("Mon = Strength A, then Easy (strength first, ≥3h gap)", () => {
    const types = byDay[0]?.map((s) => s.type) ?? [];
    expect(types).toEqual(["strength_a", "easy_run"]);
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

  it("Thu = Strength B, then Easy", () => {
    const types = byDay[3]?.map((s) => s.type) ?? [];
    expect(types).toEqual(["strength_b", "easy_run"]);
  });

  it("Fri = REST (forced)", () => {
    const types = byDay[4]?.map((s) => s.type) ?? [];
    expect(types).toEqual(["rest"]);
  });

  it("the third easy run is merged, not dropped: the week keeps its easy minutes", () => {
    const easy = result.filter((x) => x.type === "easy_run");
    expect(easy).toHaveLength(2);
    expect(easy.reduce((n, x) => n + (x.durationMin ?? 0), 0)).toBe(90);
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
      [s("strength_a"), s("strength_b")],
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
      [s("strength_a"), s("strength_b")],
      MONDAY,
      constraints,
    );
    expect(result.some((r) => r.type === "strength_b")).toBe(false);
    // strength_a still on Mon
    expect(result.some((r) => r.type === "strength_a")).toBe(true);
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
  it("places excess easy runs on free non-strength days first", () => {
    // Only Sun forced rest: Tue, Wed, Fri, Sat are free for the extras.
    const easies = Array.from({ length: 6 }, () => s("easy_run"));
    const result = planWeekSchedule(
      easies,
      [s("strength_a"), s("strength_b")],
      MONDAY,
      { ...Q_DEFAULT_CONSTRAINTS, forcedRestDays: new Set([6]) },
    );
    expect(result.filter((r) => r.type === "easy_run")).toHaveLength(6);
  });

  // Sprint 3.3: they used to be dropped in silence.
  it("merges what finds no day into the placed easy runs", () => {
    const easies = [
      s("easy_run", { durationMin: 35 }), s("easy_run", { durationMin: 30 }), s("easy_run", { durationMin: 35 }),
      s("threshold_run"), s("long_run"),
    ];
    const result = planWeekSchedule(easies, [s("strength_a"), s("strength_b")], MONDAY, Q_DEFAULT_CONSTRAINTS);
    expect(result.filter((r) => r.type === "easy_run").map((r) => r.durationMin)).toEqual([50, 50]);
  });

  it("the B1 cap wins over the merged minutes", () => {
    const easies = [
      s("easy_run", { durationMin: 35 }), s("easy_run", { durationMin: 30 }), s("easy_run", { durationMin: 35 }),
      s("threshold_run"), s("long_run"),
    ];
    const result = planWeekSchedule(easies, [s("strength_a"), s("strength_b")], MONDAY, Q_DEFAULT_CONSTRAINTS, {
      maxRunMin: 33,
    });
    expect(result.filter((r) => r.type === "easy_run").map((r) => r.durationMin)).toEqual([33, 33]);
  });
});

describe("planWeekSchedule — home prevention (A4)", () => {
  const names = ["Tibialis Anterior Raises", "Short Foot Exercise", "Single-Leg Calf Raises"];
  const result = planWeekSchedule([s("easy_run")], [s("strength_a")], MONDAY, Q_DEFAULT_CONSTRAINTS, {
    preventionExercises: names,
  });

  it("goes on every forced rest day (Wed, Fri, Sun), next to the rest marker", () => {
    for (const d of [2, 4, 6]) {
      expect(result.filter((x) => dayIndex(x.date) === d).map((x) => x.type)).toEqual(["rest", "mobility"]);
    }
    expect(result.filter((x) => x.type === "mobility")).toHaveLength(3);
  });

  it("carries the prescribed exercises, ~10 min", () => {
    const m = result.find((x) => x.type === "mobility")!;
    expect(m.durationMin).toBe(10);
    expect(m.exercises?.map((e) => `${e.name} ${e.sets}×${e.reps}`)).toEqual([
      "Tibialis Anterior Raises 3×15",
      "Short Foot Exercise 3×30sec hold",
      "Single-Leg Calf Raises 3×12/leg",
    ]);
  });

  it("no prevention list → no session", () => {
    const plain = planWeekSchedule([s("easy_run")], [], MONDAY, Q_DEFAULT_CONSTRAINTS);
    expect(plain.some((x) => x.type === "mobility")).toBe(false);
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

describe("canMoveSession", () => {
  const offset = (n: number) =>
    new Date(MONDAY.getTime() + n * 86400000);

  // Q's default week assembled by hand for predictable test fixtures.
  // Sprint 3.3: Mon: strength_a + easy, Tue: threshold, Wed: rest, Thu:
  // strength_b + easy, Fri: rest, Sat: long, Sun: rest.
  const defaultWeek: SessionPlan[] = [
    s("strength_a", { date: offset(0) }),
    s("easy_run", { date: offset(0) }),
    s("threshold_run", { date: offset(1) }),
    s("rest", { date: offset(2), durationMin: 0 }),
    s("strength_b", { date: offset(3) }),
    s("easy_run", { date: offset(3) }),
    s("rest", { date: offset(4), durationMin: 0 }),
    s("long_run", { date: offset(5) }),
    s("rest", { date: offset(6), durationMin: 0 }),
  ];

  // Sprint 3.3: B carries RDL, split squats and Nordics — Thu is a lower-body
  // strength day like Mon, so the 24h rule fires there too.
  it("rejects moving Tue threshold to Thu (Strength B day, 24h rule)", () => {
    const r = canMoveSession({
      fromDate: offset(1),
      toDate: offset(3),
      sessionType: "threshold_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/24h-Regel/);
  });

  it("rejects a move to Fri — a forced rest day since Sprint 3.3", () => {
    const r = canMoveSession({
      fromDate: offset(3),
      toDate: offset(4),
      sessionType: "easy_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Pflicht-Ruhetag/);
  });

  it("rejects move when fromDate is outside the week", () => {
    const r = canMoveSession({
      fromDate: offset(-1),
      toDate: offset(3),
      sessionType: "easy_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Wochengrenzen/);
  });

  it("rejects same-day no-op move", () => {
    const r = canMoveSession({
      fromDate: offset(1),
      toDate: offset(1),
      sessionType: "threshold_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/identisch/);
  });

  it("rejects move to a forced-rest day", () => {
    const r = canMoveSession({
      fromDate: offset(1),
      toDate: offset(2), // Wed — forced rest in Q_DEFAULT
      sessionType: "threshold_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Pflicht-Ruhetag/);
  });

  it("rejects quality run landing on Mon (Strength A 24h-gap rule)", () => {
    // Build a fixture where Mon has only easy_run (so density isn't the
    // blocker) and Strength A sits elsewhere — the rule should still fire
    // because Mon is the canonical Strength A slot.
    const week: SessionPlan[] = [
      s("easy_run", { date: offset(0) }),
      s("strength_a", { date: offset(0) }),
    ];
    // Move threshold from Tue to Mon — quality should never be on Strength
    // A's day regardless of density. Use a sparse fixture: only Mon's easy
    // (1 session) so density rule (which fires at >=2) doesn't shadow the
    // gap rule.
    const sparseWeek: SessionPlan[] = [
      s("easy_run", { date: offset(0) }),
      s("threshold_run", { date: offset(1) }),
    ];
    const r = canMoveSession({
      fromDate: offset(1),
      toDate: offset(0),
      sessionType: "threshold_run",
      weekStartMonday: MONDAY,
      weekSessions: sparseWeek,
      constraints: { ...Q_DEFAULT_CONSTRAINTS, forcedRestDays: new Set([6]) },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/24h-Regel|Strength-A/);
    // suppress unused-var lint
    void week;
  });

  it("rejects strength colliding with another strength on the same day", () => {
    const week: SessionPlan[] = [
      s("strength_a", { date: offset(0) }),
      s("strength_b", { date: offset(3) }),
    ];
    const r = canMoveSession({
      fromDate: offset(0),
      toDate: offset(3),
      sessionType: "strength_a",
      weekStartMonday: MONDAY,
      weekSessions: week,
      constraints: { ...Q_DEFAULT_CONSTRAINTS, forcedRestDays: new Set([6]) },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/strength_b|Strength/);
  });

  it("rejects density >= 2 on the target day", () => {
    const r = canMoveSession({
      fromDate: offset(3),
      toDate: offset(0), // Mon has strength_a + easy (2 sessions)
      sessionType: "easy_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/zwei Sessions/);
  });

  it("rejects long_run move off its preferredLongRunDay", () => {
    const r = canMoveSession({
      fromDate: offset(5),
      toDate: offset(0),
      sessionType: "long_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Long-Run/);
  });

  it("rejects landing on a day that already has a long_run", () => {
    const r = canMoveSession({
      fromDate: offset(1),
      toDate: offset(5),
      sessionType: "easy_run",
      weekStartMonday: MONDAY,
      weekSessions: defaultWeek,
      constraints: Q_DEFAULT_CONSTRAINTS,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Long-Run-Tag/);
  });

  it("allows a legitimate easy_run move to a free non-rest day", () => {
    // Sparse fixture so density doesn't block: just one easy_run on Mon.
    const sparse: SessionPlan[] = [
      s("easy_run", { date: offset(0) }),
    ];
    const r = canMoveSession({
      fromDate: offset(0),
      toDate: offset(1), // Tue, free in this fixture
      sessionType: "easy_run",
      weekStartMonday: MONDAY,
      weekSessions: sparse,
      constraints: { ...Q_DEFAULT_CONSTRAINTS, forcedRestDays: new Set([6]) },
    });
    expect(r.ok).toBe(true);
  });
});
