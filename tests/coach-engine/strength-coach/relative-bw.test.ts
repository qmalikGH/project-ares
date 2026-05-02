// Sprint v0.15: tests for loadRelativeToBW and formatRelativeBW
import { describe, it, expect } from "vitest";
import {
  loadRelativeToBW,
  formatRelativeBW,
} from "@/lib/coach-engine/strength-coach/one-rm";

describe("loadRelativeToBW", () => {
  it("returns correct ratio for 140 kg at 92 kg BW", () => {
    expect(loadRelativeToBW(140, 92)).toBeCloseTo(1.52, 2);
  });

  it("returns correct ratio for 200 kg at 92 kg BW", () => {
    expect(loadRelativeToBW(200, 92)).toBeCloseTo(2.17, 2);
  });

  it("returns correct ratio for 97.5 kg at 92 kg BW", () => {
    expect(loadRelativeToBW(97.5, 92)).toBeCloseTo(1.06, 2);
  });

  it("returns null when body weight is null", () => {
    expect(loadRelativeToBW(140, null)).toBeNull();
  });

  it("returns null when body weight is undefined", () => {
    expect(loadRelativeToBW(140, undefined)).toBeNull();
  });

  it("returns null when body weight is 0", () => {
    expect(loadRelativeToBW(140, 0)).toBeNull();
  });

  it("returns null when body weight is negative", () => {
    expect(loadRelativeToBW(140, -5)).toBeNull();
  });

  it("rounds to 2 decimal places", () => {
    // 100 / 92 = 1.08695... → 1.09
    const result = loadRelativeToBW(100, 92);
    expect(result).toBe(1.09);
  });

  it("handles light load at heavy BW", () => {
    // 20 / 120 = 0.1667 → 0.17
    expect(loadRelativeToBW(20, 120)).toBe(0.17);
  });
});

describe("formatRelativeBW", () => {
  it("formats 1.52 as '1.52×'", () => {
    expect(formatRelativeBW(1.52)).toBe("1.52×");
  });

  it("formats 2 as '2.00×'", () => {
    expect(formatRelativeBW(2)).toBe("2.00×");
  });

  it("formats 0.5 as '0.50×'", () => {
    expect(formatRelativeBW(0.5)).toBe("0.50×");
  });

  it("formats 2.056 as '2.06×' (rounds)", () => {
    expect(formatRelativeBW(2.056)).toBe("2.06×");
  });
});
