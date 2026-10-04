// Garmin candidates for /confirm — Sprint 3.2a. Pure matcher.
import { describe, expect, it } from "vitest";

import type { ActivitySummary } from "@/lib/garmin/activities";
import {
  disciplineOf,
  matchConfirmCandidates,
  MAX_CANDIDATES,
} from "@/lib/garmin/confirm-candidates";

function act(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    activityId: 1,
    activityName: "Berlin Running",
    startTimeLocal: "2026-09-01 07:12:00",
    startTimeGMT: "2026-09-01 05:12:00",
    category: "run",
    durationSec: 780,
    distanceM: 2300,
    averageHr: 150,
    maxHr: 165,
    averagePaceSecPerKm: 339,
    elevationGainM: 4,
    calories: 160,
    workoutId: null,
    ...over,
  };
}

// The real week of 30.08.–01.09. as Garmin recorded it.
const WEEK: ActivitySummary[] = [
  act({ activityId: 10, startTimeLocal: "2026-08-28 19:57:00", durationSec: 840, workoutId: 1678569838 }),
  act({ activityId: 11, startTimeLocal: "2026-08-28 18:00:00", category: "strength", activityName: "Strength", durationSec: 6600 }),
  act({ activityId: 20, startTimeLocal: "2026-08-30 17:40:00", durationSec: 1020 }),
  act({ activityId: 21, startTimeLocal: "2026-08-30 18:10:00", category: "strength", activityName: "Strength", durationSec: 2880 }),
  act({ activityId: 30, startTimeLocal: "2026-09-01 07:12:00", durationSec: 780 }),
  act({ activityId: 31, startTimeLocal: "2026-09-01 18:30:00", category: "strength", activityName: "Strength", durationSec: 3840 }),
];

describe("matchConfirmCandidates", () => {
  it("offers Tuesday's ad-hoc run for Monday's planned run (±1 day)", () => {
    const out = matchConfirmCandidates(
      [{ id: "mon-run", date: "2026-08-31", discipline: "run", plannedDurationMin: 30 }],
      WEEK,
      new Set(),
    );
    // Sunday 17 min and Tuesday 13 min are both one day away; 17 is closer to 30.
    expect(out["mon-run"].map((c) => c.activityId)).toEqual([20, 30]);
    expect(out["mon-run"][1]).toMatchObject({ date: "2026-09-01", dayOffset: 1, durationMin: 13 });
  });

  it("prefers the same day over a closer duration on a neighbouring day", () => {
    const out = matchConfirmCandidates(
      [{ id: "tue-run", date: "2026-09-01", discipline: "run", plannedDurationMin: 17 }],
      WEEK,
      new Set(),
    );
    expect(out["tue-run"][0].activityId).toBe(30);
  });

  it("matches strength to strength only", () => {
    const out = matchConfirmCandidates(
      [{ id: "mon-str", date: "2026-08-31", discipline: "strength", plannedDurationMin: 59 }],
      WEEK,
      new Set(),
    );
    expect(out["mon-str"].every((c) => [21, 31].includes(c.activityId))).toBe(true);
  });

  it("never offers an activity that is already linked", () => {
    const out = matchConfirmCandidates(
      [{ id: "fri-run", date: "2026-08-28", discipline: "run", plannedDurationMin: 34 }],
      WEEK,
      new Set(["10"]),
    );
    expect(out["fri-run"]).toBeUndefined();
  });

  it("ignores anything more than a day away", () => {
    const out = matchConfirmCandidates(
      [{ id: "wed-run", date: "2026-09-03", discipline: "run", plannedDurationMin: 30 }],
      WEEK,
      new Set(),
    );
    expect(out["wed-run"]).toBeUndefined();
  });

  it(`returns at most ${MAX_CANDIDATES} per session`, () => {
    const many = [1, 2, 3, 4].map((i) =>
      act({ activityId: 100 + i, startTimeLocal: `2026-09-01 0${i}:00:00` }),
    );
    const out = matchConfirmCandidates(
      [{ id: "s", date: "2026-09-01", discipline: "run", plannedDurationMin: 13 }],
      many,
      new Set(),
    );
    expect(out.s).toHaveLength(MAX_CANDIDATES);
  });

  it("skips sessions that are neither run nor strength", () => {
    const out = matchConfirmCandidates(
      [{ id: "x", date: "2026-09-01", discipline: "other", plannedDurationMin: null }],
      WEEK,
      new Set(),
    );
    expect(out).toEqual({});
  });
});

describe("disciplineOf", () => {
  it("maps session types", () => {
    expect(disciplineOf("easy_run")).toBe("run");
    expect(disciplineOf("vo2max_intervals")).toBe("run");
    expect(disciplineOf("strength_b")).toBe("strength");
    expect(disciplineOf("mobility")).toBe("other");
  });
});
