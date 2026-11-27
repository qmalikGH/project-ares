// Review fix (#28, point 2): the daily cron with a Garmin that never answers.
//
// The goal of Sprint 3.4 was "no abort without a log". With a hanging Garmin
// the function used to run past maxDuration (60 s): a 30-s login per step, no
// budget check in the daily sync, a detail loop that took the next run after
// every timeout. Here nothing is mocked between the route and the Garmin
// library — only the library itself, which never answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logCreate = vi.hoisted(() => vi.fn());
const logFindMany = vi.hoisted(() => vi.fn());
const notificationCreate = vi.hoisted(() => vi.fn());
const loginCalls = vi.hoisted(() => ({ n: 0 }));

vi.mock("garmin-connect", () => {
  const never = () => new Promise(() => {});
  class GarminConnect {
    login() {
      loginCalls.n++;
      return never();
    }
    getActivities() {
      return never();
    }
    getSleepData() {
      return never();
    }
    getHeartRate() {
      return never();
    }
    getUserProfile() {
      return never();
    }
  }
  return { GarminConnect };
});

vi.mock("@/lib/db/client", () => {
  const db = {
    user: { findMany: vi.fn(async () => [{ id: "user_1" }]) },
    garminSyncLog: { create: logCreate, findMany: logFindMany, findFirst: vi.fn(async () => null) },
    garminActivity: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    dailySensorData: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      create: vi.fn(),
    },
    workout: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    notification: { findFirst: vi.fn(async () => null), create: notificationCreate },
    mealPlan: { findFirst: vi.fn(async () => ({ calibratedAt: new Date() })) },
    userSettings: { findUnique: vi.fn(async () => ({ hrZonesUpdatedAt: new Date(), vdotOverrideAt: new Date() })) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});
vi.mock("@/lib/date", () => ({
  userTodayForUser: vi.fn(async () => new Date("2026-11-27T00:00:00.000Z")),
  toUserDateString: (d: Date) => d.toISOString().slice(0, 10),
}));
vi.mock("@/lib/nutrition/calibration", () => ({ calibrateMealPlan: vi.fn() }));
vi.mock("@/lib/coach-engine/hr-calibration", () => ({ recalibrateHrRest: vi.fn() }));
vi.mock("@/lib/coach-engine/vdot-recalibration", () => ({ recalibrateVdot: vi.fn() }));
vi.mock("@/lib/garmin/plan-refresh", () => ({ refreshAfterImport: vi.fn() }));

import { GET } from "@/app/api/cron/garmin-sync-daily/route";

const SECRET = "test-cron-secret";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.CRON_SECRET = SECRET;
  process.env.GARMIN_USERNAME = "user";
  process.env.GARMIN_PASSWORD = "pass";
  logCreate.mockResolvedValue({ id: "log_1" });
  logFindMany.mockResolvedValue([]);
  notificationCreate.mockResolvedValue({});
  loginCalls.n = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("daily cron, Garmin never answers", () => {
  it("answers well under 60 s, with the errors and exactly one FAILURE row for yesterday", async () => {
    const start = Date.now();
    let settled = false;
    const pending = GET(
      new Request("https://x/api/cron/garmin-sync-daily", { headers: { authorization: `Bearer ${SECRET}` } }),
    ).finally(() => {
      settled = true;
    });
    while (!settled && Date.now() - start < 120_000) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    const res = await pending;
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(60_000);
    const body = await res.json();
    const r = body.results[0];
    expect(r.status).toBe("FAILURE");
    expect(r.errorDetails.join(" ")).toMatch(/Garmin timeout after 15000 ms: login/);

    expect(logCreate).toHaveBeenCalledTimes(1);
    const row = logCreate.mock.calls[0][0].data;
    expect(row.status).toBe("FAILURE");
    expect(row.targetDate).toEqual(new Date("2026-11-26T00:00:00.000Z"));

    // One login attempt for the whole run: the daily sync did not try again.
    expect(loginCalls.n).toBe(1);
  });
});
