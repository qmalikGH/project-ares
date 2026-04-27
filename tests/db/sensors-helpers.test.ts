import { describe, it, expect } from "vitest";
import {
  avg,
  stddev,
  classifyDeviation,
  round,
  minutesSince,
} from "@/lib/db/queries/sensors-helpers";

describe("avg", () => {
  it("computes mean", () => expect(avg([1, 2, 3])).toBe(2));
  it("returns 0 for empty array", () => expect(avg([])).toBe(0));
  it("handles single value", () => expect(avg([7])).toBe(7));
});

describe("stddev", () => {
  it("computes population stddev", () => {
    expect(stddev([1, 2, 3])).toBeCloseTo(0.816, 2);
  });
  it("returns 0 for fewer than 2 values", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });
  it("returns 0 for identical values", () => {
    expect(stddev([5, 5, 5, 5])).toBe(0);
  });
});

describe("classifyDeviation", () => {
  it("at baseline returns →", () => {
    expect(classifyDeviation(50, 50, 5)).toBe("→");
  });
  it("+1 SD returns ↑", () => {
    expect(classifyDeviation(55, 50, 5)).toBe("↑");
  });
  it("+2 SD returns ↑↑", () => {
    expect(classifyDeviation(60, 50, 5)).toBe("↑↑");
  });
  it("-1 SD returns ↓", () => {
    expect(classifyDeviation(45, 50, 5)).toBe("↓");
  });
  it("-2 SD returns ↓↓", () => {
    expect(classifyDeviation(40, 50, 5)).toBe("↓↓");
  });
  it("inverted +2 SD returns ↓↓ (RHR worse)", () => {
    expect(classifyDeviation(60, 50, 5, true)).toBe("↓↓");
  });
  it("zero SD returns →", () => {
    expect(classifyDeviation(60, 50, 0)).toBe("→");
  });
  it("HRV 86 vs baseline 78 SD 5 → ↑ (z=1.6, between 0.5 and 2)", () => {
    expect(classifyDeviation(86, 78, 5)).toBe("↑");
  });
});

describe("round", () => {
  it("rounds to 1 decimal by default", () => {
    expect(round(1.234)).toBe(1.2);
    expect(round(1.25)).toBe(1.3);
  });
  it("rounds to 2 decimals when specified", () => {
    expect(round(1.2345, 2)).toBe(1.23);
  });
  it("rounds whole numbers", () => {
    expect(round(5, 0)).toBe(5);
  });
});

describe("minutesSince", () => {
  it("returns null for null input", () => {
    expect(minutesSince(null, new Date())).toBeNull();
  });
  it("returns minutes elapsed", () => {
    const ref = new Date("2026-04-27T12:00:00Z");
    const ts = new Date("2026-04-27T11:30:00Z");
    expect(minutesSince(ts, ref)).toBe(30);
  });
  it("returns 0 for future timestamps (not negative)", () => {
    const ref = new Date("2026-04-27T12:00:00Z");
    const future = new Date("2026-04-27T13:00:00Z");
    expect(minutesSince(future, ref)).toBe(0);
  });
});
