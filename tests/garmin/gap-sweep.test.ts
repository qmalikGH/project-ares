// Sprint 3.4 (#28), Phase A2 — the 14-day gap sweep.
//
// What changed from Sprint 2.8: a 14-day window instead of 3, "incomplete"
// covers HRV, body battery and BMR too, a per-day retry guard from
// GarminSyncLog.targetDate replaces a guard that could never fire, a failed
// day is logged instead of dropped, and a time budget bounds the whole thing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sensorFindMany = vi.hoisted(() => vi.fn());
const logFindMany = vi.hoisted(() => vi.fn());
const syncMock = vi.hoisted(() => vi.fn());
const persistMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    dailySensorData: { findMany: sensorFindMany },
    garminSyncLog: { findMany: logFindMany },
  },
}));
vi.mock("@/lib/garmin/sync", () => ({ syncGarminForDate: syncMock }));
vi.mock("@/lib/garmin/persist", () => ({ persistGarminSync: persistMock }));

import {
  GAP_SWEEP_DAYS,
  MAX_SWEEP_DAYS_PER_RUN,
  isIncompleteDay,
  sweepRecentGaps,
} from "@/lib/garmin/gap-sweep";
import type { Deadline } from "@/lib/garmin/timeout";

const PRIMARY = new Date("2026-11-26T00:00:00.000Z");
const NOW = new Date("2026-11-27T05:00:00.000Z");
const plenty: Deadline = { remainingMs: () => 50_000, isNear: () => false };

function day(offset: number): Date {
  return new Date(PRIMARY.getTime() - offset * 86400000);
}
function key(d: Date) {
  return d.toISOString().slice(0, 10);
}
function completeRow(d: Date): {
  date: Date;
  garmin: Record<string, number | null>;
  totalKilocalories: number | null;
  bmrKilocalories: number | null;
} {
  return {
    date: d,
    garmin: { rhr: 1, sleepScore: 1, hrvRmssd: 1, bodyBatteryMorning: 1 },
    totalKilocalories: 1,
    bmrKilocalories: 1,
  };
}
const OK = { status: "PARTIAL", errors: [] };

beforeEach(() => {
  vi.clearAllMocks();
  logFindMany.mockResolvedValue([]);
  syncMock.mockResolvedValue(OK);
  persistMock.mockResolvedValue({ wrote: true });
});

describe("isIncompleteDay", () => {
  it("is complete only with every wellness value and both day totals", () => {
    expect(isIncompleteDay(completeRow(day(1)))).toBe(false);
  });

  it.each(["rhr", "sleepScore", "hrvRmssd", "bodyBatteryMorning"])("is incomplete without %s", (field) => {
    const row = completeRow(day(1));
    (row.garmin as Record<string, unknown>)[field] = null;
    expect(isIncompleteDay(row)).toBe(true);
  });

  it("is incomplete without total or BMR kcal, or without a row", () => {
    expect(isIncompleteDay({ ...completeRow(day(1)), bmrKilocalories: null })).toBe(true);
    expect(isIncompleteDay({ ...completeRow(day(1)), totalKilocalories: null })).toBe(true);
    expect(isIncompleteDay(undefined)).toBe(true);
  });
});

describe("sweepRecentGaps", () => {
  it("looks 14 days back from the primary day", async () => {
    sensorFindMany.mockResolvedValue([]);
    await sweepRecentGaps("u", PRIMARY, plenty, NOW);
    const where = sensorFindMany.mock.calls[0][0].where;
    expect(key(where.date.lte)).toBe(key(day(1)));
    expect(key(where.date.gte)).toBe(key(day(GAP_SWEEP_DAYS)));
  });

  it("re-syncs only incomplete days, newest first", async () => {
    const rows = Array.from({ length: GAP_SWEEP_DAYS }, (_, i) => completeRow(day(i + 1)));
    rows[2] = { ...completeRow(day(3)), bmrKilocalories: null };
    rows[9] = { ...completeRow(day(10)), garmin: { rhr: 1, sleepScore: 1, hrvRmssd: null, bodyBatteryMorning: 1 } };
    sensorFindMany.mockResolvedValue(rows);

    const out = await sweepRecentGaps("u", PRIMARY, plenty, NOW);
    expect(out.attempted).toEqual([key(day(3)), key(day(10))]);
    expect(out.repaired).toEqual([key(day(3)), key(day(10))]);
  });

  it("attempts at most MAX_SWEEP_DAYS_PER_RUN days and defers the rest", async () => {
    sensorFindMany.mockResolvedValue([]); // watch not worn: every day incomplete
    const out = await sweepRecentGaps("u", PRIMARY, plenty, NOW);
    expect(out.attempted).toHaveLength(MAX_SWEEP_DAYS_PER_RUN);
    expect(out.deferred).toBe(GAP_SWEEP_DAYS - MAX_SWEEP_DAYS_PER_RUN);
    expect(out.attempted[0]).toBe(key(day(1)));
  });

  it("skips days already attempted within the retry window", async () => {
    sensorFindMany.mockResolvedValue([]);
    logFindMany.mockResolvedValue([{ targetDate: day(1) }, { targetDate: day(2) }]);
    const out = await sweepRecentGaps("u", PRIMARY, plenty, NOW);
    expect(out.attempted[0]).toBe(key(day(3)));
    // The guard query is scoped to recent attempts on these target dates.
    const where = logFindMany.mock.calls[0][0].where;
    expect(where.createdAt.gte.getTime()).toBe(NOW.getTime() - 20 * 3600 * 1000);
  });

  it("starts no day once the budget is low", async () => {
    sensorFindMany.mockResolvedValue([]);
    const out = await sweepRecentGaps("u", PRIMARY, { remainingMs: () => 0, isNear: () => true }, NOW);
    expect(syncMock).not.toHaveBeenCalled();
    expect(out.deferred).toBe(GAP_SWEEP_DAYS);
  });

  it("persists a failed day (so it is logged) and stops", async () => {
    sensorFindMany.mockResolvedValue([]);
    syncMock.mockResolvedValueOnce({ status: "FAILURE", errors: [{ datatype: "auth", message: "403" }] });
    persistMock.mockResolvedValueOnce({ wrote: false });
    const out = await sweepRecentGaps("u", PRIMARY, plenty, NOW);
    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(out.errors).toEqual([`${key(day(1))}: auth: 403`]);
    expect(out.attempted).toHaveLength(1);
  });

  it("records a thrown error instead of swallowing it", async () => {
    sensorFindMany.mockResolvedValue([]);
    syncMock.mockRejectedValueOnce(new Error("Garmin timeout after 15000 ms: sleep"));
    const out = await sweepRecentGaps("u", PRIMARY, plenty, NOW);
    expect(out.errors).toEqual([`${key(day(1))}: Garmin timeout after 15000 ms: sleep`]);
  });
});
