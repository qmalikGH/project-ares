// Unattended session import — Sprint 2.9, rebuilt in Sprint 3.4 (#28).
//
// The module writes to the database without anybody looking, so most tests
// are about what it refuses to do: never complete quality without identity,
// never match across days, never fail on a collision, never invent an RPE.
import { beforeEach, describe, expect, it, vi } from "vitest";

const actFindMany = vi.hoisted(() => vi.fn());
const actUpdate = vi.hoisted(() => vi.fn());
const workoutFindMany = vi.hoisted(() => vi.fn());
const workoutUpdateMany = vi.hoisted(() => vi.fn());
const workoutCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => {
  const db = {
    garminActivity: { findMany: actFindMany, update: actUpdate },
    workout: { findMany: workoutFindMany, updateMany: workoutUpdateMany, create: workoutCreate },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});

import { autoImportFromStore, FREE_RUN_MIN_SEC } from "@/lib/garmin/auto-import";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const WINDOW = { from: d("2026-11-13"), to: d("2026-11-26") };

let seq = 0;
function activity(day: string, over: Record<string, unknown> = {}) {
  seq++;
  return {
    id: `g${seq}`,
    userId: "u",
    activityId: String(24000000000 + seq),
    activityName: "Berlin Running",
    startTimeLocal: `${day} 18:00:00`,
    localDate: d(day),
    startTimeGMT: null,
    category: "run",
    garminType: "running",
    durationSec: 20 * 60,
    distanceM: 3500,
    averageHr: 140,
    maxHr: 160,
    averagePaceSecPerKm: 343,
    elevationGainM: 5,
    calories: 200,
    workoutId: null as string | null,
    splits: [],
    hrZones: null,
    raw: {},
    fetchedAt: new Date(),
    updatedAt: new Date(),
    detailFetchedAt: new Date(),
    workoutRefId: null,
    ...over,
  };
}

function planned(day: string, type: string, over: Record<string, unknown> = {}) {
  return { id: `w-${day}-${type}`, date: d(day), type, garminWorkoutId: null as string | null, ...over };
}

function setup(acts: unknown[], plannedRows: unknown[], legacy: unknown[] = []) {
  actFindMany.mockResolvedValue(acts);
  workoutFindMany.mockImplementation(async (args: { where: { status?: string } }) =>
    args.where.status === "planned" ? plannedRows : legacy,
  );
}

/** The data of the updateMany call that completed workout `id`, if any. */
function completedData(id: string) {
  const call = workoutUpdateMany.mock.calls.find((c) => c[0].where.id === id);
  return call?.[0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  workoutUpdateMany.mockResolvedValue({ count: 1 });
  workoutCreate.mockImplementation(async () => ({ id: "free-1" }));
  actUpdate.mockResolvedValue({});
});

describe("pass 1 — identity", () => {
  it("completes the session the activity was started from, any type", async () => {
    const run = activity("2026-11-17", { workoutId: "777" });
    const strength = activity("2026-11-16", { workoutId: "555", category: "strength", durationSec: 3300 });
    setup(
      [strength, run],
      [
        planned("2026-11-16", "strength_a", { garminWorkoutId: "555" }),
        planned("2026-11-17", "threshold_run", { garminWorkoutId: "777" }),
      ],
    );
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.imported.map((i) => [i.type, i.match])).toEqual([
      ["strength_a", "identity"],
      ["threshold_run", "identity"],
    ]);
    const data = completedData("w-2026-11-17-threshold_run");
    expect(data.status).toBe("completed");
    expect(data.garminActivityId).toBe(run.activityId);
    expect(data.executedSession).toMatchObject({ type: "run", source: "garmin_auto", autoMatch: "identity" });
    expect(data).not.toHaveProperty("rpe");
    expect(completedData("w-2026-11-16-strength_a").executedSession).toMatchObject({
      type: "strength", exercises: [], autoMatch: "identity",
    });
    // The activity is linked back to the session.
    expect(actUpdate).toHaveBeenCalledWith({ where: { id: run.id }, data: { workoutRefId: "w-2026-11-17-threshold_run" } });
  });

  it("never matches the pushed id across days", async () => {
    setup(
      [activity("2026-11-18", { workoutId: "777", durationSec: 5 * 60 })],
      [planned("2026-11-17", "threshold_run", { garminWorkoutId: "777" })],
    );
    const r = await autoImportFromStore("u", WINDOW);
    expect(workoutUpdateMany).not.toHaveBeenCalled();
    expect(r.imported).toEqual([]);
  });
});

