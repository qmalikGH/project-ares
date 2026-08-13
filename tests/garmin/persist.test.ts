// The single Garmin writer — Sprint 2.8.
//
// Every test here is a regression against something that actually happened in
// production between 2026-08-10 and 2026-08-13. There was no test covering this
// path at all, which is why four independent defects could sit in it at once.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sensorFindFirst = vi.hoisted(() => vi.fn());
const sensorUpdate = vi.hoisted(() => vi.fn());
const sensorCreate = vi.hoisted(() => vi.fn());
const logCreate = vi.hoisted(() => vi.fn());
const logFindMany = vi.hoisted(() => vi.fn());
const notificationFindFirst = vi.hoisted(() => vi.fn());
const notificationCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    dailySensorData: { findFirst: sensorFindFirst, update: sensorUpdate, create: sensorCreate },
    garminSyncLog: { create: logCreate, findMany: logFindMany },
    notification: { findFirst: notificationFindFirst, create: notificationCreate },
  },
}));

vi.mock("@/lib/date", () => ({
  userTodayForUser: vi.fn(async () => new Date("2026-08-13T00:00:00.000Z")),
}));

import { mergeEnergyColumns, mergeNonNull, persistGarminSync } from "@/lib/garmin/persist";
import type { SyncResult } from "@/lib/garmin/sync";

const USER = "user_1";
const YESTERDAY = new Date("2026-08-12T00:00:00.000Z");
const TODAY = new Date("2026-08-13T00:00:00.000Z");

function result(over: Partial<SyncResult> = {}): SyncResult {
  return {
    status: "SUCCESS",
    flags: {
      hrvSyncOk: true, sleepSyncOk: true, bodyBatterySyncOk: true,
      rhrSyncOk: true, activitiesSyncOk: true, energySyncOk: true,
    },
    snapshot: {
      hrvStatus: "BALANCED", hrvRmssd: 85, sleepScore: 74, sleepDurationMin: 374,
      bodyBatteryMorning: 48, rhr: 51,
      totalKilocalories: 2900, activeKilocalories: 900, bmrKilocalories: 2000,
      bodyBatteryEnd: 20, averageStress: 33,
    },
    activitiesCount: 2,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  logCreate.mockResolvedValue({ id: "log_1" });
  logFindMany.mockResolvedValue([]);
  notificationFindFirst.mockResolvedValue(null);
  notificationCreate.mockResolvedValue({});
  sensorFindFirst.mockResolvedValue(null);
  sensorUpdate.mockResolvedValue({});
  sensorCreate.mockResolvedValue({});
});

describe("auth failure must not clobber good data", () => {
  it("writes no sensor row at all", async () => {
    sensorFindFirst.mockResolvedValue({ id: "row_1", garmin: { rhr: 44, sleepScore: 80 }, totalKilocalories: 2900 });
    const out = await persistGarminSync({
      userId: USER, date: YESTERDAY,
      result: result({
        status: "FAILURE",
        authFailed: true,
        flags: { hrvSyncOk: false, sleepSyncOk: false, bodyBatterySyncOk: false, rhrSyncOk: false, activitiesSyncOk: false, energySyncOk: false },
        snapshot: {
          hrvStatus: null, hrvRmssd: null, sleepScore: null, sleepDurationMin: null,
          bodyBatteryMorning: null, rhr: null, totalKilocalories: null,
          activeKilocalories: null, bmrKilocalories: null, bodyBatteryEnd: null, averageStress: null,
        },
        errors: [{ datatype: "auth", message: "ERROR: (403), Forbidden" }],
      }),
    });

    expect(sensorUpdate).not.toHaveBeenCalled();
    expect(sensorCreate).not.toHaveBeenCalled();
    expect(out.wrote).toBe(false);
    expect(out.skippedReason).toBe("auth_failure");
  });

  it("still records the failure and classifies a 403 as an auth problem", async () => {
    await persistGarminSync({
      userId: USER, date: YESTERDAY,
      result: result({
        status: "FAILURE",
        authFailed: true,
        flags: { hrvSyncOk: false, sleepSyncOk: false, bodyBatterySyncOk: false, rhrSyncOk: false, activitiesSyncOk: false, energySyncOk: false },
        errors: [{ datatype: "auth", message: "ERROR: (403), Forbidden" }],
      }),
    });
    expect(logCreate).toHaveBeenCalledTimes(1);
    expect(logCreate.mock.calls[0][0].data.errorType).toBe("AUTH_FAILURE");
  });

  it("raises a notification on the second consecutive failure", async () => {
    logFindMany.mockResolvedValue([{ status: "FAILURE" }, { status: "FAILURE" }, { status: "SUCCESS" }]);
    await persistGarminSync({
      userId: USER, date: YESTERDAY,
      result: result({
        status: "FAILURE",
        flags: { hrvSyncOk: false, sleepSyncOk: false, bodyBatterySyncOk: false, rhrSyncOk: false, activitiesSyncOk: false, energySyncOk: false },
        errors: [{ datatype: "auth", message: "403" }],
      }),
    });
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data.type).toBe("GARMIN_SYNC_FAILURE");
  });
});

