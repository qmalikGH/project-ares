// Sprint 3.4 (#28, C1): /today, /sessions/start and explain-session share one
// modulation context — and it no longer requires the morning input.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSensorDataOnDate = vi.hoisted(() => vi.fn());
const getRecentSensorData = vi.hoisted(() => vi.fn());
const getRecentDailyLoads = vi.hoisted(() => vi.fn());
const workoutFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({ db: { workout: { findMany: workoutFindMany } } }));
vi.mock("@/lib/db/queries/sensors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/queries/sensors")>()),
  getSensorDataOnDate,
  getRecentSensorData,
  getRecentDailyLoads,
}));
vi.mock("@/lib/db/queries/settings", () => ({ getEffectiveVdot: vi.fn(async () => 40) }));

import { buildModulationContext } from "@/lib/db/queries/modulation-context";

const TODAY = new Date("2026-11-27T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  getRecentSensorData.mockResolvedValue([]);
  getRecentDailyLoads.mockResolvedValue([]);
  workoutFindMany.mockResolvedValue([]);
});

describe("buildModulationContext without a morning input", () => {
  it("returns a neutral context when there is no row at all", async () => {
    getSensorDataOnDate.mockResolvedValue(null);
    const ctx = await buildModulationContext("u", TODAY);
    expect(ctx.morningInputPending).toBe(true);
    expect(ctx.sensorRowId).toBeNull();
    expect(ctx.readiness).toMatchObject({ score: 80, band: "GREEN" });
    // "No symptoms reported" for the knee model: no knee rule fires.
    expect(ctx.limitations.kneeScoreToday).toBe(1);
  });

  it("uses the watch values when they arrived", async () => {
    getSensorDataOnDate.mockResolvedValue({
      id: "row1",
      garmin: { hrvRmssd: 20, sleepScore: 30, bodyBatteryMorning: 15, rhr: 70 },
      userMorning: null,
      therapyPhase: "REMODELING",
    });
    const ctx = await buildModulationContext("u", TODAY);
    expect(ctx.morningInputPending).toBe(true);
    expect(ctx.sensorRowId).toBe("row1");
    expect(ctx.readiness.band).not.toBe("GREEN");
    expect(ctx.readiness.components.subjective).toBeNull();
  });

  it("with a morning input nothing changes", async () => {
    getSensorDataOnDate.mockResolvedValue({
      id: "row1",
      garmin: null,
      userMorning: { subjectiveRecovery: 7, morningStiffness: 3, stairsScore: 3 },
      therapyPhase: "REMODELING",
    });
    const ctx = await buildModulationContext("u", TODAY);
    expect(ctx.morningInputPending).toBe(false);
    expect(ctx.limitations.kneeScoreToday).toBe(3);
    expect(ctx.readiness.band).toBe("YELLOW"); // A8 fallback, unchanged
  });
});