describe("pass 2 — same day", () => {
  it("completes an open easy run with a run of that day, even without a pushed workout", async () => {
    setup([activity("2026-11-16")], [planned("2026-11-16", "easy_run")]);
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.imported[0]).toMatchObject({ type: "easy_run", match: "same_day", durationActualMin: 20 });
  });

  it("has no minimum duration — a short run on an easy day counts with its real minutes (Q, 27.11.)", async () => {
    setup([activity("2026-11-16", { durationSec: 9 * 60 })], [planned("2026-11-16", "easy_run")]);
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.imported[0]).toMatchObject({ match: "same_day", durationActualMin: 9 });
  });

  it("gives the long run the longest run of the day", async () => {
    setup(
      [activity("2026-11-21", { durationSec: 1200 }), activity("2026-11-21", { durationSec: 2700 })],
      [planned("2026-11-21", "easy_run"), planned("2026-11-21", "long_run")],
    );
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.imported.find((i) => i.type === "long_run")?.durationActualMin).toBe(45);
    expect(r.imported.find((i) => i.type === "easy_run")?.durationActualMin).toBe(20);
  });

  it.each(["threshold_run", "vo2max_intervals", "time_trial_5k"])(
    "never completes %s without identity — the run becomes a free run instead",
    async (type) => {
      setup([activity("2026-11-17", { durationSec: 25 * 60 })], [planned("2026-11-17", type)]);
      const r = await autoImportFromStore("u", WINDOW);
      expect(completedData(`w-2026-11-17-${type}`)).toBeUndefined();
      expect(r.imported).toEqual([expect.objectContaining({ type: "easy_run", match: "free_run" })]);
    },
  );
});

describe("pass 3 — free runs", () => {
  it("stores a run ≥ 15 min that matched nothing as its own completed easy run", async () => {
    setup([activity("2026-11-20", { durationSec: FREE_RUN_MIN_SEC })], []);
    const r = await autoImportFromStore("u", WINDOW);
    const data = workoutCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "u",
      date: d("2026-11-20"),
      type: "easy_run",
      status: "completed",
      rpe: null,
      durationActualMin: 15,
      plannedSession: { type: "easy_run", unplanned: true, durationMin: 15 },
    });
    expect(data.executedSession).toMatchObject({ source: "garmin_auto", autoMatch: "free_run" });
    expect(r.imported[0]).toMatchObject({ workoutId: "free-1", match: "free_run" });
    expect(actUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { workoutRefId: "free-1" } }));
  });

  it("leaves a run under 15 min as raw data", async () => {
    setup([activity("2026-11-20", { durationSec: FREE_RUN_MIN_SEC - 1 })], []);
    const r = await autoImportFromStore("u", WINDOW);
    expect(workoutCreate).not.toHaveBeenCalled();
    expect(r.rawOnly).toEqual([expect.objectContaining({ reason: "under_15_min" })]);
  });

  it("leaves a second run on a day that already has an easy run as raw data — no error", async () => {
    workoutCreate.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    setup(
      [activity("2026-11-16", { durationSec: 1800 }), activity("2026-11-16", { durationSec: 1000 })],
      [planned("2026-11-16", "easy_run")],
    );
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.imported).toEqual([expect.objectContaining({ match: "same_day", durationActualMin: 30 })]);
    expect(r.rawOnly).toEqual([expect.objectContaining({ reason: "collision" })]);
    expect(r.errors).toEqual([]);
  });

  it("leaves unmatched strength as raw data", async () => {
    setup([activity("2026-11-19", { category: "strength", durationSec: 3600 })], []);
    const r = await autoImportFromStore("u", WINDOW);
    expect(workoutCreate).not.toHaveBeenCalled();
    expect(r.rawOnly).toEqual([expect.objectContaining({ reason: "unmatched_strength" })]);
  });
});

describe("idempotency and races", () => {
  it("does nothing without unlinked activities in the window", async () => {
    setup([], [planned("2026-11-16", "easy_run")]);
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.imported).toEqual([]);
    expect(actFindMany.mock.calls[0][0].where).toMatchObject({ userId: "u", workoutRefId: null });
  });

  it("reconciles sessions linked before the raw store existed instead of importing again", async () => {
    const a = activity("2026-11-16");
    setup([a], [planned("2026-11-16", "easy_run")], [{ id: "w-old", garminActivityId: a.activityId }]);
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.reconciled).toBe(1);
    expect(actUpdate).toHaveBeenCalledWith({ where: { id: a.id }, data: { workoutRefId: "w-old" } });
    expect(workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("skips an activity a parallel /confirm linked first (P2002) without an error", async () => {
    workoutUpdateMany.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    setup([activity("2026-11-16")], [planned("2026-11-16", "easy_run")]);
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.errors).toEqual([]);
    expect(r.rawOnly).toEqual([expect.objectContaining({ reason: "already_linked" })]);
    expect(workoutCreate).not.toHaveBeenCalled();
  });

  it("leaves a session alone that /confirm closed in the meantime", async () => {
    workoutUpdateMany.mockResolvedValueOnce({ count: 0 });
    setup([activity("2026-11-16", { durationSec: 600 })], [planned("2026-11-16", "easy_run")]);
    const r = await autoImportFromStore("u", WINDOW);
    expect(r.imported).toEqual([]);
    expect(actUpdate).not.toHaveBeenCalled();
    expect(r.errors).toEqual([]);
  });

  it("only touches sessions that are still planned", async () => {
    setup([activity("2026-11-16")], [planned("2026-11-16", "easy_run")]);
    await autoImportFromStore("u", WINDOW);
    expect(workoutUpdateMany.mock.calls[0][0].where).toEqual({ id: "w-2026-11-16-easy_run", status: "planned" });
  });
});

