// POST /api/sessions/confirm — Sprint 3.0.
//
// This route writes to sessions the athlete already trained, so most of these
// tests are about what it must NOT touch: the imported Garmin payload, the
// activity link, a hand-logged session, another user's rows.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutFindFirst = vi.hoisted(() => vi.fn());
const workoutUpdate = vi.hoisted(() => vi.fn());
const exerciseLogDeleteMany = vi.hoisted(() => vi.fn());
const exerciseLogCreateMany = vi.hoisted(() => vi.fn());
const weeklyPlanFindFirst = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const regenerate = vi.hoisted(() => vi.fn());
const currentUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  db: {
    workout: { findFirst: workoutFindFirst, update: workoutUpdate },
    exerciseLog: { deleteMany: exerciseLogDeleteMany, createMany: exerciseLogCreateMany },
    weeklyPlan: { findFirst: weeklyPlanFindFirst },
    $transaction: transaction,
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUserId: currentUser }));
vi.mock("@/lib/db/queries/regenerate-plans", () => ({ regeneratePlansFromNow: regenerate }));

import { POST } from "@/app/api/sessions/confirm/route";

const WORKOUT_DATE = new Date("2026-08-24T00:00:00.000Z");

const GARMIN_EXEC = {
  type: "run",
  source: "garmin_auto",
  garminActivityId: 24151655312,
  startTimeLocal: "2026-08-28 19:57:00",
  durationSec: 840,
  distanceM: 2332,
  averagePaceSecPerKm: 360,
  averageHr: 157,
  maxHr: 170,
  elevationGainM: 5,
  calories: 190,
  splits: [{ splitNumber: 1, distanceM: 1000, durationSec: 360, paceSecPerKm: 360, averageHr: 150, maxHr: 160 }],
  garminHrZones: { zone1Sec: 10, zone2Sec: 20, zone3Sec: 30, zone4Sec: 0, zone5Sec: 0 },
  polarizedTID: { z1Sec: 30, z2Sec: 30, z3Sec: 0, z1Pct: 50, z2Pct: 50, z3Pct: 0, totalSec: 60 },
};

function autoRun(over: Record<string, unknown> = {}) {
  return {
    id: "w-run", date: WORKOUT_DATE, type: "easy_run", status: "completed",
    rpe: null, durationActualMin: 14, notes: null,
    plannedSession: { type: "easy_run", durationMin: 34 },
    executedSession: GARMIN_EXEC,
    ...over,
  };
}

function plannedStrength(over: Record<string, unknown> = {}) {
  return {
    id: "w-str", date: WORKOUT_DATE, type: "strength_a", status: "planned",
    rpe: null, durationActualMin: null, notes: null,
    plannedSession: {
      type: "strength_a", durationMin: 60,
      exercises: [
        { name: "Warmup Goblet Squat", sets: 2, reps: 10, loadAbs: 20, isWarmup: true },
        { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, loadAbs: 120 },
        { name: "Face Pulls", sets: 3, reps: 15 },
        { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg" },
      ],
    },
    executedSession: null,
    ...over,
  };
}

function post(body: unknown) {
  return new Request("https://x/api/sessions/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue("u1");
  workoutUpdate.mockResolvedValue({});
  transaction.mockResolvedValue([]);
  weeklyPlanFindFirst.mockResolvedValue({ weekNumber: 2, phase: { config: { durationWeeks: 4 } } });
  regenerate.mockResolvedValue({
    regenerated: 3, gate: "progress", gateReason: "shin calm, resting HR at baseline",
    layoff: { active: false, gapDays: 0, restartWeekStart: null },
  });
});

describe("validation", () => {
  it("rejects an empty body", async () => {
    expect((await POST(post({}))).status).toBe(400);
  });

  it("rejects attesting without a shin score", async () => {
    const res = await POST(post({ items: [{ workoutId: "w1", action: "attest", rpe: 7 }] }));
    expect(res.status).toBe(400);
  });

  it("rejects attesting without an RPE", async () => {
    const res = await POST(post({ items: [{ workoutId: "w1", action: "attest", shinPainNrs: 2 }] }));
    expect(res.status).toBe(400);
  });

  // rpe 0 would pass the `rpe != null` filter in getRecentDailyLoads and put a
  // zero-load day into the EWMA.
  it("rejects rpe 0", async () => {
    const res = await POST(post({ items: [{ workoutId: "w1", action: "attest", rpe: 0, shinPainNrs: 2 }] }));
    expect(res.status).toBe(400);
  });

  it("rejects more than 20 items", async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      workoutId: `w${i}`, action: "attest", rpe: 7, shinPainNrs: 1,
    }));
    expect((await POST(post({ items }))).status).toBe(400);
  });
});

