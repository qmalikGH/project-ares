// Unattended session import — Sprint 2.9.
//
// The whole point of this module is that it writes to the database without
// anybody looking. So the tests are mostly about what it REFUSES to do.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutFindMany = vi.hoisted(() => vi.fn());
const workoutUpdate = vi.hoisted(() => vi.fn());
const listActivities = vi.hoisted(() => vi.fn());
const buildRun = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: { workout: { findMany: workoutFindMany, update: workoutUpdate } },
}));
vi.mock("@/lib/garmin/activities", () => ({ listActivitiesForDate: listActivities }));
vi.mock("@/lib/garmin/run-import", () => ({ buildRunImport: buildRun }));

import { autoImportSessionsForDate } from "@/lib/garmin/auto-import";
import type { ActivitySummary } from "@/lib/garmin/activities";

const DATE = new Date("2026-08-28T00:00:00.000Z");

function activity(over: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    activityId: 24151655312,
    activityName: "Berlin - Easy Run 34min",
    startTimeLocal: "2026-08-28 19:57:00",
    startTimeGMT: "2026-08-28 17:57:00",
    category: "run",
    durationSec: 840,
    distanceM: 2600,
    averageHr: 138,
    maxHr: 155,
    averagePaceSecPerKm: 323,
    elevationGainM: 12,
    calories: 190,
    workoutId: 1678569838,
    ...over,
  };
}

function plannedRun(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    date: DATE,
    type: "easy_run",
    garminWorkoutId: "1678569838",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  workoutUpdate.mockResolvedValue({});
  buildRun.mockResolvedValue({
    executedSession: { type: "run", source: "garmin_auto" },
    durationActualMin: 14,
    activityId: "24151655312",
  });
});

describe("identity match — the only thing it acts on", () => {
  it("completes the session when the activity carries our workout id", async () => {
    workoutFindMany.mockResolvedValue([plannedRun()]);
    listActivities.mockResolvedValue([activity()]);

    const r = await autoImportSessionsForDate("u1", DATE);

    expect(r.imported).toHaveLength(1);
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("completed");
    expect(data.garminActivityId).toBe("24151655312");
    expect(data.durationActualMin).toBe(14);
  });

  it("never invents an RPE", async () => {
    workoutFindMany.mockResolvedValue([plannedRun()]);
    listActivities.mockResolvedValue([activity()]);

    await autoImportSessionsForDate("u1", DATE);

    // A fabricated RPE would feed ACWR and the training-max evaluation.
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(Object.prototype.hasOwnProperty.call(data, "rpe")).toBe(false);
  });

  it("stamps the payload garmin_auto so downstream can tell it apart", async () => {
    workoutFindMany.mockResolvedValue([plannedRun()]);
    listActivities.mockResolvedValue([activity()]);
    await autoImportSessionsForDate("u1", DATE);
    expect(buildRun).toHaveBeenCalledWith(24151655312, "garmin_auto");
  });
});

describe("what it refuses to write", () => {
  it("leaves an ad-hoc run alone (no workoutId on the activity)", async () => {
    workoutFindMany.mockResolvedValue([plannedRun()]);
    listActivities.mockResolvedValue([activity({ workoutId: null, activityName: "Berlin Running" })]);

    const r = await autoImportSessionsForDate("u1", DATE);

    expect(workoutUpdate).not.toHaveBeenCalled();
    expect(r.imported).toHaveLength(0);
    expect(r.needsConfirmation).toHaveLength(1);
  });

  it("does not act on a mere same-day, same-category coincidence", async () => {
    // Session was never pushed (no garminWorkoutId) — the old AUTO_MATCH rule
    // would have written this one. That is precisely the case we distrust.
    workoutFindMany.mockResolvedValue([plannedRun({ garminWorkoutId: null })]);
    listActivities.mockResolvedValue([activity()]);

    const r = await autoImportSessionsForDate("u1", DATE);

    expect(workoutUpdate).not.toHaveBeenCalled();
    expect(r.needsConfirmation[0].reason).toContain("no workout-id link");
  });

  it("picks the right run when the athlete also did an ad-hoc one", async () => {
    // Real pattern from 2026-06-25: a planned run plus a second, spontaneous one.
    workoutFindMany.mockResolvedValue([plannedRun()]);
    listActivities.mockResolvedValue([
      activity({ activityId: 999, workoutId: null, activityName: "Berlin Running" }),
      activity(),
    ]);

    const r = await autoImportSessionsForDate("u1", DATE);

    expect(r.imported).toHaveLength(1);
    expect(r.imported[0].activityId).toBe(24151655312);
  });

  it("only ever touches planned rows", async () => {
    workoutFindMany.mockResolvedValue([]);
    listActivities.mockResolvedValue([activity()]);
    await autoImportSessionsForDate("u1", DATE);
    expect(workoutFindMany.mock.calls[0][0].where.status).toBe("planned");
    expect(workoutUpdate).not.toHaveBeenCalled();
  });

  it("survives a Garmin failure without writing anything", async () => {
    workoutFindMany.mockResolvedValue([plannedRun()]);
    listActivities.mockRejectedValue(new Error("garmin 500"));

    const r = await autoImportSessionsForDate("u1", DATE);

    expect(workoutUpdate).not.toHaveBeenCalled();
    expect(r.errors[0]).toContain("garmin 500");
  });

  it("reports a per-session import failure without aborting the rest", async () => {
    workoutFindMany.mockResolvedValue([plannedRun(), plannedRun({ id: "w2" })]);
    listActivities.mockResolvedValue([activity()]);
    buildRun.mockRejectedValueOnce(new Error("detail fetch failed"));

    const r = await autoImportSessionsForDate("u1", DATE);

    expect(r.errors).toHaveLength(1);
    expect(r.imported).toHaveLength(1); // the second one still went through
  });
});
