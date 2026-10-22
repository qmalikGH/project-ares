// Sprint 3.3 (C1) — the cached readiness follows late Garmin data.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/client", () => ({
  db: { dailySensorData: { findFirst, findMany, update } },
}));

import { refreshStoredReadiness } from "@/lib/db/queries/readiness-refresh";

const DAY = new Date("2026-10-07T00:00:00.000Z");
const MORNING = { subjectiveRecovery: 7, morningStiffness: 2, stairsScore: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  update.mockResolvedValue({});
});

describe("refreshStoredReadiness", () => {
  it("recomputes and stores readiness once the day has its full Garmin data", async () => {
    findFirst.mockResolvedValue({
      id: "row-1",
      userMorning: MORNING,
      garmin: { hrvRmssd: 50, sleepScore: 80, bodyBatteryMorning: 70, rhr: 55 },
    });
    expect(await refreshStoredReadiness("u1", DAY)).toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(Number.isFinite(data.readinessScore)).toBe(true);
    expect(data.readinessBand).toMatch(/GREEN|YELLOW|ORANGE|RED/);
    expect(data.readinessComponents.hrv).not.toBeNull();
  });

  it("a half-synced morning still gets a finite score and a real band", async () => {
    findFirst.mockResolvedValue({
      id: "row-1",
      userMorning: MORNING,
      garmin: { bodyBatteryMorning: 70, rhr: 55 },
    });
    await refreshStoredReadiness("u1", DAY);
    const data = update.mock.calls[0][0].data;
    expect(Number.isFinite(data.readinessScore)).toBe(true);
    expect(data.readinessComponents.hrv).toBeNull();
  });

  it("no morning input → no readiness to refresh", async () => {
    findFirst.mockResolvedValue({ id: "row-1", userMorning: null, garmin: { rhr: 55 } });
    expect(await refreshStoredReadiness("u1", DAY)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
