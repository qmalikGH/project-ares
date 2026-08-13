// The daily Garmin cron — Sprint 2.8.
//
// Two properties that did not hold before: a failed sync must not touch the
// sensor row, and the route must stop answering 200 when nothing worked. The
// 2026-08-13 auth failure looked green in Vercel while it erased a day.
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMock = vi.hoisted(() => vi.fn());
const userFindMany = vi.hoisted(() => vi.fn());
const sensorFindFirst = vi.hoisted(() => vi.fn());
const sensorUpdate = vi.hoisted(() => vi.fn());
const sensorCreate = vi.hoisted(() => vi.fn());
const logCreate = vi.hoisted(() => vi.fn());
const logFindMany = vi.hoisted(() => vi.fn());
const logFindFirst = vi.hoisted(() => vi.fn());
const notificationFindFirst = vi.hoisted(() => vi.fn());
const notificationCreate = vi.hoisted(() => vi.fn());
const mealPlanFindFirst = vi.hoisted(() => vi.fn());
const settingsFindUnique = vi.hoisted(() => vi.fn());
const calibrateMock = vi.hoisted(() => vi.fn());
const hrMock = vi.hoisted(() => vi.fn());
const vdotMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    user: { findMany: userFindMany },
    dailySensorData: { findFirst: sensorFindFirst, update: sensorUpdate, create: sensorCreate },
    garminSyncLog: { create: logCreate, findMany: logFindMany, findFirst: logFindFirst },
    notification: { findFirst: notificationFindFirst, create: notificationCreate },
    mealPlan: { findFirst: mealPlanFindFirst },
    userSettings: { findUnique: settingsFindUnique },
  },
}));

vi.mock("@/lib/date", () => ({
  userTodayForUser: vi.fn(async () => new Date("2026-08-13T00:00:00.000Z")),
}));

vi.mock("@/lib/garmin/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/garmin/sync")>()),
  syncGarminForDate: syncMock,
}));

vi.mock("@/lib/nutrition/calibration", () => ({ calibrateMealPlan: calibrateMock }));
vi.mock("@/lib/coach-engine/hr-calibration", () => ({ recalibrateHrRest: hrMock }));
vi.mock("@/lib/coach-engine/vdot-recalibration", () => ({ recalibrateVdot: vdotMock }));

import { GET } from "@/app/api/cron/garmin-sync-daily/route";
import type { SyncResult } from "@/lib/garmin/sync";

const SECRET = "test-cron-secret";

function req(auth = `Bearer ${SECRET}`) {
  return new Request("https://x/api/cron/garmin-sync-daily", { headers: { authorization: auth } });
}

const OK_FLAGS = {
  hrvSyncOk: true, sleepSyncOk: true, bodyBatterySyncOk: true,
  rhrSyncOk: true, activitiesSyncOk: true, energySyncOk: true,
};
const DEAD_FLAGS = {
  hrvSyncOk: false, sleepSyncOk: false, bodyBatterySyncOk: false,
  rhrSyncOk: false, activitiesSyncOk: false, energySyncOk: false,
};

function success(): SyncResult {
  return {
    status: "SUCCESS",
    flags: OK_FLAGS,
    snapshot: {
      hrvStatus: "BALANCED", hrvRmssd: 85, sleepScore: 74, sleepDurationMin: 374,
      bodyBatteryMorning: 48, rhr: 51, totalKilocalories: 2900,
      activeKilocalories: 900, bmrKilocalories: 2000, bodyBatteryEnd: 20, averageStress: 33,
    },
    activitiesCount: 2,
    errors: [],
  };
}

