// Sprint 3.3 — regeneratePlansFromNow drives the run progression: real minutes
// only, history from before the week, projection from today on.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";
import type { SessionPlan } from "@/lib/coach-engine/types";

const weeklyPlanFindMany = vi.hoisted(() => vi.fn());
const weeklyPlanUpdate = vi.hoisted(() => vi.fn());
const workoutFindMany = vi.hoisted(() => vi.fn());
const workoutFindFirst = vi.hoisted(() => vi.fn());
const settingsFindUnique = vi.hoisted(() => vi.fn());
const sensorFindMany = vi.hoisted(() => vi.fn());
const shinReportFindMany = vi.hoisted(() => vi.fn());
const activityFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    weeklyPlan: { findMany: weeklyPlanFindMany, update: weeklyPlanUpdate },
    workout: { findMany: workoutFindMany, findFirst: workoutFindFirst },
    userSettings: { findUnique: settingsFindUnique },
    dailySensorData: { findMany: sensorFindMany },
    shinReport: { findMany: shinReportFindMany },
    garminActivity: { findMany: activityFindMany },
  },
}));
const today = vi.hoisted(() => ({ value: new Date("2026-10-28T00:00:00.000Z") }));
vi.mock("@/lib/date", () => ({ userToday: () => today.value }));
vi.mock("@/lib/db/queries/settings", () => ({ getEffectiveVdot: vi.fn(async () => 35) }));
vi.mock("@/lib/garmin/workout-sync", () => ({ resyncFutureWorkoutsToGarmin: vi.fn() }));

import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const week = (start: string, weekNumber: number) => ({
  id: `wp-${weekNumber}`,
  weekNumber,
  startDate: d(start),
  endDate: new Date(d(start).getTime() + 7 * 86400000),
  loadOverrideWeek: null,
  phase: { config: BLOCK_CONFIGS[2] },
});

/** The plan written for a week, by WeeklyPlan id. */
function written(id: string): SessionPlan[] {
  const call = weeklyPlanUpdate.mock.calls.find((c) => c[0].where.id === id);
  return call![0].data.plannedSessions as SessionPlan[];
}

beforeEach(() => {
  vi.clearAllMocks();
  today.value = d("2026-10-28");
  // B2 deload (26.10., today is Wed 28.10.), then W1 and W2 of the next cycle.
  weeklyPlanFindMany.mockResolvedValue([week("2026-10-26", 8), week("2026-11-02", 9), week("2026-11-09", 10)]);
  weeklyPlanUpdate.mockResolvedValue({});
  settingsFindUnique.mockResolvedValue({
    forcedRestDays: [3, 7], preferredLongRunDay: 6, hrMax: 190, hrRest: 60,
    exerciseMaxEstimates: null, therapyPhaseOverride: null, garminWorkoutPushEnabled: false,
  });
  sensorFindMany.mockResolvedValue([]);
  shinReportFindMany.mockResolvedValue([]);
  activityFindMany.mockResolvedValue([]);
  workoutFindFirst.mockResolvedValue(null);
  workoutFindMany.mockImplementation(async (args: { select?: Record<string, boolean> }) => {
    const sel = args.select ?? {};
    if (sel.durationActualMin) {
      // The run history the progression reads.
      return [
        { date: d("2026-10-24"), type: "long_run", durationActualMin: 40, plannedSession: { type: "long_run" } },
        {
          date: d("2026-10-22"), type: "threshold_run", durationActualMin: 40,
          plannedSession: { type: "threshold_run", structure: { warmupMin: 10, workIntervals: [{ repeats: 3, durationMin: 8, restMin: 2 }] } },
        },
        // Confirmed without minutes (Sprint 3.2a estimate) — no evidence.
        { date: d("2026-10-25"), type: "long_run", durationActualMin: null, plannedSession: { type: "long_run", durationMin: 90 } },
      ];
    }
    if (sel.rpe) return []; // shin signal: nothing rated → imminent week on hold
    return [{ date: d("2026-10-20") }, { date: d("2026-10-24") }]; // no layoff
  });
});

