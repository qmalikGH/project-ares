import { describe, it, expect } from "vitest";
import {
  computeInitialVdotFromGoal,
  computePhaseVdotTargets,
  parseTimeToSec,
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

describe("parseTimeToSec", () => {
  it("parses mm:ss", () => {
    expect(parseTimeToSec("24:30")).toBe(24 * 60 + 30);
    expect(parseTimeToSec("5:00")).toBe(300);
  });

  it("parses hh:mm:ss for marathon-length goals", () => {
    expect(parseTimeToSec("3:30:00")).toBe(3 * 3600 + 30 * 60);
    expect(parseTimeToSec("1:24:30")).toBe(3600 + 24 * 60 + 30);
  });

  it("throws on invalid format", () => {
    expect(() => parseTimeToSec("invalid")).toThrow();
    expect(() => parseTimeToSec("24:xx")).toThrow();
    expect(() => parseTimeToSec("")).toThrow();
  });
});

describe("computeInitialVdotFromGoal", () => {
  it("Q baseline: 5k 24:30 → VDOT ~38 (architecturally, Daniels Initial-VDOT)", () => {
    const v = computeInitialVdotFromGoal("5k_time", "24:30");
    expect(v).toBeGreaterThanOrEqual(37.5);
    expect(v).toBeLessThanOrEqual(39);
  });

  it("Q goal: 5k 22:00 maps inside the table band (consistent with vdotFrom5k)", () => {
    const v = computeInitialVdotFromGoal("5k_time", "22:00");
    // Same band as vdotFrom5k(22:00) — table-driven.
    expect(v).toBe(vdotFrom5k(22 * 60));
    expect(v).toBeGreaterThanOrEqual(43);
    expect(v).toBeLessThanOrEqual(44);
  });

  it("10k 51:00 (≈ Q's 5k 24:30 Riegel-equivalent) yields similar VDOT", () => {
    const v5k = computeInitialVdotFromGoal("5k_time", "24:30");
    const v10k = computeInitialVdotFromGoal("10k_time", "51:00");
    expect(Math.abs(v10k - v5k)).toBeLessThan(2.5);
  });

  it("21k_time legacy goal type accepts half-marathon time", () => {
    // 21097m in 1:50:00 ≈ moderate runner (not Q's level).
    const v = computeInitialVdotFromGoal("21k_time", "1:50:00");
    expect(v).toBeGreaterThan(35);
    expect(v).toBeLessThan(50);
  });

  it("unknown goal type falls back to 5k interpretation", () => {
    const fallback = computeInitialVdotFromGoal("nonsense_type", "24:30");
    const direct = computeInitialVdotFromGoal("5k_time", "24:30");
    expect(fallback).toBe(direct);
  });

  it("throws on invalid time format", () => {
    expect(() => computeInitialVdotFromGoal("5k_time", "invalid")).toThrow();
  });
});

describe("computePhaseVdotTargets", () => {
  it("interpolates 5 blocks linearly between initial and goal", () => {
    const targets = computePhaseVdotTargets(38, 43, 5);
    expect(targets).toHaveLength(5);
    expect(targets[0]).toBe(39); // 38 + 1.0
    expect(targets[4]).toBe(43); // goal
    // Monotonically increasing
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]);
    }
  });

  it("handles initial == goal (no progression)", () => {
    const targets = computePhaseVdotTargets(40, 40, 5);
    expect(targets).toEqual([40, 40, 40, 40, 40]);
  });

  it("returns [] for blockCount < 1", () => {
    expect(computePhaseVdotTargets(38, 43, 0)).toEqual([]);
  });
});
