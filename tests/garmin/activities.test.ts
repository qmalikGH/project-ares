// Sprint v1.5 follow-up: getActivityDetail must unwrap Garmin's `summaryDTO`
// envelope (singular-activity endpoint returns metrics nested, list endpoint
// returns them flat). Pre-fix, distance/duration/HR were `null` on the
// persisted executedSession because toSummary read top-level a.distance
// (= undefined when nested).
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock client.getActivity / getGarminClient before importing activities.
const getActivityMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/garmin/client", () => ({
  getGarminClient: async () => ({ getActivity: getActivityMock }),
}));

import { getActivityDetail } from "@/lib/garmin/activities";

describe("getActivityDetail — Garmin response normalisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads metrics from summaryDTO when getActivity returns nested shape (single-activity endpoint)", async () => {
    getActivityMock.mockResolvedValue({
      activityId: 23002346432,
      activityName: "Berlin - Easy Run 35min",
      activityTypeDTO: { typeKey: "running" },
      summaryDTO: {
        startTimeLocal: "2026-05-25 07:25:54",
        startTimeGMT: "2026-05-25 05:25:54",
        distance: 5628.65,
        duration: 2012.92,
        averageHR: 149,
        maxHR: 169,
        elevationGain: 12,
        calories: 420,
      },
      splitSummaries: [
        { distance: 881.62, duration: 300, averageHR: 126, maxHR: 138 },
        { distance: 5628.65, duration: 2013, averageHR: 149, maxHR: 169 },
      ],
    });

    const detail = await getActivityDetail(23002346432);
    expect(detail.distanceM).toBe(5628.65);
    expect(detail.durationSec).toBe(2013);
    expect(detail.averageHr).toBe(149);
    expect(detail.maxHr).toBe(169);
    expect(detail.averagePaceSecPerKm).toBe(Math.round(2013 / (5628.65 / 1000)));
    expect(detail.category).toBe("run");
    expect(detail.splits).toHaveLength(2);
  });

  it("still works with the flat (list-endpoint) shape — top-level fields win", async () => {
    getActivityMock.mockResolvedValue({
      activityId: 999,
      activityName: "Flat Shape Run",
      activityType: { typeKey: "running" },
      startTimeLocal: "2026-05-25 07:25:54",
      startTimeGMT: "2026-05-25 05:25:54",
      distance: 5000,
      duration: 1800,
      averageHR: 140,
      maxHR: 160,
      splitSummaries: [],
    });

    const detail = await getActivityDetail(999);
    expect(detail.distanceM).toBe(5000);
    expect(detail.durationSec).toBe(1800);
    expect(detail.averageHr).toBe(140);
    expect(detail.maxHr).toBe(160);
  });

  it("top-level overrides summaryDTO if both are present", async () => {
    getActivityMock.mockResolvedValue({
      activityId: 1,
      activityType: { typeKey: "running" },
      distance: 7000,
      duration: 2100,
      averageHR: 150,
      maxHR: 170,
      summaryDTO: {
        distance: 99999, // ignored — top-level wins
        duration: 99999,
        averageHR: 99,
        maxHR: 99,
      },
    });

    const detail = await getActivityDetail(1);
    expect(detail.distanceM).toBe(7000);
    expect(detail.durationSec).toBe(2100);
    expect(detail.averageHr).toBe(150);
    expect(detail.maxHr).toBe(170);
  });

  it("returns null for missing distance (indoor / no GPS)", async () => {
    getActivityMock.mockResolvedValue({
      activityId: 2,
      activityType: { typeKey: "indoor_cardio" },
      summaryDTO: {
        duration: 1800,
        averageHR: 130,
        // no distance
      },
    });

    const detail = await getActivityDetail(2);
    expect(detail.distanceM).toBeNull();
    expect(detail.durationSec).toBe(1800);
    expect(detail.averagePaceSecPerKm).toBeNull();
    expect(detail.category).toBe("strength");
  });
});
