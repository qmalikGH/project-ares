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
const buildRunImport = vi.hoisted(() => vi.fn());
const buildStrengthImport = vi.hoisted(() => vi.fn());

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
vi.mock("@/lib/garmin/run-import", () => ({ buildRunImport, buildStrengthImport }));

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

  // Sprint 3.2a — this used to write the planned 60 min into durationActualMin,
  // i.e. store the plan as a measurement. The load stays visible (the estimate
  // moved into getRecentDailyLoads), but the column says "unknown".
  it("keeps the planned duration out of durationActualMin and flags the load as estimated", async () => {
    const res = await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1 }],
    }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("durationActualMin");
    expect(data.executedSession).toMatchObject({ source: "attested", durationEstimated: true, durationActualMin: 60 });
    const body = await res.json();
    expect(body.results[0].dailyLoadAu).toBe(480);
    expect(body.results[0].loadEstimated).toBe(true);
  });

  it("a typed-in duration is stored as actual and not flagged", async () => {
    const res = await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 1, durationActualMin: 48 }],
    }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data.durationActualMin).toBe(48);
    expect(data.executedSession).not.toHaveProperty("durationEstimated");
    const body = await res.json();
    expect(body.results[0].dailyLoadAu).toBe(384);
    expect(body.results[0].loadEstimated).toBe(false);
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

// ── Sprint 3.2a ─────────────────────────────────────────────────────────────

function plannedRun(over: Record<string, unknown> = {}) {
  return {
    id: "w-run", date: WORKOUT_DATE, type: "easy_run", status: "planned",
    rpe: null, durationActualMin: null, notes: null,
    plannedSession: { type: "easy_run", durationMin: 30 },
    executedSession: null,
    ...over,
  };
}

// The ad-hoc gym run of 01.09.: "Berlin Running", 13 min, no workout id.
const PICKED_RUN = {
  executedSession: { ...GARMIN_EXEC, source: "garmin_import", garminActivityId: 777, durationSec: 780 },
  durationActualMin: 13,
  activityId: "777",
};

