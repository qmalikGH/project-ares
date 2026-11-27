// POST /api/sessions/complete — Review fix (#28, point 5): the wizard keeps
// GarminActivity.workoutRefId in step, linking and releasing in the same
// transaction as the session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutFindFirst = vi.hoisted(() => vi.fn());
const workoutUpdate = vi.hoisted(() => vi.fn());
const activityUpdateMany = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const buildRunImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    workout: { findFirst: workoutFindFirst, update: workoutUpdate },
    garminActivity: { updateMany: activityUpdateMany },
    dailySensorData: { findFirst: vi.fn(async () => null) },
    $transaction: transaction,
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUserId: vi.fn(async () => "u1") }));
vi.mock("@/lib/date", () => ({ userTodayDynamic: vi.fn(async () => new Date("2026-11-27T00:00:00.000Z")) }));
vi.mock("@/lib/garmin/run-import", () => ({ buildRunImport }));
vi.mock("@/lib/db/queries/exercise-log-write", () => ({
  buildExerciseLogRows: vi.fn(() => []),
  replaceExerciseLogsForWorkout: vi.fn(),
  resolveWeekInBlockSnapshot: vi.fn(async () => ({ weekInBlock: 1, isDeload: false })),
}));
vi.mock("@/lib/db/queries/settings", () => ({ getEffectiveVdot: vi.fn(async () => 40) }));
vi.mock("@/lib/db/queries/regenerate", () => ({ regenerateFutureSessionPaces: vi.fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn() }));

import { POST } from "@/app/api/sessions/complete/route";

function post(body: unknown) {
  return new Request("https://x/api/sessions/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function workout(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    userId: "u1",
    date: new Date("2026-11-27T00:00:00.000Z"),
    type: "easy_run",
    status: "in_progress",
    plannedSession: { type: "easy_run", durationMin: 30 },
    garminActivityId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  workoutUpdate.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id, type: "easy_run" }));
  activityUpdateMany.mockImplementation(async (args: unknown) => args);
  transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  buildRunImport.mockResolvedValue({
    executedSession: { type: "run", source: "garmin_import", durationSec: 1500 },
    durationActualMin: 25,
    activityId: "777",
  });
});

describe("POST /api/sessions/complete — raw store link", () => {
  it("links the picked activity, in one transaction with the session", async () => {
    workoutFindFirst.mockResolvedValue(workout());
    const res = await POST(post({ workoutId: "w1", rpe: 4, garminActivityId: 777 }));
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(activityUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", activityId: "777" },
      data: { workoutRefId: "w1" },
    });
  });

  it("releases the previous activity when another one replaces it", async () => {
    workoutFindFirst.mockResolvedValue(workout({ garminActivityId: "555" }));
    await POST(post({ workoutId: "w1", rpe: 4, garminActivityId: 777 }));
    expect(activityUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", activityId: "555" },
      data: { workoutRefId: null },
    });
    expect(activityUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", activityId: "777" },
      data: { workoutRefId: "w1" },
    });
  });

  it("releases it when a manual completion drops the link", async () => {
    workoutFindFirst.mockResolvedValue(workout({ garminActivityId: "555" }));
    await POST(post({ workoutId: "w1", rpe: 4, durationActualMin: 20 }));
    expect(workoutUpdate.mock.calls[0][0].data.garminActivityId).toBeNull();
    expect(activityUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", activityId: "555" },
      data: { workoutRefId: null },
    });
  });

  it("touches nothing in the store without any activity", async () => {
    workoutFindFirst.mockResolvedValue(workout());
    await POST(post({ workoutId: "w1", rpe: 4, durationActualMin: 20 }));
    expect(transaction).not.toHaveBeenCalled();
    expect(activityUpdateMany).not.toHaveBeenCalled();
    expect(workoutUpdate).toHaveBeenCalledTimes(1);
  });
});
