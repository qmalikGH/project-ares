import { describe, it, expect } from "vitest";
import {
  applySupersetPairing,
  isHsrLift,
  STRENGTH_TEMPLATES_PUBLIC,
} from "@/lib/coach-engine/strength-coach";
import type { Exercise } from "@/lib/coach-engine/types";

const A_BASE = STRENGTH_TEMPLATES_PUBLIC.strength_a;
const B_BASE = STRENGTH_TEMPLATES_PUBLIC.strength_b;
const C_BASE = STRENGTH_TEMPLATES_PUBLIC.strength_c;

function find(arr: Exercise[], name: string): Exercise | undefined {
  return arr.find((ex) => ex.name === name);
}

describe("isHsrLift", () => {
  it("recognizes Hex Bar Deadlift and RDL variants", () => {
    expect(isHsrLift("Hex Bar Deadlift")).toBe(true);
    expect(isHsrLift("Romanian Deadlift")).toBe(true);
    expect(isHsrLift("RDL")).toBe(true);
  });
  it("does not flag accessories as HSR", () => {
    expect(isHsrLift("Bench Press")).toBe(false);
    expect(isHsrLift("Pallof Press")).toBe(false);
    expect(isHsrLift("Pull-ups")).toBe(false);
  });
});

describe("applySupersetPairing", () => {
  it("Block 1 strength_a: all exercises remain Straight Sets", () => {
    const result = applySupersetPairing(A_BASE, 1, "strength_a");
    for (const ex of result) {
      expect(ex.supersetGroup ?? null).toBe(null);
      expect(ex.supersetOrder ?? null).toBe(null);
    }
  });

  it("Block 5 strength_a: peaking phase keeps Straight Sets (Iversen 2024)", () => {
    const result = applySupersetPairing(A_BASE, 5, "strength_a");
    for (const ex of result) {
      expect(ex.supersetGroup ?? null).toBe(null);
    }
  });

  it("Block 3 strength_a: Bench Press + Pallof Press become A1 superset", () => {
    const result = applySupersetPairing(A_BASE, 3, "strength_a");
    const bench = find(result, "Bench Press");
    const pallof = find(result, "Pallof Press");

    expect(bench?.supersetGroup).toBe("A1");
    expect(bench?.supersetOrder).toBe(1);
    expect(bench?.restSec).toBe(0);
    expect(bench?.supersetRationale).toMatch(/Push.*Anti-rotation/);

    expect(pallof?.supersetGroup).toBe("A1");
    expect(pallof?.supersetOrder).toBe(2);
    expect(pallof?.restSec).toBe(90);
  });

  it("Block 3 strength_a: Reverse Lunge + Calf Raises NOT paired (no clean antagonist)", () => {
    const result = applySupersetPairing(A_BASE, 3, "strength_a");
    const lunge = find(result, "Reverse Lunge");
    const calf = find(result, "Calf Raises");
    expect(lunge?.supersetGroup ?? null).toBe(null);
    expect(calf?.supersetGroup ?? null).toBe(null);
  });

  it("Block 3 strength_a: HSR Hex Bar Deadlift NEVER paired (Kongsgaard 2009)", () => {
    const result = applySupersetPairing(A_BASE, 3, "strength_a");
    const hex = find(result, "Hex Bar Deadlift");
    expect(hex?.supersetGroup ?? null).toBe(null);
    expect(hex?.restSec).toBe(180); // unchanged: full HSR rest preserved
    expect(hex?.tempo).toBe("3-3-1");
  });

  it("Block 3 strength_b: RDL (HSR) NEVER paired", () => {
    const result = applySupersetPairing(B_BASE, 3, "strength_b");
    const rdl = find(result, "Romanian Deadlift");
    expect(rdl?.supersetGroup ?? null).toBe(null);
    expect(rdl?.restSec).toBe(180);
  });

  it("Block 3 strength_b: Pull-ups + Hip Thrust become B1 superset", () => {
    const result = applySupersetPairing(B_BASE, 3, "strength_b");
    const pullups = find(result, "Pull-ups");
    const hipthrust = find(result, "Hip Thrust");

    expect(pullups?.supersetGroup).toBe("B1");
    expect(pullups?.supersetOrder).toBe(1);
    expect(pullups?.restSec).toBe(0);

    expect(hipthrust?.supersetGroup).toBe("B1");
    expect(hipthrust?.supersetOrder).toBe(2);
    expect(hipthrust?.restSec).toBe(120);
  });

  it("Block 3 strength_c: no pairs (no clean antagonist match in v0.7)", () => {
    const result = applySupersetPairing(C_BASE, 3, "strength_c");
    for (const ex of result) {
      expect(ex.supersetGroup ?? null).toBe(null);
    }
  });

  it("returns a NEW array (does not mutate input)", () => {
    const input = STRENGTH_TEMPLATES_PUBLIC.strength_a.map((e) => ({ ...e }));
    const before = JSON.stringify(input);
    applySupersetPairing(input, 3, "strength_a");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("applies cleanly to Block 2 and Block 4 (full Build/Specific window)", () => {
    for (const block of [2, 3, 4] as const) {
      const result = applySupersetPairing(A_BASE, block, "strength_a");
      const bench = find(result, "Bench Press");
      expect(bench?.supersetGroup).toBe("A1");
    }
  });
});
