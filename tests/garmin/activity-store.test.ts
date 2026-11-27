// Sprint 3.4 (#28), Phase A2 — raw activity store.
import { beforeEach, describe, expect, it, vi } from "vitest";

const actFindMany = vi.hoisted(() => vi.fn());
const actUpsert = vi.hoisted(() => vi.fn());
const actUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    garminActivity: { findMany: actFindMany, upsert: actUpsert, update: actUpdate },
  },
}));
vi.mock("@/lib/garmin/client", () => ({ getGarminClient: vi.fn() }));

import {
  ensureRunDetails,
  fetchActivitiesSince,
  toActivityRow,
  upsertGarminActivities,
} from "@/lib/garmin/activity-store";
import type { RawActivity } from "@/lib/garmin/activities";

function act(id: number, startLocal: string, extra: Partial<RawActivity> = {}): RawActivity {
  return {
    activityId: id,
    activityName: `A${id}`,
    startTimeLocal: startLocal,
    startTimeGMT: startLocal,
    duration: 1800,
    distance: 5000,
    activityType: { typeKey: "running" },
    ...extra,
  };
}

/** Newest first, like Garmin. */
function pager(all: RawActivity[]) {
  return vi.fn(async (start: number, limit: number) => all.slice(start, start + limit));
}

beforeEach(() => vi.clearAllMocks());

describe("fetchActivitiesSince", () => {
  it("pages until it passes the cutoff", async () => {
    const all = [
      act(5, "2026-11-26 18:00:00"),
      act(4, "2026-11-20 18:00:00"),
      act(3, "2026-11-14 18:00:00"),
      act(2, "2026-11-12 18:00:00"),
      act(1, "2026-11-01 18:00:00"),
    ];
    const fetchPage = pager(all);
    const res = await fetchActivitiesSince("2026-11-13", { pageSize: 2, fetchPage });
    expect(res.activities.map((a) => a.activityId)).toEqual([5, 4, 3]);
    expect(res.complete).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 2]);
  });

  it("stops at the end of the list", async () => {
    const fetchPage = pager([act(1, "2026-11-26 18:00:00")]);
    const res = await fetchActivitiesSince("2026-11-13", { pageSize: 20, fetchPage });
    expect(res).toMatchObject({ pages: 1, complete: true });
  });

  it("reports an incomplete fetch when the page limit stops it", async () => {
    const all = Array.from({ length: 10 }, (_, i) => act(100 - i, "2026-11-26 18:00:00"));
    const res = await fetchActivitiesSince("2026-11-13", { pageSize: 2, maxPages: 2, fetchPage: pager(all) });
    expect(res.complete).toBe(false);
    expect(res.activities).toHaveLength(4);
  });

  it("stops before a page when the deadline is near", async () => {
    const fetchPage = pager([act(1, "2026-11-26 18:00:00")]);
    const res = await fetchActivitiesSince("2026-11-13", {
      fetchPage,
      deadline: { remainingMs: () => 0, isNear: () => true },
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(res.complete).toBe(false);
  });
});

describe("toActivityRow", () => {
  it("keeps ids as text, the local date and the raw Garmin type", () => {
    const row = toActivityRow(
      act(21000000001, "2026-11-26 18:30:00", { workoutId: 1663567002, activityType: { typeKey: "street_running" } }),
    )!;
    expect(row.activityId).toBe("21000000001");
    expect(row.workoutId).toBe("1663567002");
    expect(row.localDate.toISOString()).toBe("2026-11-26T00:00:00.000Z");
    expect(row.category).toBe("run");
    expect(row.garminType).toBe("street_running");
    expect(row.durationSec).toBe(1800);
    expect(row.startTimeGMT?.toISOString()).toBe("2026-11-26T18:30:00.000Z");
  });

  it("stores every sport, not just runs", () => {
    expect(toActivityRow(act(1, "2026-11-26 07:00:00", { activityType: { typeKey: "cycling" } }))!.category).toBe("other");
  });

  it("returns null without a start time", () => {
    expect(toActivityRow(act(1, ""))).toBeNull();
  });
});

