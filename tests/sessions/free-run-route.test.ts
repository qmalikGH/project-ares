// POST /api/sessions/free-run — Sprint 3.3b (#25 · 9): a run on a day with
// nothing planned counts like any confirmed run.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutFindFirst = vi.hoisted(() => vi.fn());
const workoutCreate = vi.hoisted(() => vi.fn());
const regenerate = vi.hoisted(() => vi.fn());
const buildRunImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: { workout: { findFirst: workoutFindFirst, create: workoutCreate } },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUserId: vi.fn(async () => "u1") }));
vi.mock("@/lib/date", () => ({ userTodayDynamic: vi.fn(async () => new Date("2026-10-31T00:00:00.000Z")) }));
vi.mock("@/lib/db/queries/regenerate-plans", () => ({ regeneratePlansFromNow: regenerate }));
vi.mock("@/lib/garmin/run-import", () => ({ buildRunImport }));

import { POST } from "@/app/api/sessions/free-run/route";

const post = (body: unknown) =>
  new Request("https://x/api/sessions/free-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  workoutFindFirst.mockResolvedValue(null);
  workoutCreate.mockResolvedValue({ id: "w-new" });
  regenerate.mockResolvedValue({ regenerated: 4, gate: "progress", gateReason: "ok", layoff: { active: false } });
});

describe("POST /api/sessions/free-run", () => {
  it("stores a typed-in run as a completed, attested easy run and regenerates", async () => {
    const res = await POST(post({ date: "2026-10-30", durationActualMin: 25, rpe: 4, shinPainNrs: 0 }));
    expect(res.status).toBe(200);
    const data = workoutCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: "easy_run",
      status: "completed",
      durationActualMin: 25,
      rpe: 4,
      garminActivityId: null,
    });
    expect(data.date).toEqual(new Date("2026-10-30T00:00:00.000Z"));
    expect(data.executedSession).toMatchObject({ type: "run", source: "attested", durationSec: 1500, shinPainNrs: 0 });
    expect(data.executedSession.durationEstimated).toBeUndefined();
    expect(data.plannedSession).toMatchObject({ unplanned: true, durationMin: 25 });
    expect(regenerate).toHaveBeenCalledWith("u1");
  });

  it("a picked Garmin run brings its own minutes and link", async () => {
    buildRunImport.mockResolvedValue({
      executedSession: { type: "run", source: "garmin_import", durationSec: 1740, distanceM: 4800 },
      durationActualMin: 29,
      activityId: "777",
    });
    const res = await POST(post({ date: "2026-10-30", garminActivityId: 777, rpe: 5, shinPainNrs: 1 }));
    expect(res.status).toBe(200);
    const data = workoutCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ durationActualMin: 29, garminActivityId: "777" });
    expect(data.executedSession).toMatchObject({ source: "garmin_import", distanceM: 4800, shinPainNrs: 1 });
  });

  it("refuses a run with neither minutes nor a recording", async () => {
    const res = await POST(post({ date: "2026-10-30", rpe: 4, shinPainNrs: 0 }));
    expect(res.status).toBe(400);
    expect(workoutCreate).not.toHaveBeenCalled();
  });

  it("a day with a planned easy run points to that session instead", async () => {
    workoutFindFirst.mockResolvedValueOnce({ id: "w-planned", status: "planned" });
    const res = await POST(post({ date: "2026-10-29", durationActualMin: 25, rpe: 4, shinPainNrs: 0 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "planned_session_exists", workoutId: "w-planned" });
    expect(workoutCreate).not.toHaveBeenCalled();
  });

  it("refuses dates in the future or outside the 14-day window", async () => {
    expect((await POST(post({ date: "2026-11-01", durationActualMin: 25, rpe: 4, shinPainNrs: 0 }))).status).toBe(400);
    expect((await POST(post({ date: "2026-10-16", durationActualMin: 25, rpe: 4, shinPainNrs: 0 }))).status).toBe(400);
    expect((await POST(post({ date: "2026-10-17", durationActualMin: 25, rpe: 4, shinPainNrs: 0 }))).status).toBe(200);
  });

  it("a Garmin activity already behind a workout is not imported twice", async () => {
    workoutFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "w-other" });
    const res = await POST(post({ date: "2026-10-30", garminActivityId: 777, rpe: 5, shinPainNrs: 1 }));
    expect(res.status).toBe(409);
    expect(buildRunImport).not.toHaveBeenCalled();
  });
});