describe("a partial sync must not null out existing values", () => {
  it("keeps the stored wellness value when the sync has none", async () => {
    sensorFindFirst.mockResolvedValue({ id: "row_1", garmin: { rhr: 44, sleepScore: 80 } });
    const r = result({ status: "PARTIAL" });
    r.snapshot.rhr = null;
    r.snapshot.sleepScore = 72;

    const out = await persistGarminSync({ userId: USER, date: YESTERDAY, result: r });

    const written = sensorUpdate.mock.calls[0][0].data.garmin as Record<string, unknown>;
    expect(written.rhr).toBe(44); // preserved
    expect(written.sleepScore).toBe(72); // a fuller reading replaces the older one
    expect(out.preserved).toContain("rhr");
  });

  it("omits the column entirely rather than writing null over a value", async () => {
    sensorFindFirst.mockResolvedValue({ id: "row_1", garmin: {}, totalKilocalories: 2900 });
    const r = result();
    r.snapshot.totalKilocalories = null;

    await persistGarminSync({ userId: USER, date: YESTERDAY, result: r });

    const data = sensorUpdate.mock.calls[0][0].data;
    // Asserting on the payload, not the outcome: a null key in the payload is
    // the bug, even if Prisma would happen to keep the old value.
    expect(Object.prototype.hasOwnProperty.call(data, "totalKilocalories")).toBe(false);
  });

  it("preserves unrelated keys already in the garmin JSON", async () => {
    sensorFindFirst.mockResolvedValue({ id: "row_1", garmin: { rhr: 44, somethingElse: "keep me" } });
    await persistGarminSync({ userId: USER, date: YESTERDAY, result: result() });
    const written = sensorUpdate.mock.calls[0][0].data.garmin as Record<string, unknown>;
    expect(written.somethingElse).toBe("keep me");
  });
});

describe("SUCCESS implies the energy columns were written", () => {
  // This is the test that would have caught the manual sync route, which never
  // persisted these five columns at all.
  it("writes all five day-total columns for a completed day", async () => {
    sensorFindFirst.mockResolvedValue({ id: "row_1", garmin: {} });
    await persistGarminSync({ userId: USER, date: YESTERDAY, result: result() });

    const data = sensorUpdate.mock.calls[0][0].data;
    for (const col of ["totalKilocalories", "activeKilocalories", "bmrKilocalories", "bodyBatteryEnd", "averageStress"]) {
      expect(Object.prototype.hasOwnProperty.call(data, col), col).toBe(true);
    }
  });

  it("creates a row with null-valued keys omitted when none exists", async () => {
    sensorFindFirst.mockResolvedValue(null);
    const r = result();
    r.snapshot.averageStress = null;
    await persistGarminSync({ userId: USER, date: YESTERDAY, result: r });

    const data = sensorCreate.mock.calls[0][0].data;
    expect(data.totalKilocalories).toBe(2900);
    expect(Object.prototype.hasOwnProperty.call(data, "averageStress")).toBe(false);
  });
});

describe("day totals are withheld while the day is still running", () => {
  it("writes wellness but no calories for today", async () => {
    sensorFindFirst.mockResolvedValue({ id: "row_1", garmin: {} });
    const out = await persistGarminSync({ userId: USER, date: TODAY, result: result() });

    const data = sensorUpdate.mock.calls[0][0].data;
    expect(data.garmin).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(data, "totalKilocalories")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(data, "bmrKilocalories")).toBe(false);
    expect(out.withheldDayTotals).toContain("totalKilocalories");
  });
});

describe("bookkeeping", () => {
  it("writes exactly one sync-log row per call", async () => {
    await persistGarminSync({ userId: USER, date: YESTERDAY, result: result() });
    expect(logCreate).toHaveBeenCalledTimes(1);
  });

  it("stamps garminLastSyncAt on success but never on failure", async () => {
    sensorFindFirst.mockResolvedValue({ id: "row_1", garmin: {} });
    await persistGarminSync({ userId: USER, date: YESTERDAY, result: result() });
    expect(sensorUpdate.mock.calls[0][0].data.garminLastSyncAt).toBeInstanceOf(Date);

    vi.clearAllMocks();
    logCreate.mockResolvedValue({ id: "log_2" });
    logFindMany.mockResolvedValue([]);
    await persistGarminSync({
      userId: USER, date: YESTERDAY,
      result: result({
        status: "FAILURE",
        flags: { hrvSyncOk: false, sleepSyncOk: false, bodyBatterySyncOk: false, rhrSyncOk: false, activitiesSyncOk: false, energySyncOk: false },
      }),
    });
    expect(sensorUpdate).not.toHaveBeenCalled();
  });
});

describe("merge helpers", () => {
  it("mergeNonNull lets a value replace an older one but never a null", () => {
    const { merged, preserved } = mergeNonNull({ a: 1, b: 2 }, { a: 9, b: null } as Record<string, unknown>);
    expect(merged).toEqual({ a: 9, b: 2 });
    expect(preserved).toEqual(["b"]);
  });

  it("mergeEnergyColumns respects force", () => {
    const existing = { totalKilocalories: 879 };
    expect(mergeEnergyColumns(existing, { totalKilocalories: 2900 }).patch).toEqual({});
    expect(mergeEnergyColumns(existing, { totalKilocalories: 2900 }, { force: true }).patch)
      .toEqual({ totalKilocalories: 2900 });
  });

  it("mergeEnergyColumns never writes a null, even with force", () => {
    const existing = { totalKilocalories: 2900 };
    expect(mergeEnergyColumns(existing, { totalKilocalories: null }, { force: true }).patch).toEqual({});
  });
});
