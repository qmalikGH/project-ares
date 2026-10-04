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

  it("drops rows with neither — and rows without an RPE", () => {
    expect(
      dailyLoadsFrom([
        { date: D, rpe: 7, durationActualMin: null, plannedSession: null },
        { date: D, rpe: null, durationActualMin: 40, plannedSession: { durationMin: 40 } },
      ]),
    ).toEqual([]);
  });
});
