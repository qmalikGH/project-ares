import { describe, it, expect } from "vitest";
import { matchSessionToActivity, sessionTypeToCategory } from "@/lib/garmin/match";
import type { ActivitySummary } from "@/lib/garmin/activities";

const mockRun = (id: number, time: string, workoutId: number | null = null): ActivitySummary => ({
  workoutId,
  activityId: id,
  activityName: `Run ${id}`,
  startTimeLocal: time,
  startTimeGMT: time,
  category: "run",
  durationSec: 2100,
  distanceM: 6200,
  averageHr: 142,
  maxHr: 165,
  averagePaceSecPerKm: 339,
  elevationGainM: 25,
  calories: 380,
});

const mockStrength = (id: number, time: string): ActivitySummary => ({
  ...mockRun(id, time),
  category: "strength",
  distanceM: null,
  averagePaceSecPerKm: null,
});

describe("sessionTypeToCategory", () => {
  it("maps run types correctly", () => {
    expect(sessionTypeToCategory("easy_run")).toBe("run");
    expect(sessionTypeToCategory("threshold_run")).toBe("run");
    expect(sessionTypeToCategory("tempo_run")).toBe("run");
    expect(sessionTypeToCategory("long_run")).toBe("run");
    expect(sessionTypeToCategory("vo2max_intervals")).toBe("run");
    expect(sessionTypeToCategory("calibration_run")).toBe("run");
    expect(sessionTypeToCategory("time_trial_5k")).toBe("run");
  });

  it("maps strength types correctly", () => {
    expect(sessionTypeToCategory("strength_a")).toBe("strength");
    expect(sessionTypeToCategory("strength_b")).toBe("strength");
    expect(sessionTypeToCategory("strength_c")).toBe("strength");
  });

  it("returns null for non-trackable types", () => {
    expect(sessionTypeToCategory("rest")).toBeNull();
    expect(sessionTypeToCategory("active_recovery")).toBeNull();
    expect(sessionTypeToCategory("mobility")).toBeNull();
    expect(sessionTypeToCategory("cross_training")).toBeNull();
  });
});

describe("matchSessionToActivity", () => {
  it("AUTO_MATCH on single matching candidate", () => {
    const result = matchSessionToActivity("easy_run", [mockRun(1, "2026-04-27T07:00:00")]);
    expect(result.status).toBe("AUTO_MATCH");
    expect(result.bestMatch?.activityId).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("PICKER_NEEDED on multiple matches, sorted ASC by start time", () => {
    const result = matchSessionToActivity("easy_run", [
      mockRun(2, "2026-04-27T18:00:00"),
      mockRun(1, "2026-04-27T07:00:00"),
    ]);
    expect(result.status).toBe("PICKER_NEEDED");
    expect(result.candidates.map((c) => c.activityId)).toEqual([1, 2]);
    expect(result.bestMatch?.activityId).toBe(1);
  });

  it("NO_CANDIDATES when category mismatch (run session, only strength logged)", () => {
    const result = matchSessionToActivity("easy_run", [mockStrength(1, "2026-04-27T18:00:00")]);
    expect(result.status).toBe("NO_CANDIDATES");
    expect(result.bestMatch).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it("NO_CANDIDATES for rest session even if activities exist", () => {
    const result = matchSessionToActivity("rest", [mockRun(1, "2026-04-27T07:00:00")]);
    expect(result.status).toBe("NO_CANDIDATES");
  });

  it("NO_CANDIDATES on empty input", () => {
    const result = matchSessionToActivity("easy_run", []);
    expect(result.status).toBe("NO_CANDIDATES");
  });

  it("ignores 'other' category activities", () => {
    const otherActivity: ActivitySummary = {
      ...mockRun(1, "2026-04-27T07:00:00"),
      category: "other",
    };
    const result = matchSessionToActivity("easy_run", [otherActivity]);
    expect(result.status).toBe("NO_CANDIDATES");
  });

  it("strength_a matches strength activity", () => {
    const result = matchSessionToActivity("strength_a", [
      mockStrength(99, "2026-04-27T18:30:00"),
    ]);
    expect(result.status).toBe("AUTO_MATCH");
    expect(result.bestMatch?.activityId).toBe(99);
  });

  it("filters mixed candidates to only the relevant category", () => {
    const result = matchSessionToActivity("easy_run", [
      mockStrength(1, "2026-04-27T18:00:00"),
      mockRun(2, "2026-04-27T07:00:00"),
    ]);
    expect(result.status).toBe("AUTO_MATCH");
    expect(result.bestMatch?.activityId).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sprint 2.9 — identity matching by pushed workout id
// ═══════════════════════════════════════════════════════════════════════════

describe("matchSessionToActivity — EXACT_MATCH", () => {
  it("matches on the workout id we pushed", () => {
    const r = matchSessionToActivity("easy_run", [mockRun(1, "2026-08-28 19:57:00", 1678569838)], "1678569838");
    expect(r.status).toBe("EXACT_MATCH");
    expect(r.bestMatch?.activityId).toBe(1);
  });

  it("ignores an ad-hoc run on the same day", () => {
    // Real pattern: a planned run plus a spontaneous one. Date+category alone
    // would have returned PICKER_NEEDED here; the id resolves it outright.
    const r = matchSessionToActivity(
      "easy_run",
      [mockRun(1, "2026-08-28 18:00:00", null), mockRun(2, "2026-08-28 19:57:00", 1678569838)],
      "1678569838",
    );
    expect(r.status).toBe("EXACT_MATCH");
    expect(r.bestMatch?.activityId).toBe(2);
  });

  it("falls back to the old rules when no id was pushed", () => {
    const r = matchSessionToActivity("easy_run", [mockRun(1, "2026-08-28 19:57:00", null)], null);
    expect(r.status).toBe("AUTO_MATCH");
  });

  it("falls back when the pushed id matches nothing that day", () => {
    const r = matchSessionToActivity("easy_run", [mockRun(1, "2026-08-28 19:57:00", 999)], "1678569838");
    expect(r.status).toBe("AUTO_MATCH");
  });

  it("compares ids as strings — the DB stores text, Garmin sends a number", () => {
    const r = matchSessionToActivity("easy_run", [mockRun(1, "2026-08-28 19:57:00", 1678569838)], "1678569838");
    expect(r.status).toBe("EXACT_MATCH");
  });
});
