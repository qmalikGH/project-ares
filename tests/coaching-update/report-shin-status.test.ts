// Sprint 3.4 (#28, C3): the coach enters a shin report from the chat.
import { beforeEach, describe, expect, it, vi } from "vitest";

const coachingLogCreate = vi.hoisted(() => vi.fn());
const upsertShinReport = vi.hoisted(() => vi.fn());
const regenerate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({ db: { coachingLog: { create: coachingLogCreate } } }));
vi.mock("@/lib/db/queries/shin-signal", () => ({ upsertShinReport }));
vi.mock("@/lib/db/queries/regenerate-plans", () => ({ regeneratePlansFromNow: regenerate }));

import { handleCoachingAction } from "@/lib/coaching-update/handle-action";

const REASON = "Athlet meldet im Chat seinen Wochenstand";

beforeEach(() => {
  vi.clearAllMocks();
  coachingLogCreate.mockResolvedValue({ id: "log1" });
  upsertShinReport.mockResolvedValue(undefined);
  regenerate.mockResolvedValue({ gate: "progress" });
});

describe("reportShinStatus", () => {
  it("stores the report as source coach, logs it and regenerates two weeks", async () => {
    const r = await handleCoachingAction("u1", "reportShinStatus", { date: "2026-11-26", painNrs: 2 }, REASON);
    expect(r).toEqual({ success: true, logId: "log1", action: "reportShinStatus" });
    expect(upsertShinReport).toHaveBeenCalledWith("u1", new Date("2026-11-26T00:00:00.000Z"), 2, "coach");
    expect(coachingLogCreate.mock.calls[0][0].data).toMatchObject({ action: "reportShinStatus", reason: REASON });
    expect(regenerate).toHaveBeenCalledWith("u1", { horizonWeeks: 2 });
  });

  it("keeps the report when the regeneration fails", async () => {
    regenerate.mockRejectedValue(new Error("db busy"));
    const r = await handleCoachingAction("u1", "reportShinStatus", { date: "2026-11-26", painNrs: 0 }, REASON);
    expect(r.success).toBe(true);
    expect(upsertShinReport).toHaveBeenCalled();
  });

  it.each([
    [{ date: "26.11.2026", painNrs: 2 }],
    [{ date: "2026-11-26", painNrs: 11 }],
    [{ date: "2026-11-26", painNrs: 2.5 }],
    [{ date: "2026-11-26" }],
    [{ date: "2026-11-26", painNrs: 2, extra: true }],
  ])("rejects invalid data %j", async (data) => {
    const r = await handleCoachingAction("u1", "reportShinStatus", data, REASON);
    expect(r).toMatchObject({ success: false, status: 400, error: "invalid_data" });
    expect(upsertShinReport).not.toHaveBeenCalled();
  });

  it("rejects a date in the future", async () => {
    const r = await handleCoachingAction("u1", "reportShinStatus", { date: "2099-01-01", painNrs: 1 }, REASON);
    expect(r).toMatchObject({ success: false, error: "date_in_future" });
  });
});
