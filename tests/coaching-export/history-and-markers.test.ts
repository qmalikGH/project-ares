// Sprint 3.3 (C2/C3/C4) — the export's compliance, week numbers and hrRest
// provenance, against a mocked DB. Other sections fall back to their defaults.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutFindMany = vi.hoisted(() => vi.fn());
const macroFindFirst = vi.hoisted(() => vi.fn());
const settingsFindUnique = vi.hoisted(() => vi.fn());
const sensorFindMany = vi.hoisted(() => vi.fn());
const weeklyPlanFindMany = vi.hoisted(() => vi.fn());
const today = vi.hoisted(() => ({ value: new Date("2026-10-20T00:00:00.000Z") }));

vi.mock("@/lib/db/client", () => ({
  db: {
    workout: { findMany: workoutFindMany },
    macrocycle: { findFirst: macroFindFirst },
    userSettings: { findUnique: settingsFindUnique },
    dailySensorData: { findMany: sensorFindMany },
    weeklyPlan: { findMany: weeklyPlanFindMany },
  },
}));
vi.mock("@/lib/date", () => ({ userTodayDynamic: async () => today.value }));
vi.mock("@/lib/db/queries/settings", () => ({ getEffectiveVdot: vi.fn(async () => 40) }));

import { buildCoachingExport } from "@/lib/coaching-export/build-export";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const w = (iso: string, type: string, status: string) => ({
  id: `${iso}-${type}`, date: d(iso), type, status, plannedSession: { type }, executedSession: null,
  rpe: null, notes: null, modulations: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  today.value = d("2026-10-20");
  workoutFindMany.mockImplementation(async (args: { where: { status?: string } ; select?: Record<string, boolean> }) => {
    if (args.where.status === "completed" && args.select?.date) {
      // completed history for the layoff gaps: a 34-day break 01.09. → 05.10.
      return [{ date: d("2026-09-01") }, { date: d("2026-10-05") }, { date: d("2026-10-06") }];
    }
    if (args.where.status) return [];
    return [
      w("2026-09-28", "easy_run", "skipped"), // inside the break → not "missed"
      w("2026-10-05", "strength_a", "completed"),
      w("2026-10-06", "easy_run", "completed"),
      w("2026-10-07", "mobility", "planned"), // home routine — not training
      w("2026-10-08", "easy_run", "planned"),
      w("2026-10-13", "easy_run", "skipped"),
    ];
  });
  macroFindFirst.mockResolvedValue({
    id: "m1",
    startDate: d("2026-04-27"),
    endDate: d("2027-05-17"),
    totalWeeks: 55,
    status: "active",
    goal: { primaryType: "5k_time", targetValue: { time: "22:00" } },
    phases: [{
      blockNumber: 2, name: "B2", startDate: d("2026-08-10"), plannedEndDate: d("2026-11-30"), durationWeeks: 15,
      config: { volumeProgression: "linear_increase", strengthMode: "linear_progression", strengthRpeCap: 8, vdotTarget: 43 },
      weeklyPlans: [
        { weekNumber: 5, startDate: d("2026-10-05"), endDate: d("2026-10-12") },
        { weekNumber: 7, startDate: d("2026-10-19"), endDate: d("2026-10-26") },
      ],
    }],
  });
  settingsFindUnique.mockResolvedValue({
    hrMax: 190, hrRest: 60, hrZonesSource: "garmin_rolling_28d", hrZonesUpdatedAt: d("2026-09-22"),
    exerciseMaxEstimates: null, vdotOverrideAt: null, exerciseMaxUpdatedAt: null,
  });
  sensorFindMany.mockResolvedValue([{ garmin: { rhr: 58 } }, { garmin: { rhr: 59 } }, { garmin: {} }, { garmin: null }]);
  weeklyPlanFindMany.mockResolvedValue([]);
});

