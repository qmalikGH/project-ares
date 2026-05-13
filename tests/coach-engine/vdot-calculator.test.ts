import { describe, it, expect } from "vitest";
import {
  calibrateVdotFromRuns,
  vdotFrom5kSec,
} from "@/lib/coach-engine/vdot-calculator";
import type { RunSummary } from "@/lib/garmin/profile";

// ============================================
// Q's actual run history (Garmin-driven, garmin-diagnostic-output/27-runs-summary.json)
// 19 runs across 90 days, HRmax=205, HRrest=53.
// ============================================
const Q_HR_MAX = 205;
const Q_HR_REST = 53;

function r(
  date: string,
  distanceM: number,
  durationSec: number,
  avgHr: number,
  maxHr: number,
): RunSummary {
  return {
    activityId: 0,
    date,
    distanceM,
    durationSec,
    avgHr,
    maxHr,
    avgPaceSecPerKm: Math.round(durationSec / (distanceM / 1000)),
    velocityMperMin: (distanceM / durationSec) * 60,
  };
}

// Subset of Q's 19 real runs — enough to exercise all 3 methods.
const Q_RUNS: RunSummary[] = [
  r("2026-02-14", 4553.64, 1613, 163, 185),
  r("2026-02-21", 4516.27, 1563, 159, 185),
  r("2026-02-26", 4207.0, 1409, 163, 185),
  r("2026-02-28", 4898.18, 1707, 162, 179),
  r("2026-03-07", 3841.45, 1303, 164, 186),
  r("2026-03-12", 2630.03, 1336, 148, 183),
  r("2026-03-24", 2326.56, 801, 146, 164),
  r("2026-03-27", 2327.74, 709, 156, 175),
  r("2026-04-02", 2044.53, 662, 165, 184),
  r("2026-04-04", 2334.39, 706, 160, 181),
  r("2026-04-18", 2170.31, 750, 169, 186),
  r("2026-04-20", 4478.16, 1482, 168, 194),
  r("2026-04-24", 2190.26, 722, 164, 184),
  r("2026-04-26", 5436.54, 1893, 164, 178),
];

describe("vdotFrom5kSec (Daniels' formula)", () => {
  it("Q baseline: 24:30 5k → VDOT ~38-39", () => {
    const v = vdotFrom5kSec(24 * 60 + 30);
    expect(v).toBeGreaterThanOrEqual(38);
    expect(v).toBeLessThanOrEqual(40);
  });

  it("VDOT 22:00 5k → ~43-46 band", () => {
    const v = vdotFrom5kSec(22 * 60);
    expect(v).toBeGreaterThanOrEqual(42);
    expect(v).toBeLessThanOrEqual(46);
  });

  it("monotonically increases as 5k time decreases", () => {
    let prev = -Infinity;
    for (let t = 30 * 60; t >= 16 * 60; t -= 30) {
      const v = vdotFrom5kSec(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("calibrateVdotFromRuns — insufficient data", () => {
  it("returns insufficient_data=true with zero runs", () => {
    const res = calibrateVdotFromRuns([], Q_HR_MAX, Q_HR_REST);
    expect(res.insufficient_data).toBe(true);
    expect(res.estimates).toHaveLength(0);
    expect(res.finalVdot).toBe(0);
  });

  it("returns insufficient_data=true with one run", () => {
    const res = calibrateVdotFromRuns(
      [Q_RUNS[0]],
      Q_HR_MAX,
      Q_HR_REST,
    );
    expect(res.insufficient_data).toBe(true);
  });
});

describe("calibrateVdotFromRuns — Q's real 90-day window", () => {
  const result = calibrateVdotFromRuns(Q_RUNS, Q_HR_MAX, Q_HR_REST);

  it("produces HRC and linear_regression (Daniels excluded at sub-max)", () => {
    const methods = result.estimates.map((e) => e.method).sort();
    expect(methods).toEqual(["hrc", "linear_regression"]);
  });

  it("HRC method matches diagnostic-script output (VDOT 42-43, n=14 high-HR runs)", () => {
    const hrc = result.estimates.find((e) => e.method === "hrc");
    expect(hrc).toBeDefined();
    // Diagnostic ran the full 19 runs; this 14-run subset should be close.
    expect(hrc!.vdot).toBeGreaterThanOrEqual(40);
    expect(hrc!.vdot).toBeLessThanOrEqual(46);
    expect(hrc!.confidence).toBe("high");
  });

  it("Linear-regression method produces a sensible VDOT in 35-60 band", () => {
    // Sub-sampled subset produces wider variance than the full 19-run script
    // result. We just assert the method runs and stays in physiological range.
    const lr = result.estimates.find((e) => e.method === "linear_regression");
    expect(lr).toBeDefined();
    expect(lr!.vdot).toBeGreaterThanOrEqual(35);
    expect(lr!.vdot).toBeLessThanOrEqual(60);
  });

  it("Daniels-Riegel excluded when hardest run is sub-max (<88% HRmax)", () => {
    const dr = result.estimates.find((e) => e.method === "daniels_riegel");
    expect(dr).toBeUndefined();
  });

  it("Daniels-Riegel included when hardest run reaches 88%+ HRmax", () => {
    const highEffortRuns: RunSummary[] = [
      r("2026-04-01", 5000, 1500, 185, 200), // 185/205 = 90.2%
      r("2026-04-03", 4000, 1200, 170, 190),
      r("2026-04-05", 3000, 900, 160, 180),
    ];
    const res = calibrateVdotFromRuns(highEffortRuns, Q_HR_MAX, Q_HR_REST);
    const dr = res.estimates.find((e) => e.method === "daniels_riegel");
    expect(dr).toBeDefined();
    expect(dr!.confidence).not.toBe("low");
  });

  it("final VDOT is calibrated (not zero, in physiological range)", () => {
    expect(result.finalVdot).toBeGreaterThanOrEqual(30);
    expect(result.finalVdot).toBeLessThanOrEqual(55);
    expect(result.insufficient_data).toBe(false);
  });

  it("range.min and range.max bracket all method outputs", () => {
    const all = result.estimates.map((e) => e.vdot);
    expect(result.range.min).toBe(Math.min(...all));
    expect(result.range.max).toBe(Math.max(...all));
  });
});

describe("calibrateVdotFromRuns — confidence reporting", () => {
  it("confidence label reflects estimate spread (low|medium|high)", () => {
    const res = calibrateVdotFromRuns(Q_RUNS, Q_HR_MAX, Q_HR_REST);
    expect(["low", "medium", "high"]).toContain(res.confidence);
    if (res.range.max - res.range.min <= 2) {
      expect(res.confidence).toBe("high");
    } else if (res.range.max - res.range.min <= 4) {
      expect(res.confidence).toBe("medium");
    } else {
      expect(res.confidence).toBe("low");
    }
  });

  it("is pure — does not mutate input array", () => {
    const before = JSON.stringify(Q_RUNS);
    calibrateVdotFromRuns(Q_RUNS, Q_HR_MAX, Q_HR_REST);
    expect(JSON.stringify(Q_RUNS)).toBe(before);
  });
});