describe("regeneratePlansFromNow — run progression", () => {
  it("caps from measured minutes only (40 → 44), ignoring a run confirmed without minutes", async () => {
    const r = await regeneratePlansFromNow("u1");
    // 26.10. is a deload week: 0.75 × 44 (3.3b #25 · 2).
    expect(r.progression[0]).toMatchObject({ weekStart: "2026-10-26", capMin: 33, thresholdIndex: 2 });
    expect(r.progression[1]).toMatchObject({ weekStart: "2026-11-02", capMin: 44 });
  });

  it("a deload week keeps every run under 0.75 × the cap, the cap does not climb over it", async () => {
    const r = await regeneratePlansFromNow("u1");
    for (const s of written("wp-8")) {
      if (s.type !== "rest" && !s.type.startsWith("strength")) expect(s.durationMin ?? 0).toBeLessThanOrEqual(33);
    }
    // The deload long run (33) adds nothing: week 9 still sees the 40 from before.
    expect(r.progression[1].capMin).toBe(44);
  });

  it("the deload threshold that does not fit under 0.75 × the cap becomes an easy run (#21 example)", async () => {
    workoutFindMany.mockImplementation(async (args: { select?: Record<string, boolean> }) => {
      const sel = args.select ?? {};
      if (sel.durationActualMin) {
        return [{ date: d("2026-10-24"), type: "long_run", durationActualMin: 30, plannedSession: { type: "long_run" } }];
      }
      if (sel.rpe) return [];
      return [{ date: d("2026-10-20") }, { date: d("2026-10-24") }];
    });
    const r = await regeneratePlansFromNow("u1");
    // Cap 33 → deload 24; 2×8 needs 30.
    expect(r.progression[0].capMin).toBe(24);
    const tuesday = written("wp-8").find((s) => new Date(s.date).toISOString().startsWith("2026-10-27"))!;
    expect(tuesday.type).toBe("easy_run");
    expect(tuesday.notes).toContain("Threshold 2×8 pausiert");
  });

  it("the next cycle's threshold steps down to what fits under the cap", async () => {
    const r = await regeneratePlansFromNow("u1");
    // The deload stays under 33, so week 9's cap is still 44 from the 40-min
    // runs before it. History earned L2 (3×10/3 = 49 min), which does not
    // fit → L1 (3×8/2 = 40).
    expect(r.progression[1]).toMatchObject({ weekStart: "2026-11-02", capMin: 44, thresholdIndex: 2 });
    const t = written("wp-9").find((s) => s.type === "threshold_run")!;
    expect(t.structure!.workIntervals![0]).toMatchObject({ repeats: 3, durationMin: 8 });
    // Block 2's 60-min long run is held at the cap.
    expect(written("wp-9").find((s) => s.type === "long_run")!.durationMin).toBe(44);
  });

  it("projects planned runs from today on, so the cap climbs week by week", async () => {
    const r = await regeneratePlansFromNow("u1");
    // Week 9's long run (44) counts as done for week 10 → 48.
    expect(r.progression[2]).toMatchObject({ weekStart: "2026-11-09", capMin: 48 });
    for (const id of ["wp-8", "wp-9", "wp-10"]) {
      const cap = r.progression[["wp-8", "wp-9", "wp-10"].indexOf(id)].capMin;
      for (const s of written(id)) {
        if (s.type !== "rest" && !s.type.startsWith("strength")) expect(s.durationMin ?? 0).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("a past session nobody confirmed is not projected — no data, no progress", async () => {
    // Sunday 01.11.: Saturday's 44-min long run is past and unconfirmed.
    today.value = d("2026-11-01");
    const r = await regeneratePlansFromNow("u1");
    expect(r.progression[1]).toMatchObject({ weekStart: "2026-11-02", capMin: 44 });
  });

  // Sprint 3.3 (A4): ticking off the home routine must neither hide a layoff
  // nor count as a rated session for the volume gate.
  it("leaves the home prevention routine out of the layoff and shin queries", async () => {
    await regeneratePlansFromNow("u1");
    const calls = workoutFindMany.mock.calls.map((c) => c[0] as { select: Record<string, boolean>; where: { NOT?: { type: { in: string[] } } } });
    const layoff = calls.find((c) => Object.keys(c.select).join() === "date,type")!;
    const shin = calls.find((c) => c.select.rpe)!;
    expect(layoff.where.NOT?.type.in).toContain("mobility");
    expect(shin.where.NOT?.type.in).toContain("mobility");
  });

  it("puts the prevention routine on the forced rest days", async () => {
    settingsFindUnique.mockResolvedValueOnce({
      forcedRestDays: [3, 5, 7], preferredLongRunDay: 6, hrMax: 190, hrRest: 60,
      exerciseMaxEstimates: null, therapyPhaseOverride: null, garminWorkoutPushEnabled: false,
      preventionExercises: ["Tibialis Anterior Raises"],
    });
    await regeneratePlansFromNow("u1");
    const days = written("wp-9")
      .filter((s) => s.type === "mobility")
      .map((s) => new Date(s.date).getUTCDay());
    expect(days).toEqual([3, 5, 0]);
  });

  it("horizonWeeks limits the regenerated weeks", async () => {
    await regeneratePlansFromNow("u1", { horizonWeeks: 2 });
    expect(weeklyPlanFindMany.mock.calls[0][0].take).toBe(2);
  });
});

// Sprint 3.4 (#28, C3): the shin as a weekly signal, from any source.
describe("regeneratePlansFromNow — shin reports", () => {
  it("without any report in 14 days the imminent week stays on hold (2.4 rule)", async () => {
    const r = await regeneratePlansFromNow("u1");
    expect(r.gate).toBe("hold");
  });

  it("a report from the /today card or the coach counts as evidence", async () => {
    shinReportFindMany.mockResolvedValue([{ painNrs: 0 }]);
    const r = await regeneratePlansFromNow("u1");
    expect(r.gate).toBe("progress");
  });

  it("the highest value of the window wins, not the latest", async () => {
    shinReportFindMany.mockResolvedValue([{ painNrs: 0 }, { painNrs: 4 }]);
    const r = await regeneratePlansFromNow("u1");
    expect(r.gate).toBe("regress");
  });

  it("reads 14 days back", async () => {
    await regeneratePlansFromNow("u1");
    const where = shinReportFindMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(d("2026-10-14"));
    expect(where.date.lte).toEqual(d("2026-10-28"));
  });
});

// Sprint 3.4 (#28, C4): a layoff per discipline.
describe("regeneratePlansFromNow — layoff per discipline", () => {
  function history(rows: { date: string; type: string }[]) {
    workoutFindMany.mockImplementation(async (args: { select?: Record<string, boolean> }) => {
      const sel = args.select ?? {};
      if (sel.durationActualMin) return [];
      if (sel.rpe) return [];
      return rows.map((r) => ({ date: d(r.date), type: r.type }));
    });
  }

  it("a strength pause during ongoing running ramps strength only", async () => {
    // Runs every few days up to 24.10.; the last strength session on 01.09.
    history([
      { date: "2026-09-01", type: "strength_a" },
      { date: "2026-10-06", type: "easy_run" },
      { date: "2026-10-13", type: "easy_run" },
      { date: "2026-10-20", type: "easy_run" },
      { date: "2026-10-24", type: "long_run" },
    ]);
    const r = await regeneratePlansFromNow("u1");
    expect(r.layoffByDiscipline.run.active).toBe(false);
    expect(r.layoffByDiscipline.strength.active).toBe(true);
    expect(r.layoffByDiscipline.strength.gapDays).toBeGreaterThanOrEqual(21);
    expect(r.layoff).toEqual(r.layoffByDiscipline.run);
    // The strength week carries the comeback label, the runs do not ramp.
    const strength = written("wp-8").filter((s) => s.type.startsWith("strength"));
    expect(strength.length).toBeGreaterThan(0);
    expect(JSON.stringify(strength)).toContain("Wiedereinstieg");
  });

  it("a run pause during ongoing strength ramps running only", async () => {
    history([
      { date: "2026-09-20", type: "easy_run" },
      { date: "2026-10-12", type: "strength_a" },
      { date: "2026-10-19", type: "strength_b" },
      { date: "2026-10-26", type: "strength_a" },
    ]);
    const r = await regeneratePlansFromNow("u1");
    expect(r.layoffByDiscipline.run.active).toBe(true);
    expect(r.layoffByDiscipline.strength.active).toBe(false);
    expect(r.layoff.active).toBe(true);
  });

  // Coach, 27.11. (#28 b): ad-hoc strength the watch recorded counts.
  it("weekly ad-hoc strength recordings (≥ 20 min, unlinked) keep the strength ramp away", async () => {
    // The last strength SESSION was on 01.10.; since then the watch recorded
    // gym visits that no session took.
    history([
      { date: "2026-10-01", type: "strength_a" },
      { date: "2026-10-20", type: "easy_run" },
      { date: "2026-10-24", type: "long_run" },
    ]);
    // Without them: 27 days → strength ramp.
    expect((await regeneratePlansFromNow("u1")).layoffByDiscipline.strength.active).toBe(true);

    activityFindMany.mockResolvedValue([
      { localDate: d("2026-10-08") },
      { localDate: d("2026-10-15") },
      { localDate: d("2026-10-22") },
    ]);
    const r = await regeneratePlansFromNow("u1");
    expect(r.layoffByDiscipline.strength.active).toBe(false);
    const where = activityFindMany.mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({ category: "strength", workoutRefId: null, durationSec: { gte: 1200 } });
  });

  it("a discipline without any history falls back to the global result", async () => {
    history([
      { date: "2026-10-20", type: "strength_a" },
      { date: "2026-10-26", type: "strength_b" },
    ]);
    const r = await regeneratePlansFromNow("u1");
    // No run ever: the global history has no gap → no ramp, as before.
    expect(r.layoffByDiscipline.run.active).toBe(false);
  });
});
