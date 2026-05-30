// Sprint v1.9 #4 — HRrest recalibration (pure median + filter).
import { describe, expect, it } from "vitest";
import {
  rollingRestingHr,
  HR_MIN_SAMPLES,
  RHR_PLAUSIBLE_MIN,
  RHR_PLAUSIBLE_MAX,
} from "@/lib/coach-engine/hr-calibration";

describe("rollingRestingHr", () => {
  it("returns the median of plausible samples", () => {
    // 7 samples → median is the 4th sorted value
    expect(rollingRestingHr([47, 48, 46, 47, 49, 45, 48])).toBe(47);
  });

  it("matches Q's reality (~47–48, not the stale 53)", () => {
    const garminRhr = [47, 46, 48, 47, 49, 45, 47, 48, 46, 47];
    const median = rollingRestingHr(garminRhr);
    expect(median).toBeGreaterThanOrEqual(46);
    expect(median).toBeLessThanOrEqual(48);
  });

  it("ignores nulls/undefined", () => {
    // 7 valid samples (47,48,46,47,49,45,47) after dropping null/undefined
    expect(rollingRestingHr([47, null, 48, undefined, 46, 47, 49, 45, 47])).toBe(47);
  });

  it("excludes implausible (non-wear / glitch) values", () => {
    // 8 plausible + 2 garbage; garbage must not shift the median
    const vals = [47, 48, 46, 47, 49, 45, 48, 47, 5, 180];
    expect(rollingRestingHr(vals)).toBe(47);
  });

  it("returns null below the minimum sample count", () => {
    const few = Array(HR_MIN_SAMPLES - 1).fill(47);
    expect(rollingRestingHr(few)).toBeNull();
  });

  it("returns a value at exactly the minimum sample count", () => {
    const exactly = Array(HR_MIN_SAMPLES).fill(47);
    expect(rollingRestingHr(exactly)).toBe(47);
  });

  it("averages the two middle values for an even count", () => {
    // 8 sorted: middles 47 & 48 → round((47+48)/2) = 48
    expect(rollingRestingHr([46, 46, 47, 47, 48, 48, 49, 49])).toBe(48);
  });

  it("plausible band is 30–90", () => {
    expect(RHR_PLAUSIBLE_MIN).toBe(30);
    expect(RHR_PLAUSIBLE_MAX).toBe(90);
  });
});