describe("cohort garmin_auto — the imported session must survive", () => {
  beforeEach(() => workoutFindFirst.mockResolvedValue(autoRun()));

  it("puts rpe on the column and shin inside the JSON", async () => {
    await POST(post({ items: [{ workoutId: "w-run", action: "attest", rpe: 7, shinPainNrs: 2 }] }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data.rpe).toBe(7);
    expect((data.executedSession as Record<string, unknown>).shinPainNrs).toBe(2);
    // rpe inside the JSON would be stripped by the next zod re-parse.
    expect(Object.prototype.hasOwnProperty.call(data.executedSession, "rpe")).toBe(false);
  });

  it("never touches status or garminActivityId", async () => {
    // The regression against sessions/complete, which sets status
    // unconditionally and nulls the activity link.
    await POST(post({ items: [{ workoutId: "w-run", action: "attest", rpe: 7, shinPainNrs: 2 }] }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(Object.prototype.hasOwnProperty.call(data, "status")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(data, "garminActivityId")).toBe(false);
  });

  it("keeps splits, HR zones and polarizedTID byte-identical", async () => {
    await POST(post({ items: [{ workoutId: "w-run", action: "attest", rpe: 7, shinPainNrs: 2 }] }));
    const written = workoutUpdate.mock.calls[0][0].data.executedSession as Record<string, unknown>;
    expect(written.splits).toEqual(GARMIN_EXEC.splits);
    expect(written.garminHrZones).toEqual(GARMIN_EXEC.garminHrZones);
    expect(written.polarizedTID).toEqual(GARMIN_EXEC.polarizedTID);
    expect(written.garminActivityId).toBe(GARMIN_EXEC.garminActivityId);
  });

  it("writes no ExerciseLog rows for a run", async () => {
    await POST(post({ items: [{ workoutId: "w-run", action: "attest", rpe: 7, shinPainNrs: 2 }] }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses to mark an imported session as skipped", async () => {
    const res = await POST(post({ items: [{ workoutId: "w-run", action: "skip" }] }));
    const body = await res.json();
    expect(body.results[0].outcome).toBe("not_skippable");
    expect(workoutUpdate).not.toHaveBeenCalled();
  });
});

describe("cohort planned — strength", () => {
  beforeEach(() => workoutFindFirst.mockResolvedValue(plannedStrength()));

  it("materialises only the loggable prescribed sets", async () => {
    await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1, asPrescribed: true }],
    }));
    const rows = transaction.mock.calls[0][0];
    expect(rows).toHaveLength(2); // deleteMany + createMany
    const created = exerciseLogCreateMany.mock.calls[0][0].data;
    expect(created).toHaveLength(4); // Hex Bar Deadlift, 4 sets
    expect(created.every((r: { exerciseName: string }) => r.exerciseName === "Hex Bar Deadlift")).toBe(true);
  });

  it("stamps the ExerciseLog rows with the workout's date, not today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T18:00:00.000Z"));
    await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1, asPrescribed: true }],
    }));
    const created = exerciseLogCreateMany.mock.calls[0][0].data;
    expect(created[0].date.toISOString().slice(0, 10)).toBe("2026-08-24");
    vi.useRealTimers();
  });

  it("excludes warmups from both the payload and the log", async () => {
    await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1, asPrescribed: true }],
    }));
    const exec = workoutUpdate.mock.calls[0][0].data.executedSession as { exercises: { name: string }[] };
    expect(exec.exercises.map((e) => e.name)).not.toContain("Warmup Goblet Squat");
    const created = exerciseLogCreateMany.mock.calls[0][0].data;
    expect(created.some((r: { exerciseName: string }) => r.exerciseName === "Warmup Goblet Squat")).toBe(false);
  });

  it("without asPrescribed it rates the session but logs no sets", async () => {
    await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1 }],
    }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data.rpe).toBe(8);
    expect((data.executedSession as { exercises: unknown[] }).exercises).toHaveLength(0);
    expect(exerciseLogCreateMany).not.toHaveBeenCalled();
  });

  it("fills the duration from the planned session so the load becomes visible", async () => {
    // getRecentDailyLoads needs rpe AND durationActualMin; a planned row has none.
    const res = await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1 }],
    }));
    expect(workoutUpdate.mock.calls[0][0].data.durationActualMin).toBe(60);
    const body = await res.json();
    expect(body.results[0].dailyLoadAu).toBe(480);
  });

  it("reports attested_no_load when no duration can be resolved", async () => {
    workoutFindFirst.mockResolvedValue(plannedStrength({ plannedSession: { type: "strength_a" } }));
    const res = await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1 }],
    }));
    const body = await res.json();
    expect(body.results[0].outcome).toBe("attested_no_load");
    expect(workoutUpdate).toHaveBeenCalled(); // still rated
  });
});

