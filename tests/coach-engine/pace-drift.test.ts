import { describe, it, expect } from "vitest";
import {
  detectPaceDrift,
  type DriftEasyRunSample,
} from "@/lib/coach-engine/pace-drift";

function sample(
  overrides: Partial<DriftEasyRunSample> = {},
): DriftEasyRunSample {
  return {
    plannedPaceSecPerKm: 350,
    actualPaceSecPerKm: 350,
    plannedRpe: 4,
    actualRpe: 4,
    plannedZone: 1,
    actualHrAvg: 155,
    plannedZoneHrMax: 163,
    ...overrides,
  };
}

describe("detectPaceDrift", () => {
  it("returns no_drift with insufficient data (< 3 runs)", () => {
    const r0 = detectPaceDrift({ recentEasyRuns: [] });
    expect(r0.hasDrift).toBe(false);
    expect(r0.affectedSessions).toBe(0);
    expect(r0.suggestedVdotDelta).toBe(0);
    expect(r0.recommendation).toMatch(/Nicht genug Daten/);

    const r2 = detectPaceDrift({
      recentEasyRuns: [sample(), sample()],
    });
    expect(r2.hasDrift).toBe(false);
  });

  it("detects vdot_too_high when 3+ Easy runs have RPE >= cap+2", () => {
    const result = detectPaceDrift({
      recentEasyRuns: [
        sample({ actualPaceSecPerKm: 360, actualRpe: 7 }),
        sample({ actualPaceSecPerKm: 365, actualRpe: 6 }),
        sample({ actualPaceSecPerKm: 360, actualRpe: 6 }),
      ],
    });
    expect(result.hasDrift).toBe(true);
    expect(result.driftType).toBe("vdot_too_high");
    expect(result.suggestedVdotDelta).toBeLessThan(0);
    expect(result.suggestedVdotDelta).toBeGreaterThanOrEqual(-2);
    expect(result.recommendation).toMatch(/reduzieren/);
  });

  it("detects vdot_too_high purely from pace deviation > 7%", () => {
    const result = detectPaceDrift({
      recentEasyRuns: [
        // RPE normal, pace meaningfully slower
        sample({ actualPaceSecPerKm: 380, actualRpe: 4 }), // ~8.6% slower
        sample({ actualPaceSecPerKm: 380, actualRpe: 5 }),
        sample({ actualPaceSecPerKm: 378, actualRpe: 5 }),
      ],
    });
    expect(result.hasDrift).toBe(true);
    expect(result.driftType).toBe("vdot_too_high");
  });

  it("detects vdot_too_low when 3+ Easy runs are faster with low RPE", () => {
    const result = detectPaceDrift({
      recentEasyRuns: [
        sample({ actualPaceSecPerKm: 320, actualRpe: 3 }), // 8.6% faster
        sample({ actualPaceSecPerKm: 322, actualRpe: 3 }),
        sample({ actualPaceSecPerKm: 318, actualRpe: 3 }),
      ],
    });
    expect(result.hasDrift).toBe(true);
    expect(result.driftType).toBe("vdot_too_low");
    expect(result.suggestedVdotDelta).toBe(1);
    expect(result.recommendation).toMatch(/erhöhen/);
  });

  it("returns no_drift when data is normal", () => {
    const result = detectPaceDrift({
      recentEasyRuns: [
        sample({ actualPaceSecPerKm: 350, actualRpe: 4 }),
        sample({ actualPaceSecPerKm: 348, actualRpe: 4 }),
        sample({ actualPaceSecPerKm: 352, actualRpe: 5 }),
      ],
    });
    expect(result.hasDrift).toBe(false);
    expect(result.driftType).toBe("no_drift");
    expect(result.suggestedVdotDelta).toBe(0);
  });

  it("recommendation is transparent: includes raw RPE and pace deltas", () => {
    const result = detectPaceDrift({
      recentEasyRuns: [
        sample({ actualPaceSecPerKm: 380, actualRpe: 7 }),
        sample({ actualPaceSecPerKm: 378, actualRpe: 6 }),
        sample({ actualPaceSecPerKm: 382, actualRpe: 6 }),
      ],
    });
    // Brief: "False-Positives" — surface raw numbers so user can dismiss.
    expect(result.recommendation).toMatch(/RPE/);
    expect(result.recommendation).toMatch(/Pace/);
    expect(result.recommendation).toMatch(/%/);
  });

  it("delta is bounded to ±2", () => {
    // Wildly off training: RPE 9 vs plan 4, pace 30% slower
    const result = detectPaceDrift({
      recentEasyRuns: Array.from({ length: 4 }, () =>
        sample({ actualPaceSecPerKm: 455, actualRpe: 9 }),
      ),
    });
    expect(result.suggestedVdotDelta).toBeGreaterThanOrEqual(-2);
    expect(result.suggestedVdotDelta).toBeLessThan(0);
  });
});
