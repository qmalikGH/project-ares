// The manual/UI Garmin sync route — Sprint 2.8.
//
// This route persisted only the `garmin` JSON and silently dropped the five
// energy columns, because those were added to the cron and never back-ported.
// The guarantee now is structural: the route does not write the sensor row at
// all, it delegates to the one shared writer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMock = vi.hoisted(() => vi.fn());
const persistMock = vi.hoisted(() => vi.fn());
const failureLogMock = vi.hoisted(() => vi.fn());
const sensorUpdate = vi.hoisted(() => vi.fn());
const sensorCreate = vi.hoisted(() => vi.fn());
const currentUser = vi.hoisted(() => vi.fn());
const todayDynamic = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    // Any direct write from the route is a bug — make it fail loudly.
    dailySensorData: {
      update: sensorUpdate.mockImplementation(() => { throw new Error("route wrote the sensor row directly"); }),
      create: sensorCreate.mockImplementation(() => { throw new Error("route wrote the sensor row directly"); }),
      findFirst: vi.fn(),
    },
    garminSyncLog: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUserId: currentUser }));
vi.mock("@/lib/db/queries/sensors", () => ({
  dayKey: (d: Date) => { const r = new Date(d); r.setUTCHours(0, 0, 0, 0); return r; },
}));
vi.mock("@/lib/date", () => ({ userTodayDynamic: todayDynamic }));
vi.mock("@/lib/garmin/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/garmin/sync")>()),
  syncGarminForDate: syncMock,
}));
vi.mock("@/lib/garmin/persist", () => ({
  persistGarminSync: persistMock,
  writeGarminSyncFailureLog: failureLogMock,
}));

import { POST } from "@/app/api/sensors/garmin-sync/route";

const FLAGS_OK = {
  hrvSyncOk: true, sleepSyncOk: true, bodyBatterySyncOk: true,
  rhrSyncOk: true, activitiesSyncOk: true, energySyncOk: true,
};

function post(body: unknown = {}) {
  return new Request("https://x/api/sensors/garmin-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue("user_1");
  todayDynamic.mockResolvedValue(new Date("2026-08-13T00:00:00.000Z"));
  persistMock.mockResolvedValue({ syncLogId: "log_1", wrote: true, preserved: [], withheldDayTotals: [] });
});

describe("single-writer guarantee", () => {
  it("never touches DailySensorData itself", async () => {
    syncMock.mockResolvedValue({ status: "SUCCESS", flags: FLAGS_OK, snapshot: {}, activitiesCount: 0, errors: [] });
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(sensorUpdate).not.toHaveBeenCalled();
    expect(sensorCreate).not.toHaveBeenCalled();
    expect(persistMock).toHaveBeenCalledTimes(1);
  });
});

describe("failure reporting", () => {
  it("a thrown sync → 502 and a failure log", async () => {
    syncMock.mockRejectedValue(new Error("network down"));
    const res = await POST(post());
    expect(res.status).toBe(502);
    expect(failureLogMock).toHaveBeenCalledWith("user_1", "network down");
  });

  // Since Sprint 2.8 an auth failure comes back as a RESULT, not a throw. The
  // route used to answer 200 for that, and the UI reads any 200 as success.
  it("a FAILURE result → 502, not 200", async () => {
    syncMock.mockResolvedValue({
      status: "FAILURE",
      flags: { ...FLAGS_OK, hrvSyncOk: false, sleepSyncOk: false, bodyBatterySyncOk: false, rhrSyncOk: false, activitiesSyncOk: false, energySyncOk: false },
      snapshot: {}, activitiesCount: 0,
      errors: [{ datatype: "auth", message: "403" }],
      authFailed: true,
    });
    persistMock.mockResolvedValue({ syncLogId: "l", wrote: false, skippedReason: "auth_failure", preserved: [], withheldDayTotals: [] });
    const res = await POST(post());
    expect(res.status).toBe(502);
  });
});

describe("date handling", () => {
  it("honours an explicit date — the repair path depends on it", async () => {
    syncMock.mockResolvedValue({ status: "SUCCESS", flags: FLAGS_OK, snapshot: {}, activitiesCount: 0, errors: [] });
    await POST(post({ date: "2026-08-12" }));
    const passed = persistMock.mock.calls[0][0].date as Date;
    expect(passed.toISOString().slice(0, 10)).toBe("2026-08-12");
  });

  it("defaults to the user's local today, not the UTC date", async () => {
    syncMock.mockResolvedValue({ status: "SUCCESS", flags: FLAGS_OK, snapshot: {}, activitiesCount: 0, errors: [] });
    await POST(post());
    expect(todayDynamic).toHaveBeenCalled();
    const passed = persistMock.mock.calls[0][0].date as Date;
    expect(passed.toISOString().slice(0, 10)).toBe("2026-08-13");
  });
});
