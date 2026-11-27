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
const activitiesMock = vi.hoisted(() => vi.fn());
const autoImportMock = vi.hoisted(() => vi.fn());
const sweepMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const workoutCount = vi.hoisted(() => vi.fn());
const sensorFindMany = vi.hoisted(() => vi.fn());
const budget = vi.hoisted(() => ({ near: false }));

vi.mock("@/lib/db/client", () => ({
  db: {
    user: { findMany: userFindMany },
    dailySensorData: { findFirst: sensorFindFirst, findMany: sensorFindMany, update: sensorUpdate, create: sensorCreate },
    garminSyncLog: { create: logCreate, findMany: logFindMany, findFirst: logFindFirst },
    notification: { findFirst: notificationFindFirst, create: notificationCreate },
    mealPlan: { findFirst: mealPlanFindFirst },
    userSettings: { findUnique: settingsFindUnique },
    workout: { count: workoutCount },
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
// Sprint 3.4 (#28): the raw-activity step, the auto-import and the sweep are
// tested in their own files; here they are seams. The auto-import used to be
// unmocked — it threw on the missing db.workout and was swallowed, so the route
// never exercised it.
vi.mock("@/lib/garmin/activity-store", () => ({ syncRecentActivities: activitiesMock }));
vi.mock("@/lib/garmin/auto-import", () => ({ autoImportFromStore: autoImportMock }));
vi.mock("@/lib/garmin/plan-refresh", () => ({ refreshAfterImport: refreshMock }));
vi.mock("@/lib/garmin/gap-sweep", () => ({ sweepRecentGaps: sweepMock }));
vi.mock("@/lib/garmin/timeout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/garmin/timeout")>()),
  createDeadline: () => ({ remainingMs: () => (budget.near ? 0 : 50_000), isNear: () => budget.near }),
}));

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
  activitiesMock.mockResolvedValue({ fetched: 3, created: ["a1"], details: 1, complete: true, errors: [] });
  autoImportMock.mockResolvedValue({ imported: [], rawOnly: [], reconciled: 0, errors: [] });
  refreshMock.mockResolvedValue({ regenerated: 2, materialized: { created: 0, updated: 3, deleted: 0 }, repushed: 1, errors: [] });
  workoutCount.mockResolvedValue(0);
  // Watch data on all three days before today by default → no C5 warning.
  sensorFindMany.mockResolvedValue([
    { date: new Date("2026-08-10T00:00:00.000Z"), garmin: { rhr: 1 } },
    { date: new Date("2026-08-11T00:00:00.000Z"), garmin: { rhr: 1 } },
    { date: new Date("2026-08-12T00:00:00.000Z"), garmin: { rhr: 1 } },
  ]);
  sweepMock.mockResolvedValue({ repaired: [], attempted: [], deferred: 0, errors: [] });
  budget.near = false;
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

