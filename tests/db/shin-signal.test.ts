// Sprint 3.4 (#28, C3) — the shin as a weekly signal.
import { beforeEach, describe, expect, it, vi } from "vitest";

const reportFindMany = vi.hoisted(() => vi.fn());
const reportFindFirst = vi.hoisted(() => vi.fn());
const reportUpsert = vi.hoisted(() => vi.fn());
const workoutFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    shinReport: { findMany: reportFindMany, findFirst: reportFindFirst, upsert: reportUpsert },
    workout: { findMany: workoutFindMany },
  },
}));

import {
  combineShinValues,
  lastShinSignalDate,
  SHIN_CARD_BUCKETS,
  SHIN_SIGNAL_WINDOW_DAYS,
  upsertShinReport,
} from "@/lib/db/queries/shin-signal";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeEach(() => vi.clearAllMocks());

describe("constants", () => {
  it("reads 14 days and stores the upper end of each card bucket", () => {
    expect(SHIN_SIGNAL_WINDOW_DAYS).toBe(14);
    expect(SHIN_CARD_BUCKETS).toEqual({ "0": 0, "1-2": 2, "3": 3, "4+": 4 });
  });
});

describe("combineShinValues", () => {
  it("takes the highest value (Q, 27.11.) and counts the reports", () => {
    expect(combineShinValues([3, 0, 1])).toEqual({ worst: 3, count: 3 });
    expect(combineShinValues([])).toEqual({ worst: null, count: 0 });
  });
});

describe("upsertShinReport", () => {
  it("keeps one report per day and source", async () => {
    await upsertShinReport("u", d("2026-11-27"), 2, "today_card");
    expect(reportUpsert).toHaveBeenCalledWith({
      where: { userId_date_source: { userId: "u", date: d("2026-11-27"), source: "today_card" } },
      create: { userId: "u", date: d("2026-11-27"), painNrs: 2, source: "today_card" },
      update: { painNrs: 2 },
    });
  });
});

describe("lastShinSignalDate", () => {
  it("is the later of the newest report and the newest rated session", async () => {
    reportFindFirst.mockResolvedValue({ date: d("2026-11-22") });
    workoutFindMany.mockResolvedValue([
      { date: d("2026-11-25"), executedSession: { source: "garmin_auto" } }, // unrated: no signal
      { date: d("2026-11-24"), executedSession: { shinPainNrs: 1 } },
    ]);
    expect(await lastShinSignalDate("u", d("2026-11-21"))).toEqual(d("2026-11-24"));
  });

  it("is null without any signal — the card shows", async () => {
    reportFindFirst.mockResolvedValue(null);
    workoutFindMany.mockResolvedValue([{ date: d("2026-11-25"), executedSession: { source: "garmin_auto" } }]);
    expect(await lastShinSignalDate("u", d("2026-11-21"))).toBeNull();
  });
});