describe("upsertGarminActivities", () => {
  it("reports new activities and is idempotent", async () => {
    actFindMany.mockResolvedValueOnce([{ activityId: "1" }]);
    const res = await upsertGarminActivities("u", [act(1, "2026-11-26 07:00:00"), act(2, "2026-11-26 18:00:00")]);
    expect(res).toEqual({ created: ["2"], updated: 1, skipped: 0 });
    expect(actUpsert).toHaveBeenCalledTimes(2);
    expect(actUpsert.mock.calls[0][0].where).toEqual({ userId_activityId: { userId: "u", activityId: "1" } });
  });

  it("never overwrites the link or the fetched details on update", async () => {
    actFindMany.mockResolvedValueOnce([]);
    await upsertGarminActivities("u", [act(1, "2026-11-26 07:00:00")]);
    const update = actUpsert.mock.calls[0][0].update;
    for (const k of ["workoutRefId", "splits", "hrZones", "detailFetchedAt"]) {
      expect(update, k).not.toHaveProperty(k);
    }
  });
});

describe("ensureRunDetails", () => {
  it("stores splits and zones and stamps the fetch", async () => {
    actFindMany.mockResolvedValueOnce([{ id: "g1", activityId: "11" }]);
    const getDetail = vi.fn(async () => ({ splits: [{ splitNumber: 1 }] }) as never);
    const getZones = vi.fn(async () => ({ zone1Sec: 60 }) as never);
    const res = await ensureRunDetails("u", { deps: { getDetail, getZones } });
    expect(getDetail).toHaveBeenCalledWith(11);
    expect(res.fetched).toEqual(["11"]);
    const data = actUpdate.mock.calls[0][0].data;
    expect(data.splits).toEqual([{ splitNumber: 1 }]);
    expect(data.hrZones).toEqual({ zone1Sec: 60 });
    expect(data.detailFetchedAt).toBeInstanceOf(Date);
  });

  it("stamps a run without HR zones too (no strap is not an error)", async () => {
    actFindMany.mockResolvedValueOnce([{ id: "g1", activityId: "11" }]);
    await ensureRunDetails("u", {
      deps: { getDetail: vi.fn(async () => ({ splits: [] }) as never), getZones: vi.fn(async () => null) },
    });
    expect(actUpdate.mock.calls[0][0].data).not.toHaveProperty("hrZones");
    expect(actUpdate.mock.calls[0][0].data.detailFetchedAt).toBeInstanceOf(Date);
  });

  it("leaves a failed run unstamped for the next run and reports it", async () => {
    actFindMany.mockResolvedValueOnce([{ id: "g1", activityId: "11" }]);
    const res = await ensureRunDetails("u", {
      deps: { getDetail: vi.fn(async () => { throw new Error("down"); }), getZones: vi.fn() },
    });
    expect(actUpdate).not.toHaveBeenCalled();
    expect(res.errors).toEqual(["detail 11: down"]);
  });

  it("stops at a rate limit instead of hammering on", async () => {
    actFindMany.mockResolvedValueOnce([
      { id: "g1", activityId: "11" },
      { id: "g2", activityId: "12" },
      { id: "g3", activityId: "13" },
    ]);
    const getDetail = vi.fn(async () => {
      throw new Error("Request failed with status code 429");
    });
    const res = await ensureRunDetails("u", { deps: { getDetail, getZones: vi.fn() } });
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(res.rateLimited).toBe(true);
    expect(res.pending).toBe(2);
  });

  // Review fix (#28, point 2b): every further run would cost another 15 s.
  it("stops after a timeout instead of taking the next run", async () => {
    actFindMany.mockResolvedValueOnce([
      { id: "g1", activityId: "11" },
      { id: "g2", activityId: "12" },
    ]);
    const getDetail = vi.fn(async () => {
      throw new Error("Garmin timeout after 15000 ms: activity 11");
    });
    const res = await ensureRunDetails("u", { deps: { getDetail, getZones: vi.fn() } });
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ pending: 1, rateLimited: false });
  });

  it("only asks for runs without details", async () => {
    actFindMany.mockResolvedValueOnce([]);
    await ensureRunDetails("u", { since: new Date("2026-11-13T00:00:00.000Z") });
    const where = actFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: "u", category: "run", detailFetchedAt: null });
    expect(where.localDate.gte.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });
});