describe("Sprint 3.4 (#28): order, errors, budget", () => {
  beforeEach(() => {
    syncMock.mockResolvedValue(success());
    calibrateMock.mockResolvedValue({ status: "insufficient_data" });
    hrMock.mockResolvedValue({ status: "insufficient_data" });
    vdotMock.mockResolvedValue({ status: "insufficient_data" });
  });

  it("stores raw activities before the sensor sync", async () => {
    await GET(req());
    expect(activitiesMock).toHaveBeenCalledTimes(1);
    expect(activitiesMock.mock.invocationCallOrder[0]).toBeLessThan(syncMock.mock.invocationCallOrder[0]);
    // 14 days back from the user's today.
    expect(activitiesMock.mock.calls[0][2]).toBe(14);
  });

  it("still stores the activities when the sensor sync fails", async () => {
    syncMock.mockResolvedValue(authFailure());
    const body = await (await GET(req())).json();
    expect(activitiesMock).toHaveBeenCalled();
    expect(body.results[0].activities).toEqual({ fetched: 3, created: 1, details: 1, complete: true });
  });

  it("returns auto-import errors instead of dropping them", async () => {
    autoImportMock.mockResolvedValue({ imported: [], rawOnly: [], reconciled: 0, errors: ["threshold_run 2026-08-11: boom"] });
    const body = await (await GET(req())).json();
    expect(body.results[0].errorDetails).toContain("auto-import: threshold_run 2026-08-11: boom");
  });

  it("returns activity and sweep errors", async () => {
    activitiesMock.mockResolvedValue({ fetched: 0, created: [], details: 0, complete: false, errors: ["activities: Garmin timeout after 15000 ms: activities 0+20"] });
    sweepMock.mockResolvedValue({ repaired: [], attempted: ["2026-08-11"], deferred: 2, errors: ["2026-08-11: hrv: down"] });
    const body = await (await GET(req())).json();
    expect(body.results[0].errorDetails).toEqual(
      expect.arrayContaining([
        "activities: activities: Garmin timeout after 15000 ms: activities 0+20",
        "sweep: 2026-08-11: hrv: down",
      ]),
    );
    expect(body.results[0].gapsDeferred).toBe(2);
  });

  it("reports repaired gap days", async () => {
    sweepMock.mockResolvedValue({ repaired: ["2026-08-11"], attempted: ["2026-08-11"], deferred: 0, errors: [] });
    const body = await (await GET(req())).json();
    expect(body.results[0].gapsRepaired).toEqual(["2026-08-11"]);
  });

  it("imports from the raw store over the last 14 days up to yesterday", async () => {
    await GET(req());
    const window = autoImportMock.mock.calls[0][1];
    expect(window.from.toISOString().slice(0, 10)).toBe("2026-07-30");
    expect(window.to.toISOString().slice(0, 10)).toBe("2026-08-12");
  });

  it("refreshes the plan and the watch right after an import (B2)", async () => {
    autoImportMock.mockResolvedValue({
      imported: [{ workoutId: "w1", date: "2026-08-12", type: "easy_run", activityId: "a1", durationActualMin: 22, match: "free_run" }],
      rawOnly: [{ activityId: "a2", date: "2026-08-12", reason: "under_15_min" }],
      reconciled: 0,
      errors: [],
    });
    const body = await (await GET(req())).json();
    expect(refreshMock).toHaveBeenCalledWith("user_1");
    expect(body.results[0].autoImported).toEqual(["2026-08-12 easy_run (free_run)"]);
    expect(body.results[0].rawOnly).toEqual({ under_15_min: 1 });
    expect(body.results[0].planRefresh).toBe("regenerated 2, repushed 1");
  });

  it("does not refresh when nothing was imported", async () => {
    await GET(req());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("leaves the refresh to the 19:00 cron when time is short", async () => {
    autoImportMock.mockResolvedValue({
      imported: [{ workoutId: "w1", date: "2026-08-12", type: "easy_run", activityId: "a1", durationActualMin: 22, match: "same_day" }],
      rawOnly: [], reconciled: 0, errors: [],
    });
    budget.near = true;
    const body = await (await GET(req())).json();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(body.results[0].planRefresh).toMatch(/deferred/);
  });

  it("nudges toward /confirm only for planned sessions without a recording", async () => {
    workoutCount.mockResolvedValue(2);
    const body = await (await GET(req())).json();
    expect(body.results[0].missingSessions).toBe(2);
    const where = workoutCount.mock.calls[0][0].where;
    expect(where.status).toBe("planned");
    expect(where.type.notIn).toEqual(expect.arrayContaining(["rest", "mobility"]));
    expect(notificationCreate.mock.calls[0][0].data.title).toBe("2 Einheiten ohne Aufzeichnung");
  });

  it("runs the import even when the wellness sync failed (it reads the raw store only)", async () => {
    syncMock.mockResolvedValue(authFailure());
    await GET(req());
    expect(autoImportMock).toHaveBeenCalled();
  });

  it("skips the recalibrations when the time budget is used up", async () => {
    mealPlanFindFirst.mockResolvedValue({ calibratedAt: new Date(0) });
    budget.near = true;
    const body = await (await GET(req())).json();
    expect(calibrateMock).not.toHaveBeenCalled();
    expect(body.results[0].recalibrated).toBe("skipped: time budget");
  });
});

// Sprint 3.4 (#28, C5): three days without watch data.
describe("watch data warning", () => {
  beforeEach(() => {
    syncMock.mockResolvedValue(success());
    calibrateMock.mockResolvedValue({ status: "insufficient_data" });
    hrMock.mockResolvedValue({ status: "insufficient_data" });
    vdotMock.mockResolvedValue({ status: "insufficient_data" });
  });

  it("warns once a day after three days without resting HR and sleep score", async () => {
    sensorFindMany.mockResolvedValue([
      { date: new Date("2026-08-11T00:00:00.000Z"), garmin: { rhr: null, sleepScore: null } },
    ]);
    const body = await (await GET(req())).json();
    expect(body.results[0].watchDataMissingDays).toBe(3);
    const created = notificationCreate.mock.calls.map((c) => c[0].data);
    expect(created).toEqual(expect.arrayContaining([expect.objectContaining({ type: "GARMIN_DATA_MISSING", title: "Uhr synchronisieren" })]));
  });

  it("stays quiet when one of the three days has data", async () => {
    sensorFindMany.mockResolvedValue([{ date: new Date("2026-08-11T00:00:00.000Z"), garmin: { sleepScore: 1 } }]);
    const body = await (await GET(req())).json();
    expect(body.results[0].watchDataMissingDays).toBeUndefined();
    expect(notificationCreate.mock.calls.map((c) => c[0].data.type)).not.toContain("GARMIN_DATA_MISSING");
  });

  it("also warns when the sync itself was PARTIAL (the case that never alerted)", async () => {
    syncMock.mockResolvedValue({ ...success(), status: "PARTIAL" });
    sensorFindMany.mockResolvedValue([]);
    const body = await (await GET(req())).json();
    expect(body.results[0].status).toBe("PARTIAL");
    expect(body.results[0].watchDataMissingDays).toBe(3);
  });
});
