import { describe, it, expect } from "vitest";
import {
  applySupersetPairing,
  isHsrLift,
  BLOCK_TEMPLATES,
} from "@/lib/coach-engine/strength-coach";
import type { Exercise } from "@/lib/coach-engine/types";

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
    expect(isHsrLift("Face Pulls")).toBe(false);
    expect(isHsrLift("Pull-ups")).toBe(false);
  });
});

describe("applySupersetPairing — Block 1 + 5 = Straight Sets", () => {
  it("Block 1 strength_a: all exercises remain Straight Sets", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[1]!.strength_a, 1, "strength_a");
    for (const ex of result) {
      expect(ex.supersetGroup ?? null).toBe(null);
      expect(ex.supersetOrder ?? null).toBe(null);
    }
  });

  it("Block 5 strength_a: peaking phase keeps Straight Sets (Iversen 2024)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[1]!.strength_a, 5, "strength_a");
    for (const ex of result) {
      expect(ex.supersetGroup ?? null).toBe(null);
    }
  });
});

describe("applySupersetPairing — Block 2 (Sprint v1.4)", () => {
  it("strength_a: Incline DB Press + Face Pulls become A1 superset", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[2]!.strength_a, 2, "strength_a");
    const inclineDb = find(result, "Incline DB Press");
    const facePulls = find(result, "Face Pulls");

    expect(inclineDb?.supersetGroup).toBe("A1");
    expect(inclineDb?.supersetOrder).toBe(1);
    expect(inclineDb?.restSec).toBe(0);

    expect(facePulls?.supersetGroup).toBe("A1");
    expect(facePulls?.supersetOrder).toBe(2);
  });

  it("strength_b: Barbell Row + Single-Leg Hip Thrust become B1 superset", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[2]!.strength_b, 2, "strength_b");
    const row = find(result, "Barbell Row");
    const hipThrust = find(result, "Single-Leg Hip Thrust");

    expect(row?.supersetGroup).toBe("B1");
    expect(row?.supersetOrder).toBe(1);
    expect(row?.restSec).toBe(0);

    expect(hipThrust?.supersetGroup).toBe("B1");
    expect(hipThrust?.supersetOrder).toBe(2);
    expect(hipThrust?.restSec).toBe(120);
  });

  it("strength_c: no pairs (Push-ups + Chin-ups stay Straight Sets in Block 2)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[2]!.strength_c, 2, "strength_c");
    for (const ex of result) {
      expect(ex.supersetGroup ?? null).toBe(null);
    }
  });

  it("HSR (Hex Bar Deadlift, RDL) NEVER paired", () => {
    const aResult = applySupersetPairing(BLOCK_TEMPLATES[2]!.strength_a, 2, "strength_a");
    const hex = find(aResult, "Hex Bar Deadlift");
    expect(hex?.supersetGroup ?? null).toBe(null);
    expect(hex?.restSec).toBe(180);

    const bResult = applySupersetPairing(BLOCK_TEMPLATES[2]!.strength_b, 2, "strength_b");
    const rdl = find(bResult, "Romanian Deadlift");
    expect(rdl?.supersetGroup ?? null).toBe(null);
    expect(rdl?.restSec).toBe(180);
  });
});

describe("applySupersetPairing — Block 3 (Sprint v1.4)", () => {
  it("strength_a: Bench Press + Face Pulls become A1 superset", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[3]!.strength_a, 3, "strength_a");
    const bench = find(result, "Bench Press");
    const facePulls = find(result, "Face Pulls");

    expect(bench?.supersetGroup).toBe("A1");
    expect(bench?.supersetOrder).toBe(1);
    expect(facePulls?.supersetGroup).toBe("A1");
    expect(facePulls?.supersetOrder).toBe(2);
  });

  it("strength_b: Pull-ups + Nordic Curls become B1 superset", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[3]!.strength_b, 3, "strength_b");
    const pullups = find(result, "Pull-ups");
    const nordic = find(result, "Nordic Curls");

    expect(pullups?.supersetGroup).toBe("B1");
    expect(pullups?.supersetOrder).toBe(1);
    expect(nordic?.supersetGroup).toBe("B1");
    expect(nordic?.supersetOrder).toBe(2);
    expect(nordic?.restSec).toBe(120);
  });

  it("strength_c: DB Bench Press + DB Row become C1 antagonist pair", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[3]!.strength_c, 3, "strength_c");
    const dbBench = find(result, "DB Bench Press");
    const dbRow = find(result, "DB Row");

    expect(dbBench?.supersetGroup).toBe("C1");
    expect(dbBench?.supersetOrder).toBe(1);
    expect(dbRow?.supersetGroup).toBe("C1");
    expect(dbRow?.supersetOrder).toBe(2);
  });

  it("HSR-Lifts NEVER paired (Kongsgaard 2009)", () => {
    const aResult = applySupersetPairing(BLOCK_TEMPLATES[3]!.strength_a, 3, "strength_a");
    const hex = find(aResult, "Hex Bar Deadlift");
    expect(hex?.supersetGroup ?? null).toBe(null);
    expect(hex?.restSec).toBe(180);
  });
});

describe("applySupersetPairing — Block 4 (Sprint v1.4)", () => {
  it("strength_a: Incline DB Press + Band Pull-Aparts become A1", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[4]!.strength_a, 4, "strength_a");
    const inclineDb = find(result, "Incline DB Press");
    const bandPa = find(result, "Band Pull-Aparts");

    expect(inclineDb?.supersetGroup).toBe("A1");
    expect(bandPa?.supersetGroup).toBe("A1");
  });

  it("strength_b: Barbell Row + Nordic Curls become B1", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[4]!.strength_b, 4, "strength_b");
    const row = find(result, "Barbell Row");
    const nordic = find(result, "Nordic Curls");

    expect(row?.supersetGroup).toBe("B1");
    expect(nordic?.supersetGroup).toBe("B1");
  });

  it("strength_c: Push-ups + Chin-ups become C1", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[4]!.strength_c, 4, "strength_c");
    const pushups = find(result, "Push-ups");
    const chinups = find(result, "Chin-ups");

    expect(pushups?.supersetGroup).toBe("C1");
    expect(chinups?.supersetGroup).toBe("C1");
  });
});

describe("applySupersetPairing — immutability", () => {
  it("returns a NEW array (does not mutate input)", () => {
    const input = BLOCK_TEMPLATES[2]!.strength_a.map((e) => ({ ...e }));
    const before = JSON.stringify(input);
    applySupersetPairing(input, 2, "strength_a");
    expect(JSON.stringify(input)).toBe(before);
  });
});
