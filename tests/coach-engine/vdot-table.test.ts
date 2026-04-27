import { describe, it, expect } from "vitest";
import {
  riegelEquivalent,
  vdotFrom5k,
  vdotFromTPace,
  VDOT_TO_5K_SEC,
  VDOT_TO_T_PACE_SEC,
} from "@/lib/coach-engine/vdot-table";

describe("vdotFrom5k", () => {
  it("Q baseline: 24:30 5k ≈ VDOT ~38", () => {
    const v = vdotFrom5k(24 * 60 + 30);
    expect(v).toBeGreaterThanOrEqual(37.5);
    expect(v).toBeLessThanOrEqual(38.5);
  });

  it("Q goal: 22:00 5k ≈ VDOT 43-44", () => {
    const v = vdotFrom5k(22 * 60);
    expect(v).toBeGreaterThanOrEqual(43);
    expect(v).toBeLessThanOrEqual(44);
  });

  it("exact table entry: VDOT 40 → 23:38 → 40.0", () => {
    expect(vdotFrom5k(VDOT_TO_5K_SEC[40])).toBe(40);
  });

  it("clamps below: 60:00 5k → lowest VDOT in table", () => {
    expect(vdotFrom5k(60 * 60)).toBe(30);
  });

  it("clamps above: 14:00 5k → highest VDOT in table", () => {
    expect(vdotFrom5k(14 * 60)).toBe(60);
  });

  it("monotonically increases as 5k time decreases", () => {
    let prev = -Infinity;
    for (let t = 30 * 60; t >= 16 * 60; t -= 30) {
      const v = vdotFrom5k(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("vdotFromTPace", () => {
  it("T-pace 5:00/km → VDOT 40 (exact match)", () => {
    expect(vdotFromTPace(5 * 60)).toBe(40);
  });

  it("exact table entry: VDOT 42 T-pace → 42.0", () => {
    expect(vdotFromTPace(VDOT_TO_T_PACE_SEC[42])).toBe(42);
  });

  it("Q's likely Block-1 threshold split (5:15/km) → VDOT ~37-38", () => {
    const v = vdotFromTPace(5 * 60 + 15);
    expect(v).toBeGreaterThanOrEqual(37);
    expect(v).toBeLessThanOrEqual(38);
  });

  it("faster T-pace 4:30/km → VDOT ~44-45", () => {
    const v = vdotFromTPace(4 * 60 + 30);
    expect(v).toBeGreaterThanOrEqual(44);
    expect(v).toBeLessThanOrEqual(45);
  });
});

describe("riegelEquivalent", () => {
  it("5k 22:00 → 10k ≈ 45:43 (Riegel exponent 1.06)", () => {
    const t10k = riegelEquivalent(5000, 22 * 60, 10000);
    // 22*60 * 2^1.06 ≈ 1320 * 2.0851 ≈ 2752 sec ≈ 45:52
    expect(t10k).toBeGreaterThan(44 * 60);
    expect(t10k).toBeLessThan(47 * 60);
  });

  it("5k 22:00 → 3k ≈ 12:51", () => {
    const t3k = riegelEquivalent(5000, 22 * 60, 3000);
    // 1320 * (0.6)^1.06 ≈ 1320 * 0.5828 ≈ 770 sec ≈ 12:50
    expect(t3k).toBeGreaterThan(12 * 60);
    expect(t3k).toBeLessThan(13 * 60 + 30);
  });

  it("identity: same distance returns same time", () => {
    expect(riegelEquivalent(5000, 1320, 5000)).toBeCloseTo(1320, 0);
  });

  it("rejects non-positive inputs", () => {
    expect(() => riegelEquivalent(0, 100, 5000)).toThrow();
    expect(() => riegelEquivalent(5000, 0, 5000)).toThrow();
    expect(() => riegelEquivalent(5000, 100, 0)).toThrow();
  });
});
