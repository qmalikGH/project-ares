import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @/lib/db/client + @/lib/garmin/client + @/lib/db/queries/settings
// before importing the module under test. The actual push/remove functions
// are passed in via the `deps` parameter so vi.spyOn ESM caveats don't apply.

vi.mock("@/lib/db/client", () => {
  return {
    db: {
      userSettings: { findUnique: vi.fn() },
      workout: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/garmin/client", () => ({
  getGarminClient: vi.fn(),
  // Sprint 2.8: a partial factory returns undefined for anything it omits, which
  // only fails at call time. sync.ts now calls clearGarminSession, so keep the
  // mock complete rather than waiting for the import graph to reach it.
  clearGarminSession: vi.fn(),
}));

vi.mock("@/lib/db/queries/settings", () => ({
  getEffectiveVdot: vi.fn(async () => 42),
}));

import { db } from "@/lib/db/client";
import {
  resyncFutureWorkoutsToGarmin,
  type ResyncDeps,
} from "@/lib/garmin/workout-sync";

const TODAY = new Date("2026-04-28T00:00:00Z");

interface FakeWorkout {
  id: string;
  date: Date;
  type: string;
  garminWorkoutId: string | null;
  garminScheduledWorkoutId: string | null;
  plannedSession: {
    type: string;
    durationMin: number;
    hrTarget?: { from: number; to: number };
  };
}

function fw(
  id: string,
  type: string,
  hasGarmin: boolean,
  hasHr = true,
): FakeWorkout {
  return {
    id,
    date: new Date(TODAY.getTime() + 86400000),
    type,
    garminWorkoutId: hasGarmin ? `garmin-${id}` : null,
    garminScheduledWorkoutId: hasGarmin ? `sched-${id}` : null,
    plannedSession: {
      type,
      durationMin: 30,
      ...(hasHr ? { hrTarget: { from: 144, to: 167 } } : {}),
    },
  };
}

function makeDeps(
  pushImpl?: ResyncDeps["push"],
  removeImpl?: ResyncDeps["remove"],
): { deps: ResyncDeps; pushFn: ReturnType<typeof vi.fn>; removeFn: ReturnType<typeof vi.fn> } {
  const pushFn = vi.fn(
    pushImpl ??
      (async () => ({ pushed: true, garminWorkoutId: "fake" })),
  );
  const removeFn = vi.fn(removeImpl ?? (async () => ({ removed: true })));
  return {
    deps: {
      push: pushFn as unknown as ResyncDeps["push"],
      remove: removeFn as unknown as ResyncDeps["remove"],
    },
    pushFn,
    removeFn,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.workout.findMany as any).mockImplementation(async () => []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.userSettings.findUnique as any).mockImplementation(async () => ({
    garminWorkoutPushEnabled: true,
    vdotOverride: 42,
  }));
});

describe("resyncFutureWorkoutsToGarmin", () => {
  it("returns empty result when garminWorkoutPushEnabled is false", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.userSettings.findUnique as any).mockImplementation(async () => ({
      garminWorkoutPushEnabled: false,
    }));
    const { deps, pushFn, removeFn } = makeDeps();

    const r = await resyncFutureWorkoutsToGarmin("u1", TODAY, deps);
    expect(r).toEqual({
      considered: 0,
      removed: 0,
      repushed: 0,
      errors: [],
    });
    expect(pushFn).not.toHaveBeenCalled();
    expect(removeFn).not.toHaveBeenCalled();
  });

  it("pushes 5 run-style future workouts (3 had a prior garminWorkoutId)", async () => {
    const futures: FakeWorkout[] = [
      fw("w1", "easy_run", true),
      fw("w2", "threshold_run", true),
      fw("w3", "easy_run", true),
      fw("w4", "long_run", false),
      fw("w5", "easy_run", false),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.workout.findMany as any).mockImplementation(async () => futures);
    const { deps, pushFn, removeFn } = makeDeps();

    const r = await resyncFutureWorkoutsToGarmin("u1", TODAY, deps);
    expect(r.considered).toBe(5);
    expect(r.repushed).toBe(5);
    // 3 of the 5 displaced an old push and count as removed.
    expect(r.removed).toBe(3);
    expect(pushFn).toHaveBeenCalledTimes(5);
    expect(removeFn).not.toHaveBeenCalled();
  });

  it("rest day with prior garminWorkoutId: removes only, no push", async () => {
    const futures: FakeWorkout[] = [fw("rest1", "rest", true, false)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.workout.findMany as any).mockImplementation(async () => futures);
    const { deps, pushFn, removeFn } = makeDeps();

    const r = await resyncFutureWorkoutsToGarmin("u1", TODAY, deps);
    expect(r.removed).toBe(1);
    expect(r.repushed).toBe(0);
    expect(pushFn).not.toHaveBeenCalled();
    expect(removeFn).toHaveBeenCalledTimes(1);
  });

  it("captures per-workout failure into result.errors and continues", async () => {
    const futures: FakeWorkout[] = [
      fw("ok1", "easy_run", false),
      fw("fail1", "easy_run", false),
      fw("ok2", "easy_run", false),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.workout.findMany as any).mockImplementation(async () => futures);

    const { deps, pushFn } = makeDeps(async (id) => {
      if (id === "fail1") {
        return { pushed: false, error: "Garmin auth broken" };
      }
      return { pushed: true, garminWorkoutId: `g-${id}` };
    });

    const r = await resyncFutureWorkoutsToGarmin("u1", TODAY, deps);
    expect(r.considered).toBe(3);
    expect(r.repushed).toBe(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("fail1");
    expect(r.errors[0]).toContain("Garmin auth broken");
    expect(pushFn).toHaveBeenCalledTimes(3);
  });
});