describe("trainingHistory.last28Days (C2)", () => {
  it("only reads up to today", async () => {
    await buildCoachingExport("u1");
    const historyCall = workoutFindMany.mock.calls.find((c) => !c[0].where.status)![0];
    expect(historyCall.where.date.lte).toEqual(d("2026-10-20"));
  });

  it("leaves sessions inside a closed layoff gap and the home routine out of the rate", async () => {
    const { trainingHistory } = await buildCoachingExport("u1");
    expect(trainingHistory.last28Days).toMatchObject({
      completed: 2,
      skipped: 1,
      excludedInLayoff: 1,
    });
  });

  it("past and never confirmed counts as missed, in the rate (3.3b #25 · 1)", async () => {
    const { trainingHistory } = await buildCoachingExport("u1");
    // 08.10. is still "planned" on 20.10.: not done → 2 of 4.
    expect(trainingHistory.last28Days).toMatchObject({ planned: 0, missed: 1, complianceRate: 50 });
  });

  it("an open gap does not swallow the sessions missed in it", async () => {
    // Nothing completed since 06.10. — on 28.10. that is an open 22-day gap.
    today.value = d("2026-10-28");
    const { trainingHistory } = await buildCoachingExport("u1");
    expect(trainingHistory.last28Days).toMatchObject({
      completed: 2, skipped: 1, missed: 1, excludedInLayoff: 1, complianceRate: 50,
    });
  });

  it("reports since the restart after the latest layoff, missed included", async () => {
    const { trainingHistory } = await buildCoachingExport("u1");
    expect(trainingHistory.last28Days.sinceRestart).toEqual({
      restartWeekStart: "2026-10-05", completed: 2, skipped: 1, missed: 1, rate: 50,
    });
  });

  it("counts the home routine per week on its own (A4)", async () => {
    const { trainingHistory } = await buildCoachingExport("u1");
    expect(trainingHistory.volumeTrends.weeklyPrevention).toEqual([
      { week: expect.any(String), prevention: { done: 0, planned: 1 } },
    ]);
  });

  it("takes the planned home routine from the week plan through the end of this week (3.3b #25 · 5)", async () => {
    weeklyPlanFindMany.mockResolvedValue([
      {
        plannedSessions: [
          { date: "2026-10-07T00:00:00.000Z", type: "mobility" }, // also a Workout row → once
          { date: "2026-10-21T00:00:00.000Z", type: "mobility" }, // ahead, this week
          { date: "2026-10-23T00:00:00.000Z", type: "mobility" },
          { date: "2026-10-28T00:00:00.000Z", type: "mobility" }, // next week → out
          { date: "2026-10-20T00:00:00.000Z", type: "strength_a" },
        ],
      },
    ]);
    const { trainingHistory } = await buildCoachingExport("u1");
    const weeks = trainingHistory.volumeTrends.weeklyPrevention;
    expect(weeks).toHaveLength(2);
    expect(weeks[0].prevention).toEqual({ done: 0, planned: 1 });
    expect(weeks[1].prevention).toEqual({ done: 0, planned: 2 });
    expect(weeklyPlanFindMany.mock.calls[0][0].where.startDate.lte).toEqual(d("2026-10-25"));
  });
});

describe("upcoming (3.3b #25 · 3/4)", () => {
  it("carries loadKg, the back-off flag and activationMin like the history", async () => {
    const macro = await macroFindFirst();
    macro.phases[0].weeklyPlans[1].plannedSessions = [
      {
        date: "2026-10-20T00:00:00.000Z",
        type: "strength_a",
        exercises: [
          { name: "Deadlift", sets: 3, reps: 5, loadPct: 82, loadAbs: 70 },
          { name: "Deadlift", sets: 2, reps: 5, loadPct: 72, loadAbs: 62.5, isBackoff: true },
        ],
      },
      { date: "2026-10-21T00:00:00.000Z", type: "threshold", durationMin: 36, activationMin: 5 },
    ];
    macroFindFirst.mockResolvedValue(macro);
    const { upcoming } = await buildCoachingExport("u1");
    const [strength, threshold] = upcoming.sessions;
    expect(strength.planned.exercises).toEqual([
      expect.objectContaining({ name: "Deadlift", loadKg: 70 }),
      expect.objectContaining({ name: "Deadlift", loadKg: 62.5, isBackoff: true }),
    ]);
    expect(strength.planned.exercises![0].isBackoff).toBeUndefined();
    expect(threshold.planned).toMatchObject({ durationMin: 36, activationMin: 5 });
  });
});

describe("periodization.macrocycle (C3)", () => {
  it("separates the training week from the calendar week", async () => {
    const { periodization } = await buildCoachingExport("u1");
    expect(periodization!.macrocycle).toMatchObject({ trainingWeek: 7, currentWeek: 7, calendarWeek: 26 });
  });
});

describe("performanceMarkers.hrRestSource (C4)", () => {
  it("shows method, live window and whether it was enough to recalibrate", async () => {
    const { performanceMarkers } = await buildCoachingExport("u1");
    expect(performanceMarkers!.hrRestSource).toEqual({
      method: "garmin_rolling_28d",
      samples: 2,
      windowStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      windowSufficient: false,
      computedAt: "2026-09-22T00:00:00.000Z",
    });
  });

  it("never set → method default", async () => {
    settingsFindUnique.mockResolvedValueOnce({
      hrMax: null, hrRest: null, hrZonesSource: null, hrZonesUpdatedAt: null,
      exerciseMaxEstimates: null, vdotOverrideAt: null, exerciseMaxUpdatedAt: null,
    });
    const { performanceMarkers } = await buildCoachingExport("u1");
    expect(performanceMarkers!.hrRestSource!.method).toBe("default");
  });
});
