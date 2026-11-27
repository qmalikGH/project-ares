// getRecentDailyLoads' pure core — Sprint 3.2a.
//
// The planned duration may stand in for an unknown one HERE and nowhere else:
// ACWR needs a load for a session confirmed without watch data, but the
// Workout.durationActualMin column must say "unknown" for it.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));

import { dailyLoadsFrom } from "@/lib/db/queries/sensors";

const D = new Date("2026-10-05T00:00:00.000Z");

describe("dailyLoadsFrom", () => {
  it("uses the measured duration when there is one", () => {
    expect(
      dailyLoadsFrom([{ date: D, rpe: 4, durationActualMin: 13, plannedSession: { durationMin: 30 } }]),
    ).toEqual([{ date: D, load: 52 }]);
  });

  it("falls back to the plan only when no actual duration exists", () => {
    expect(
      dailyLoadsFrom([{ date: D, rpe: 7, durationActualMin: null, plannedSession: { durationMin: 30 } }]),
    ).toEqual([{ date: D, load: 210 }]);
  });

  // Sprint 3.4 (#28, C2): an unrated session with HR zones has a load.
  it("derives an unrated session's load from its HR zones (RPE equivalents)", () => {
    const executedSession = {
      garminHrZones: { zone1Sec: 600, zone2Sec: 1200, zone3Sec: 300, zone4Sec: 0, zone5Sec: 0, zoneFloors: {} },
    };
    // 10 min × 2 + 20 min × 3 + 5 min × 5 = 105
    expect(
      dailyLoadsFrom([{ date: D, rpe: null, durationActualMin: 35, plannedSession: null, executedSession }]),
    ).toEqual([{ date: D, load: 105 }]);
  });

  it("prefers the athlete's RPE over the zones", () => {
    const executedSession = { garminHrZones: { zone1Sec: 0, zone2Sec: 0, zone3Sec: 0, zone4Sec: 0, zone5Sec: 1800 } };
    expect(
      dailyLoadsFrom([{ date: D, rpe: 3, durationActualMin: 30, plannedSession: null, executedSession }]),
    ).toEqual([{ date: D, load: 90 }]);
  });

  it("drops rows with neither — and rows without an RPE or HR zones", () => {
    expect(
      dailyLoadsFrom([
        { date: D, rpe: 7, durationActualMin: null, plannedSession: null },
        { date: D, rpe: null, durationActualMin: 40, plannedSession: { durationMin: 40 } },
      ]),
    ).toEqual([]);
  });
});