describe("Sprint 3.2a — picking the Garmin recording", () => {
  it("imports the picked activity: real duration, activity link, shin merged", async () => {
    workoutFindFirst
      .mockResolvedValueOnce(plannedRun()) // the workout
      .mockResolvedValueOnce(null); // nobody else owns activity 777
    buildRunImport.mockResolvedValue(PICKED_RUN);

    const res = await POST(post({
      items: [{ workoutId: "w-run", action: "attest", rpe: 4, shinPainNrs: 0, garminActivityId: 777 }],
    }));
    expect(buildRunImport).toHaveBeenCalledWith(777, "garmin_import");
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("completed");
    expect(data.garminActivityId).toBe("777");
    expect(data.durationActualMin).toBe(13);
    expect(data.executedSession).toMatchObject({ source: "garmin_import", durationSec: 780, shinPainNrs: 0 });
    expect(data.executedSession).not.toHaveProperty("durationEstimated");
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ outcome: "attested", dailyLoadAu: 52, loadEstimated: false });
  });

  it("refuses an activity another workout already owns — nothing written", async () => {
    workoutFindFirst
      .mockResolvedValueOnce(plannedRun())
      .mockResolvedValueOnce({ id: "w-other" });
    const res = await POST(post({
      items: [{ workoutId: "w-run", action: "attest", rpe: 4, shinPainNrs: 0, garminActivityId: 777 }],
    }));
    expect(buildRunImport).not.toHaveBeenCalled();
    expect(workoutUpdate).not.toHaveBeenCalled();
    expect((await res.json()).results[0].outcome).toBe("activity_taken");
  });

  it("refuses the same activity twice in one batch (offered for Mon and Tue)", async () => {
    workoutFindFirst
      .mockResolvedValueOnce(plannedRun({ id: "w-mon" }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(plannedRun({ id: "w-tue" }));
    buildRunImport.mockResolvedValue(PICKED_RUN);
    const res = await POST(post({
      items: [
        { workoutId: "w-mon", action: "attest", rpe: 4, shinPainNrs: 0, garminActivityId: 777 },
        { workoutId: "w-tue", action: "attest", rpe: 4, shinPainNrs: 0, garminActivityId: 777 },
      ],
    }));
    const body = await res.json();
    expect(body.results.map((r: { outcome: string }) => r.outcome)).toEqual(["attested", "activity_taken"]);
    expect(workoutUpdate).toHaveBeenCalledTimes(1);
  });

  it("a Garmin failure is an error for that item — no fallback to the plan", async () => {
    workoutFindFirst.mockResolvedValueOnce(plannedRun()).mockResolvedValueOnce(null);
    buildRunImport.mockRejectedValue(new Error("403"));
    const res = await POST(post({
      items: [{ workoutId: "w-run", action: "attest", rpe: 4, shinPainNrs: 0, garminActivityId: 777 }],
    }));
    expect(workoutUpdate).not.toHaveBeenCalled();
    expect((await res.json()).results[0].outcome).toBe("error");
  });

  it("a garmin_auto row cannot be re-linked to another activity", async () => {
    workoutFindFirst.mockResolvedValueOnce(autoRun());
    const res = await POST(post({
      items: [{ workoutId: "w-run", action: "attest", rpe: 4, shinPainNrs: 0, garminActivityId: 777 }],
    }));
    expect(workoutUpdate).not.toHaveBeenCalled();
    expect((await res.json()).results[0].outcome).toBe("not_eligible");
  });

  it("a run confirmed without recording or minutes keeps the column null", async () => {
    workoutFindFirst.mockResolvedValueOnce(plannedRun());
    const res = await POST(post({
      items: [{ workoutId: "w-run", action: "attest", rpe: 7, shinPainNrs: 0 }],
    }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("durationActualMin");
    expect(data.executedSession).toMatchObject({ source: "attested", durationSec: 1800, durationEstimated: true });
    expect((await res.json()).results[0]).toMatchObject({ dailyLoadAu: 210, loadEstimated: true });
  });
});

describe("Sprint 3.2a — top sets", () => {
  it("writes ONE ExerciseLog row per top set, rated with the session RPE", async () => {
    workoutFindFirst.mockResolvedValue(plannedStrength());
    const res = await POST(post({
      items: [{
        workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 0,
        topSets: [
          { exercise: "Hex Bar Deadlift", weightKg: 100, reps: 5 },
          { exercise: "Face Pulls", weightKg: 25, reps: 15 },
        ],
      }],
    }));
    const rows = exerciseLogCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exerciseName: "Hex Bar Deadlift", weightKg: 100, repsCompleted: 5, rpe: 8 });
    const body = await res.json();
    expect(body.results[0].rejectedTopSets).toEqual(["Face Pulls"]);
  });

  it("strength from the watch gets its sets — the Garmin payload stays byte-identical", async () => {
    const watchExec = {
      type: "strength", source: "garmin_auto", garminActivityId: 555,
      startTimeLocal: "2026-10-05 18:02:00", durationActualMin: 64, exercises: [],
      averageHr: 118, maxHr: 151, calories: 410,
    };
    workoutFindFirst.mockResolvedValue(plannedStrength({
      status: "completed", durationActualMin: 64, executedSession: watchExec,
    }));
    await POST(post({
      items: [{
        workoutId: "w-str", action: "attest", rpe: 7, shinPainNrs: 0,
        topSets: [{ exercise: "Hex Bar Deadlift", weightKg: 90, reps: 5 }],
      }],
    }));
    const data = workoutUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("garminActivityId");
    const { exercises, shinPainNrs, ...rest } = data.executedSession;
    const { exercises: emptyFromWatch, ...watchFields } = watchExec;
    expect(emptyFromWatch).toEqual([]);
    expect(rest).toEqual(watchFields);
    expect(shinPainNrs).toBe(0);
    expect(exercises).toHaveLength(1);
    const rows = exerciseLogCreateMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ exerciseName: "Hex Bar Deadlift", weightKg: 90, rpe: 7 });
  });

  it("the as-prescribed claim alone writes sets without an RPE (volume, not evidence)", async () => {
    workoutFindFirst.mockResolvedValue(plannedStrength());
    await POST(post({
      items: [{ workoutId: "w-str", action: "attest", rpe: 8, shinPainNrs: 0, asPrescribed: true }],
    }));
    const rows = exerciseLogCreateMany.mock.calls[0][0].data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: { rpe: number | null }) => r.rpe === null)).toBe(true);
  });
});
