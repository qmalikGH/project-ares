// Sprint 3.4 (#28), Phase A3 — history backfill: idempotent, resumable,
// throttled, stops cleanly on a rate limit. Garmin and the DB are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const actFindMany = vi.hoisted(() => vi.fn());
const actUpsert = vi.hoisted(() => vi.fn());
const actUpdate = vi.hoisted(() => vi.fn());
const actCount = vi.hoisted(() => vi.fn());
const sensorFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    garminActivity: { findMany: actFindMany, upsert: actUpsert, update: actUpdate, count: actCount },
    dailySensorData: { findMany: sensorFindMany },
  },
}));
vi.mock("@/lib/garmin/client", () => ({ getGarminClient: vi.fn() }));

import {
  BACKFILL_PAGE_SIZE,
  backfillActivities,
  backfillDetails,
  backfillWellness,
  freshBackfillState,
  RateLimited,
  type BackfillDeps,
} from "@/lib/garmin/history-backfill";
import type { RawActivity } from "@/lib/garmin/activities";
import type { SyncResult } from "@/lib/garmin/sync";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function act(id: number, day: string, typeKey = "running"): RawActivity {
  return { activityId: id, startTimeLocal: `${day} 18:00:00`, duration: 1200, activityType: { typeKey } };
}

function deps(over: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    apply: true,
    fetchPage: vi.fn(async () => []),
    sync: vi.fn(),
    persist: vi.fn(async () => ({ syncLogId: null, wrote: true, preserved: [], withheldDayTotals: [] })),
    sleep: vi.fn(async () => {}),
    saveState: vi.fn(),
    ...over,
  };
}

function syncResult(over: Partial<SyncResult> = {}): SyncResult {
  return {
    status: "PARTIAL",
    flags: { hrvSyncOk: false, sleepSyncOk: true, bodyBatterySyncOk: false, rhrSyncOk: true, activitiesSyncOk: true, energySyncOk: false },
    snapshot: {
      hrvStatus: null, hrvRmssd: null, sleepScore: 1, sleepDurationMin: null, bodyBatteryMorning: null, rhr: 1,
      totalKilocalories: null, activeKilocalories: null, bmrKilocalories: null, bodyBatteryEnd: null, averageStress: null,
    },
    activitiesCount: 0,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  actFindMany.mockResolvedValue([]);
});

describe("backfillActivities", () => {
  it("pages to the cutoff, upserts each page and counts per month and category", async () => {
    const page1 = Array.from({ length: BACKFILL_PAGE_SIZE }, (_, i) => act(1000 - i, "2026-11-20"));
    const page2 = [act(1, "2026-03-02", "strength_training"), act(0, "2025-10-01")];
    const fetchPage = vi.fn(async (start: number) => (start === 0 ? page1 : page2));
    const dp = deps({ fetchPage });
    const state = freshBackfillState();

    const res = await backfillActivities("u", "2025-11-27", state, dp);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, BACKFILL_PAGE_SIZE]);
    expect(res.seen).toBe(BACKFILL_PAGE_SIZE + 1);
    expect(res.perMonth.get("2026-11")).toEqual({ run: BACKFILL_PAGE_SIZE });
    expect(res.perMonth.get("2026-03")).toEqual({ strength: 1 });
    expect(actUpsert).toHaveBeenCalledTimes(BACKFILL_PAGE_SIZE + 1);
    expect(state.activitiesDone).toBe(true);
    expect(dp.sleep).toHaveBeenCalledTimes(1);
  });

  it("is skipped once done (resume after a restart)", async () => {
    const dp = deps();
    const res = await backfillActivities("u", "2025-11-27", { ...freshBackfillState(), activitiesDone: true }, dp);
    expect(res.skipped).toBe(true);
    expect(dp.fetchPage).not.toHaveBeenCalled();
  });

  it("resumes at the saved offset", async () => {
    const fetchPage = vi.fn(async () => [act(1, "2026-01-01")]);
    await backfillActivities("u", "2025-11-27", { ...freshBackfillState(), activityStart: 150 }, deps({ fetchPage }));
    expect(fetchPage).toHaveBeenCalledWith(150, BACKFILL_PAGE_SIZE);
  });

  it("writes nothing in a dry run", async () => {
    const fetchPage = vi.fn(async () => [act(1, "2026-01-01")]);
    const res = await backfillActivities("u", "2025-11-27", freshBackfillState(), deps({ apply: false, fetchPage }));
    expect(res.seen).toBe(1);
    expect(actUpsert).not.toHaveBeenCalled();
  });

  it("stops cleanly on a rate limit with the offset saved", async () => {
    const page1 = Array.from({ length: BACKFILL_PAGE_SIZE }, (_, i) => act(1000 - i, "2026-11-20"));
    const fetchPage = vi.fn(async (start: number) => {
      if (start === 0) return page1;
      throw new Error("Request failed with status code 429");
    });
    const dp = deps({ fetchPage });
    const state = freshBackfillState();
    await expect(backfillActivities("u", "2025-11-27", state, dp)).rejects.toBeInstanceOf(RateLimited);
    expect(state.activityStart).toBe(BACKFILL_PAGE_SIZE);
    expect(dp.saveState).toHaveBeenCalledWith(expect.objectContaining({ activityStart: BACKFILL_PAGE_SIZE }));
  });
});