function authFailure(): SyncResult {
  return {
    status: "FAILURE",
    flags: DEAD_FLAGS,
    snapshot: {
      hrvStatus: null, hrvRmssd: null, sleepScore: null, sleepDurationMin: null,
      bodyBatteryMorning: null, rhr: null, totalKilocalories: null,
      activeKilocalories: null, bmrKilocalories: null, bodyBatteryEnd: null, averageStress: null,
    },
    activitiesCount: 0,
    errors: [{ datatype: "auth", message: "ERROR: (403), Forbidden" }],
    authFailed: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  userFindMany.mockResolvedValue([{ id: "user_1" }]);
  logCreate.mockResolvedValue({ id: "log_1" });
  logFindMany.mockResolvedValue([]);
  logFindFirst.mockResolvedValue({ status: "SUCCESS" });
  notificationFindFirst.mockResolvedValue(null);
  notificationCreate.mockResolvedValue({});
  // A complete row by default, so the gap sweep finds nothing to do and the
  // per-test assertions are about the primary day only.
  sensorFindFirst.mockResolvedValue({
    id: "row_1", garmin: { rhr: 44, sleepScore: 70 }, totalKilocalories: 2900,
  });
  sensorUpdate.mockResolvedValue({});
  sensorCreate.mockResolvedValue({});
  mealPlanFindFirst.mockResolvedValue({ calibratedAt: new Date() });
  settingsFindUnique.mockResolvedValue({ hrZonesUpdatedAt: new Date(), vdotOverrideAt: new Date() });
});

describe("auth", () => {
  it("401 without the bearer", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });
});

describe("a failed sync", () => {
  beforeEach(() => syncMock.mockResolvedValue(authFailure()));

  it("never writes the sensor row", async () => {
    await GET(req());
    expect(sensorUpdate).not.toHaveBeenCalled();
    expect(sensorCreate).not.toHaveBeenCalled();
  });

  it("answers 500 so the failure is visible in Vercel", async () => {
    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  it("skips the three recalibrations — there is nothing new to calibrate against", async () => {
    await GET(req());
    expect(calibrateMock).not.toHaveBeenCalled();
    expect(hrMock).not.toHaveBeenCalled();
    expect(vdotMock).not.toHaveBeenCalled();
  });

  it("retries once after an auth failure (the cached session is dropped on the way out)", async () => {
    await GET(req());
    expect(syncMock).toHaveBeenCalledTimes(2);
  });
});

describe("a successful sync", () => {
  beforeEach(() => {
    syncMock.mockResolvedValue(success());
    calibrateMock.mockResolvedValue({ status: "insufficient_data" });
    hrMock.mockResolvedValue({ status: "insufficient_data" });
    vdotMock.mockResolvedValue({ status: "insufficient_data" });
  });

  it("answers 200 and persists all five energy columns", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = sensorUpdate.mock.calls[0][0].data;
    for (const col of ["totalKilocalories", "activeKilocalories", "bmrKilocalories", "bodyBatteryEnd", "averageStress"]) {
      expect(Object.prototype.hasOwnProperty.call(data, col), col).toBe(true);
    }
  });

  it("writes exactly one sync-log row for the primary day", async () => {
    // Gap sweep sees a complete row and does nothing, so one row total.
    await GET(req());
    expect(logCreate).toHaveBeenCalledTimes(1);
  });
});

describe("gap sweep", () => {
  it("re-syncs a recent day that is missing data", async () => {
    syncMock.mockResolvedValue(success());
    calibrateMock.mockResolvedValue({ status: "insufficient_data" });
    hrMock.mockResolvedValue({ status: "insufficient_data" });
    vdotMock.mockResolvedValue({ status: "insufficient_data" });
    // Primary day complete; the day before it has a wiped row.
    sensorFindFirst
      .mockResolvedValueOnce({ id: "row_1", garmin: { rhr: 44, sleepScore: 70 }, totalKilocalories: 2900 })
      .mockResolvedValueOnce({ id: "row_gap", garmin: { rhr: null, sleepScore: null }, totalKilocalories: null })
      .mockResolvedValue({ id: "row_gap", garmin: {}, totalKilocalories: null });

    const res = await GET(req());
    const body = await res.json();
    expect(body.results[0].gapsRepaired?.length).toBeGreaterThan(0);
  });
});
