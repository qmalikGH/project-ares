// Sprint 3.3 (B1) — the evening refresh: regenerate this week + next, then
// replace exactly the already-pushed workouts whose plan changed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutFindMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/client", () => ({ db: { workout: { findMany: workoutFindMany } } }));
vi.mock("@/lib/db/queries/regenerate-plans", () => ({ regeneratePlansFromNow: vi.fn() }));
vi.mock("@/lib/garmin/workout-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/garmin/workout-sync")>()),
  pushWorkoutToGarmin: vi.fn(),
  removeWorkoutFromGarmin: vi.fn(),
}));

import { refreshUpcomingPlan, type PlanRefreshDeps } from "@/lib/garmin/plan-refresh";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const easy = (min: number) => ({ type: "easy_run", durationMin: min });

function deps() {
  return {
    regenerate: vi.fn().mockResolvedValue({ regenerated: 2 }),
    materialize: vi.fn().mockResolvedValue({ created: 0, updated: 3, deleted: 0 }),
    push: vi.fn().mockResolvedValue({ pushed: true }),
    remove: vi.fn().mockResolvedValue({ removed: true }),
  };
}
const asDeps = (dp: ReturnType<typeof deps>) => dp as unknown as PlanRefreshDeps;

beforeEach(() => vi.clearAllMocks());

describe("refreshUpcomingPlan", () => {
  it("re-pushes only previously pushed workouts whose plannedSession changed", async () => {
    // Before: three workouts on the watch.
    workoutFindMany.mockResolvedValueOnce([
      { id: "a", plannedSession: easy(30) },
      { id: "b", plannedSession: easy(30) },
      { id: "c", plannedSession: easy(30) },
    ]);
    // After regeneration: a unchanged, b shortened by the cap, c unchanged,
    // d new (never pushed — tomorrow's loop or a later evening handles it).
    workoutFindMany.mockResolvedValueOnce([
      { id: "a", date: d("2026-10-30"), plannedSession: easy(30) },
      { id: "b", date: d("2026-10-31"), plannedSession: easy(26) },
      { id: "c", date: d("2026-11-02"), plannedSession: easy(30) },
      { id: "d", date: d("2026-11-03"), plannedSession: easy(20) },
    ]);
    const dp = deps();

    const r = await refreshUpcomingPlan("u1", d("2026-10-29"), vdotToPaces(35), asDeps(dp));

    expect(dp.regenerate).toHaveBeenCalledWith("u1", { horizonWeeks: 2 });
    expect(dp.push).toHaveBeenCalledTimes(1);
    expect(dp.push.mock.calls[0][0]).toBe("b");
    expect(r.repushed).toBe(1);
  });

  it("materializes tomorrow … end of next week and cleans orphans off the watch", async () => {
    workoutFindMany.mockResolvedValue([]);
    const dp = deps();
    // Tomorrow = Thursday 29.10. → window ends Monday 09.11. (exclusive).
    await refreshUpcomingPlan("u1", d("2026-10-29"), vdotToPaces(35), asDeps(dp));
    const [, from, to, opts] = dp.materialize.mock.calls[0];
    expect(from).toEqual(d("2026-10-29"));
    expect(to).toEqual(d("2026-11-09"));
    expect(opts.removeFromGarmin).toBe(dp.remove);
  });

  it("on Sunday evening, tomorrow's whole week is inside the window", async () => {
    workoutFindMany.mockResolvedValue([]);
    const dp = deps();
    // Tomorrow = Monday 02.11. (the push the coach named) → window ends 09.11.
    await refreshUpcomingPlan("u1", d("2026-11-02"), vdotToPaces(35), asDeps(dp));
    expect(dp.materialize.mock.calls[0][2]).toEqual(d("2026-11-09"));
  });
});
