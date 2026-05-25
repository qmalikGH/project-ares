// Sprint v1.6: Tests for materializeWorkouts() utility.
//
// These are unit-level tests that mock the db client. They verify:
//  - Workout rows are created from WeeklyPlan.plannedSessions
//  - Completed/skipped workouts are NOT overwritten
//  - Orphaned planned workouts are deleted
//  - Rest sessions are skipped
//  - Date boundaries are respected
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- DB mock (hoisted so vi.mock factory can reference them) ----
const findManyWeeklyPlan = vi.hoisted(() => vi.fn());
const findUniqueWorkout = vi.hoisted(() => vi.fn());
const findManyWorkout = vi.hoisted(() => vi.fn());
const createWorkout = vi.hoisted(() => vi.fn());
const updateWorkout = vi.hoisted(() => vi.fn());
const deleteManyWorkout = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    weeklyPlan: { findMany: findManyWeeklyPlan },
    workout: {
      findUnique: findUniqueWorkout,
      findMany: findManyWorkout,
      create: createWorkout,
      update: updateWorkout,
      deleteMany: deleteManyWorkout,
    },
  },
}));

import { materializeWorkouts } from "@/lib/coach-engine/materialize";

// ---- Helpers ----
function makePlan(
  startDate: string,
  endDate: string,
  sessions: Array<{ date: string; type: string }>,
) {
  return {
    id: `wp-${startDate}`,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    plannedSessions: sessions.map((s) => ({
      date: new Date(s.date),
      type: s.type,
      durationMin: 45,
    })),
  };
}

const userId = "user-1";

describe("materializeWorkouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing workouts
    findUniqueWorkout.mockResolvedValue(null);
    findManyWorkout.mockResolvedValue([]);
    createWorkout.mockImplementation(({ data }) => ({
      id: `wk-${data.type}-${data.date}`,
      ...data,
    }));
    deleteManyWorkout.mockResolvedValue({ count: 0 });
  });

  it("creates Workout rows from WeeklyPlan.plannedSessions", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-06-02", type: "easy_run" },
        { date: "2026-06-03", type: "strength_a" },
      ]),
    ]);

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.created).toBe(2);
    expect(createWorkout).toHaveBeenCalledTimes(2);
    expect(createWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          type: "easy_run",
          status: "planned",
        }),
      }),
    );
  });

  it("skips rest sessions", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-06-02", type: "easy_run" },
        { date: "2026-06-03", type: "rest" },
        { date: "2026-06-04", type: "strength_a" },
      ]),
    ]);

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.created).toBe(2); // rest skipped
    expect(createWorkout).toHaveBeenCalledTimes(2);
  });

  it("updates planned workouts without changing status", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-06-02", type: "easy_run" },
      ]),
    ]);
    findUniqueWorkout.mockResolvedValue({
      id: "existing-1",
      status: "planned",
      date: new Date("2026-06-02"),
      type: "easy_run",
    });
    updateWorkout.mockResolvedValue({ id: "existing-1" });

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(updateWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-1" },
        data: expect.objectContaining({
          plannedSession: expect.any(Object),
        }),
      }),
    );
    // Verify status is NOT in the update data
    const updateCall = updateWorkout.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it("does NOT overwrite completed workouts", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-06-02", type: "easy_run" },
      ]),
    ]);
    findUniqueWorkout.mockResolvedValue({
      id: "existing-1",
      status: "completed",
      date: new Date("2026-06-02"),
      type: "easy_run",
    });

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(createWorkout).not.toHaveBeenCalled();
    expect(updateWorkout).not.toHaveBeenCalled();
  });

  it("does NOT overwrite skipped workouts", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-06-02", type: "easy_run" },
      ]),
    ]);
    findUniqueWorkout.mockResolvedValue({
      id: "existing-1",
      status: "skipped",
      date: new Date("2026-06-02"),
      type: "easy_run",
    });

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("deletes orphaned planned workouts not in WeeklyPlan", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-06-02", type: "easy_run" },
      ]),
    ]);
    // The orphan: a planned threshold_run that's no longer in the WeeklyPlan
    findManyWorkout.mockResolvedValue([
      {
        id: "orphan-1",
        status: "planned",
        date: new Date("2026-06-03"),
        type: "threshold_run",
      },
    ]);

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.deleted).toBe(1);
    expect(deleteManyWorkout).toHaveBeenCalledWith({
      where: { id: { in: ["orphan-1"] } },
    });
  });

  it("does NOT delete completed workouts even if not in plan", async () => {
    findManyWeeklyPlan.mockResolvedValue([]);
    // Completed workout — should not be in the orphan query (status=planned filter)
    findManyWorkout.mockResolvedValue([]); // findMany with status:"planned" returns nothing

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.deleted).toBe(0);
  });

  it("handles empty plannedSessions gracefully", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      {
        id: "wp-empty",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-07"),
        plannedSessions: [],
      },
    ]);

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("handles null plannedSessions gracefully", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      {
        id: "wp-null",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-07"),
        plannedSessions: null,
      },
    ]);

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.created).toBe(0);
  });

  it("respects fromDate/toDate boundaries", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-05-31", type: "easy_run" }, // before window
        { date: "2026-06-02", type: "strength_a" }, // in window
        { date: "2026-06-08", type: "long_run" }, // at/after toDate
      ]),
    ]);

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    // Only the in-window session should be created
    expect(result.created).toBe(1);
    expect(createWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "strength_a" }),
      }),
    );
  });

  it("allows same date with different type (two-a-day)", async () => {
    findManyWeeklyPlan.mockResolvedValue([
      makePlan("2026-06-01", "2026-06-07", [
        { date: "2026-06-02", type: "easy_run" },
        { date: "2026-06-02", type: "strength_a" },
      ]),
    ]);

    const result = await materializeWorkouts(
      userId,
      new Date("2026-06-01"),
      new Date("2026-06-08"),
    );

    expect(result.created).toBe(2);
  });
});