describe("backfillDetails", () => {
  it("throttles between calls and marks the phase done", async () => {
    actFindMany.mockResolvedValueOnce([{ id: "g1", activityId: "11" }]);
    const dp = deps();
    const state = freshBackfillState();
    const res = await backfillDetails("u", d("2025-11-27"), state, dp, {
      getDetail: vi.fn(async () => ({ splits: [] }) as never),
      getZones: vi.fn(async () => null),
    });
    expect(res.fetched).toBe(1);
    expect(dp.sleep).toHaveBeenCalled();
    expect(state.detailsDone).toBe(true);
  });

  it("turns a rate limit into RateLimited", async () => {
    actFindMany.mockResolvedValueOnce([{ id: "g1", activityId: "11" }]);
    await expect(
      backfillDetails("u", d("2025-11-27"), freshBackfillState(), deps(), {
        getDetail: vi.fn(async () => { throw new Error("429 Too Many Requests"); }),
        getZones: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RateLimited);
  });
});

describe("backfillWellness", () => {
  const FROM = d("2026-11-20");
  const YESTERDAY = d("2026-11-22");
  const complete = {
    garmin: { rhr: 1, sleepScore: 1, hrvRmssd: 1, bodyBatteryMorning: 1 },
    totalKilocalories: 1,
    bmrKilocalories: 1,
  };

  it("syncs only missing or partial days, without log rows or readiness refresh", async () => {
    sensorFindMany.mockResolvedValue([{ date: d("2026-11-21"), ...complete }]);
    const sync = vi.fn<(day: Date) => Promise<SyncResult>>(async () => syncResult());
    const dp = deps({ sync });
    const res = await backfillWellness("u", FROM, YESTERDAY, freshBackfillState(), dp);
    expect(sync.mock.calls.map((c) => c[0].toISOString().slice(0, 10))).toEqual(["2026-11-22", "2026-11-20"]);
    expect(res).toEqual({ candidates: 2, filled: 2, empty: 0 });
    expect(dp.persist).toHaveBeenCalledWith(expect.objectContaining({ writeLog: false, refreshReadiness: false }));
  });

  it("writes no row for a day without any watch data", async () => {
    sensorFindMany.mockResolvedValue([]);
    const empty = syncResult();
    empty.snapshot = Object.fromEntries(
      Object.keys(empty.snapshot).map((k) => [k, null]),
    ) as unknown as SyncResult["snapshot"];
    const dp = deps({ sync: vi.fn(async () => empty) });
    const res = await backfillWellness("u", FROM, YESTERDAY, freshBackfillState(), dp);
    expect(dp.persist).not.toHaveBeenCalled();
    expect(res.empty).toBe(3);
  });

  it("skips days handled in an earlier run and records each new one", async () => {
    sensorFindMany.mockResolvedValue([]);
    const sync = vi.fn(async () => syncResult());
    const state = { ...freshBackfillState(), wellnessDone: ["2026-11-22", "2026-11-21"] };
    const dp = deps({ sync });
    await backfillWellness("u", FROM, YESTERDAY, state, dp);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(state.wellnessDone).toEqual(["2026-11-22", "2026-11-21", "2026-11-20"]);
  });

  it("stops on a rate limit before writing the day", async () => {
    sensorFindMany.mockResolvedValue([]);
    const dp = deps({
      sync: vi.fn(async () => syncResult({ errors: [{ datatype: "sleep", message: "429 Too Many Requests" }] })),
    });
    const state = freshBackfillState();
    await expect(backfillWellness("u", FROM, YESTERDAY, state, dp)).rejects.toBeInstanceOf(RateLimited);
    expect(dp.persist).not.toHaveBeenCalled();
    expect(state.wellnessDone).toEqual([]);
  });

  it("counts candidates only in a dry run", async () => {
    sensorFindMany.mockResolvedValue([]);
    const dp = deps({ apply: false, sync: vi.fn() });
    const res = await backfillWellness("u", FROM, YESTERDAY, freshBackfillState(), dp);
    expect(res.candidates).toBe(3);
    expect(dp.sync).not.toHaveBeenCalled();
  });
});