describe("dry run (scripts/import-sessions.ts)", () => {
  it("reports every pass without writing anything", async () => {
    setup(
      [
        activity("2026-11-16", { workoutId: "777" }),
        activity("2026-11-17"),
        activity("2026-11-20", { durationSec: 1800 }),
        activity("2026-11-22", { durationSec: 600 }),
      ],
      [
        planned("2026-11-16", "strength_a", { garminWorkoutId: "777" }),
        planned("2026-11-17", "easy_run"),
      ],
    );
    const r = await autoImportFromStore("u", WINDOW, { dryRun: true });
    expect(r.imported.map((i) => i.match)).toEqual(["identity", "same_day", "free_run"]);
    expect(r.rawOnly).toEqual([expect.objectContaining({ reason: "under_15_min" })]);
    expect(workoutUpdateMany).not.toHaveBeenCalled();
    expect(workoutCreate).not.toHaveBeenCalled();
    expect(actUpdate).not.toHaveBeenCalled();
  });

  it("predicts a collision with an easy run already stored that day", async () => {
    actFindMany.mockResolvedValue([activity("2026-11-20", { durationSec: 1800 })]);
    workoutFindMany.mockImplementation(async (args: { where: { status?: string; type?: string } }) =>
      args.where.type === "easy_run" ? [{ date: d("2026-11-20") }] : [],
    );
    const r = await autoImportFromStore("u", WINDOW, { dryRun: true });
    expect(r.imported).toEqual([]);
    expect(r.rawOnly).toEqual([expect.objectContaining({ reason: "collision" })]);
  });
});

// Review fix (#28, point 3): a run is linked once — details fetched later
// would never reach its executedSession.
describe("runs without details", () => {
  const TODAY = d("2026-11-27");

  it("waits: not linked, reported as details_pending", async () => {
    setup([activity("2026-11-26", { detailFetchedAt: null })], [planned("2026-11-26", "easy_run")]);
    const r = await autoImportFromStore("u", WINDOW, { today: TODAY });
    expect(workoutUpdateMany).not.toHaveBeenCalled();
    expect(workoutCreate).not.toHaveBeenCalled();
    expect(r.rawOnly).toEqual([expect.objectContaining({ reason: "details_pending" })]);
  });

  it("the same run with details is linked, zones included", async () => {
    const zones = { zone1Sec: 600, zone2Sec: 600, zone3Sec: 0, zone4Sec: 0, zone5Sec: 0, zoneFloors: { z1: 1, z2: 2, z3: 3, z4: 4, z5: 5 } };
    setup(
      [activity("2026-11-26", { detailFetchedAt: new Date(), hrZones: zones })],
      [planned("2026-11-26", "easy_run")],
    );
    const r = await autoImportFromStore("u", WINDOW, { today: TODAY });
    expect(r.imported).toEqual([expect.objectContaining({ match: "same_day" })]);
    expect(completedData("w-2026-11-26-easy_run").executedSession.garminHrZones).toMatchObject({ zone1Sec: 600 });
  });

  it("after the grace period it is linked anyway", async () => {
    setup([activity("2026-11-23", { detailFetchedAt: null })], [planned("2026-11-23", "easy_run")]);
    const r = await autoImportFromStore("u", WINDOW, { today: TODAY });
    expect(r.imported).toEqual([expect.objectContaining({ match: "same_day", date: "2026-11-23" })]);
  });

  it("applies to every pass — also the pushed workout and free runs", async () => {
    setup(
      [
        activity("2026-11-25", { workoutId: "777", detailFetchedAt: null }),
        activity("2026-11-26", { durationSec: 1800, detailFetchedAt: null }),
      ],
      [planned("2026-11-25", "threshold_run", { garminWorkoutId: "777" })],
    );
    const r = await autoImportFromStore("u", WINDOW, { today: TODAY });
    expect(r.imported).toEqual([]);
    expect(r.rawOnly.map((x) => x.reason)).toEqual(["details_pending", "details_pending"]);
  });

  it("strength needs no details", async () => {
    setup(
      [activity("2026-11-26", { workoutId: "555", category: "strength", detailFetchedAt: null })],
      [planned("2026-11-26", "strength_a", { garminWorkoutId: "555" })],
    );
    const r = await autoImportFromStore("u", WINDOW, { today: TODAY });
    expect(r.imported).toEqual([expect.objectContaining({ match: "identity" })]);
  });
});
