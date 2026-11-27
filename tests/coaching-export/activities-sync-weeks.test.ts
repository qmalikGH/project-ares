// Sprint 3.4 (#28), Phase A4 — the export's raw activities, sync health and
// planned-vs-done per week. Other sections fall back to their defaults.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutFindMany = vi.hoisted(() => vi.fn());
const activityFindMany = vi.hoisted(() => vi.fn());
const logFindFirst = vi.hoisted(() => vi.fn());
const sensorFindMany = vi.hoisted(() => vi.fn());
const weeklyPlanFindMany = vi.hoisted(() => vi.fn());
const today = vi.hoisted(() => ({ value: new Date("2026-11-27T00:00:00.000Z") }));

vi.mock("@/lib/db/client", () => ({
  db: {
    workout: { findMany: workoutFindMany },
    garminActivity: { findMany: activityFindMany },
    garminSyncLog: { findFirst: logFindFirst },
    dailySensorData: { findMany: sensorFindMany },
    weeklyPlan: { findMany: weeklyPlanFindMany },
  },
}));
vi.mock("@/lib/date", () => ({ userTodayDynamic: async () => today.value }));
vi.mock("@/lib/db/queries/settings", () => ({ getEffectiveVdot: vi.fn(async () => 40) }));

import { buildCoachingExport } from "@/lib/coaching-export/build-export";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const w = (iso: string, type: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `${iso}-${type}`, date: d(iso), type, status,
  plannedSession: { type, durationMin: 30, ...((extra.plan as object) ?? {}) },
  executedSession: null, rpe: null, notes: null, modulations: null,
  durationActualMin: (extra.actualMin as number | undefined) ?? null,
});

beforeEach(() => {
  vi.clearAllMocks();
  weeklyPlanFindMany.mockResolvedValue([]);
  workoutFindMany.mockImplementation(async (args: { where: { status?: string } }) => {
    if (args.where.status) return [];
    return [
      // ISO week 2026-W47 (16.–22.11.)
      w("2026-11-16", "strength_a", "completed"),
      w("2026-11-16", "easy_run", "completed", { actualMin: 22 }),
      w("2026-11-17", "threshold_run", "planned", { plan: { durationMin: 40 } }),
      w("2026-11-19", "strength_b", "planned"),
      w("2026-11-21", "long_run", "completed", { plan: { durationMin: 50 }, actualMin: 45 }),
      // a free run: done, never planned
      w("2026-11-22", "easy_run", "completed", { plan: { durationMin: 18, unplanned: true }, actualMin: 18 }),
      w("2026-11-18", "mobility", "completed"), // home routine — neither run nor strength
    ];
  });
  activityFindMany.mockResolvedValue([
    {
      localDate: d("2026-11-16"), startTimeLocal: "2026-11-16 18:05:00", category: "run",
      garminType: "running", durationSec: 1320, distanceM: 3456, averagePaceSecPerKm: 382,
      averageHr: 140, workoutId: "9001",
      workout: { date: d("2026-11-16"), type: "easy_run", status: "completed" },
    },
    {
      localDate: d("2026-11-20"), startTimeLocal: "2026-11-20 07:10:00", category: "run",
      garminType: "street_running", durationSec: 600, distanceM: null, averagePaceSecPerKm: null,
      averageHr: null, workoutId: null, workout: null,
    },
  ]);
  logFindFirst.mockImplementation(async (args: { where: { status?: unknown; OR?: unknown } }) => {
    if (args.where.OR) {
      return { syncedAt: new Date("2026-11-20T05:01:00.000Z"), errorType: "NETWORK", errorMessage: "hrv: Garmin timeout after 15000 ms: hrv" };
    }
    return { syncedAt: new Date("2026-11-27T05:00:30.000Z"), targetDate: d("2026-11-26") };
  });
  // Watch data on 20.11. and 21.11. only.
  sensorFindMany.mockResolvedValue([
    { date: d("2026-11-20"), garmin: { rhr: 1 } },
    { date: d("2026-11-21"), garmin: { sleepScore: 1 } },
    { date: d("2026-11-25"), garmin: { rhr: null, sleepScore: null } },
  ]);
});

describe("trainingHistory.weeks", () => {
  it("counts planned and done runs and strength per ISO week; free runs are done, not planned", async () => {
    const { trainingHistory } = await buildCoachingExport("u1");
    expect(trainingHistory.weeks).toEqual([
      {
        week: "2026-W47",
        plannedRuns: 3,
        runsDone: 3,
        plannedRunMin: 30 + 40 + 50,
        runMinDone: 22 + 45 + 18,
        plannedStrength: 2,
        strengthDone: 1,
      },
    ]);
  });
});

describe("activities", () => {
  it("lists every activity of the last 28 days, linked or raw only", async () => {
    const { activities } = await buildCoachingExport("u1");
    expect(activityFindMany.mock.calls[0][0].where.localDate.gte).toEqual(d("2026-10-30"));
    expect(activities.days).toBe(28);
    expect(activities.items).toEqual([
      {
        date: "2026-11-16", startTimeLocal: "2026-11-16 18:05:00", category: "run", garminType: "running",
        durationMin: 22, distanceKm: 3.5, pace: "6:22", averageHr: 140, fromPushedWorkout: true,
        linkedSession: { date: "2026-11-16", type: "easy_run", status: "completed" },
      },
      {
        date: "2026-11-20", startTimeLocal: "2026-11-20 07:10:00", category: "run", garminType: "street_running",
        durationMin: 10, distanceKm: null, pace: null, averageHr: null, fromPushedWorkout: false,
        linkedSession: null,
      },
    ]);
  });
});

describe("sync", () => {
  it("shows the last good sync, the days without watch data and the last error", async () => {
    const { sync } = await buildCoachingExport("u1");
    expect(sync.lastSuccessfulSyncAt).toBe("2026-11-27T05:00:30.000Z");
    expect(sync.lastSyncedDay).toBe("2026-11-26");
    // 14 days up to yesterday (13.11.–26.11.), watch data only on 20. and 21.
    expect(sync.daysWithoutGarminData).toHaveLength(12);
    expect(sync.daysWithoutGarminData).not.toContain("2026-11-20");
    expect(sync.daysWithoutGarminData[0]).toBe("2026-11-13");
    expect(sync.missingDataStreak).toBe(5); // 22.–26.11.
    expect(sync.missingDataAlert).toBe(true);
    expect(sync.lastError).toEqual({
      at: "2026-11-20T05:01:00.000Z", type: "NETWORK", message: "hrv: Garmin timeout after 15000 ms: hrv",
    });
  });

  it("falls back to an empty section when the store is unavailable", async () => {
    logFindFirst.mockRejectedValue(new Error("db down"));
    const { sync } = await buildCoachingExport("u1");
    expect(sync).toMatchObject({ lastSuccessfulSyncAt: null, missingDataAlert: false });
  });
});