describe("idempotency", () => {
  beforeEach(() => workoutFindFirst.mockResolvedValue(plannedStrength()));

  it("deletes this workout's rows before inserting, scoped to that one id", async () => {
    await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1, asPrescribed: true }],
    }));
    expect(exerciseLogDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1", workoutId: "w-str" } });
  });

  it("a correction that un-claims the session removes the rows", async () => {
    await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1, asPrescribed: false }],
    }));
    // delete still runs (inside the transaction), create does not
    expect(exerciseLogDeleteMany).toHaveBeenCalled();
    expect(exerciseLogCreateMany).not.toHaveBeenCalled();
  });

  it("submitting twice produces the same number of rows", async () => {
    const payload = { items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1, asPrescribed: true }] };
    await POST(post(payload));
    const first = exerciseLogCreateMany.mock.calls[0][0].data.length;
    vi.clearAllMocks();
    currentUser.mockResolvedValue("u1");
    workoutFindFirst.mockResolvedValue(plannedStrength());
    workoutUpdate.mockResolvedValue({});
    transaction.mockResolvedValue([]);
    weeklyPlanFindFirst.mockResolvedValue({ weekNumber: 2, phase: { config: { durationWeeks: 4 } } });
    regenerate.mockResolvedValue({ regenerated: 1, gate: "progress", gateReason: "ok", layoff: { active: false, gapDays: 0, restartWeekStart: null } });
    await POST(post(payload));
    expect(exerciseLogCreateMany.mock.calls[0][0].data.length).toBe(first);
  });
});

describe("what it refuses", () => {
  it("never overwrites a hand-logged session", async () => {
    workoutFindFirst.mockResolvedValue(autoRun({
      rpe: 7, executedSession: { ...GARMIN_EXEC, source: "garmin_import" },
    }));
    const res = await POST(post({ items: [{ workoutId: "w-run", action: "attest", rpe: 5, shinPainNrs: 3 }] }));
    const body = await res.json();
    expect(body.results[0].outcome).toBe("not_eligible");
    expect(workoutUpdate).not.toHaveBeenCalled();
  });

  it("does not touch another user's workout", async () => {
    workoutFindFirst.mockResolvedValue(null);
    const res = await POST(post({ items: [{ workoutId: "someone-else", action: "attest", rpe: 7, shinPainNrs: 1 }] }));
    const body = await res.json();
    expect(body.results[0].outcome).toBe("not_found");
    expect(workoutUpdate).not.toHaveBeenCalled();
  });

  it("keeps going after a bad item and reports both", async () => {
    workoutFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(autoRun());
    const res = await POST(post({
      items: [
        { workoutId: "missing", action: "attest", rpe: 7, shinPainNrs: 1 },
        { workoutId: "w-run", action: "attest", rpe: 7, shinPainNrs: 1 },
      ],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.attested).toBe(1);
    expect(body.failed).toBe(1);
  });
});

describe("skip", () => {
  it("marks a planned session skipped and appends to the notes", async () => {
    workoutFindFirst.mockResolvedValue(plannedStrength({ notes: "war krank" }));
    await POST(post({ items: [{ workoutId: "w-str", action: "skip" }] }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("skipped");
    expect(data.notes).toContain("war krank");
    expect(data.notes).toContain("Ausgefallen");
    expect(Object.prototype.hasOwnProperty.call(data, "rpe")).toBe(false);
    expect(exerciseLogCreateMany).not.toHaveBeenCalled();
  });
});

describe("regeneration", () => {
  beforeEach(() => workoutFindFirst.mockResolvedValue(autoRun()));

  it("runs exactly once for a batch and reports the gate verbatim", async () => {
    workoutFindFirst.mockResolvedValue(autoRun());
    const res = await POST(post({
      items: [
        { workoutId: "a", action: "attest", rpe: 7, shinPainNrs: 1 },
        { workoutId: "b", action: "attest", rpe: 6, shinPainNrs: 2 },
        { workoutId: "c", action: "attest", rpe: 8, shinPainNrs: 0 },
      ],
    }));
    const body = await res.json();
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(body.regenerate.gate).toBe("progress");
    expect(body.regenerate.gateReason).toBe("shin calm, resting HR at baseline");
  });

  it("can be turned off", async () => {
    await POST(post({
      items: [{ workoutId: "w-run", action: "attest", rpe: 7, shinPainNrs: 1 }],
      regenerate: false,
    }));
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("does not regenerate when nothing changed", async () => {
    workoutFindFirst.mockResolvedValue(null);
    await POST(post({ items: [{ workoutId: "nope", action: "attest", rpe: 7, shinPainNrs: 1 }] }));
    expect(regenerate).not.toHaveBeenCalled();
  });
});
