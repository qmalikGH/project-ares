// Sprint v1.5 — Superset-Pairing tests for the new template-driven model.
//
// Templates declare `supersetGroup` directly on each exercise. The
// applySupersetPairing function just:
//   - strips supersetGroup from any HSR-Lift (Kongsgaard guard),
//   - assigns supersetOrder by encounter order within each group,
//   - sets restSec=0 on order-1, 60-120s on order 2+.
//
// All blocks (1-5) now use template-defined pairings.

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
    expect(isHsrLift("DB Row")).toBe(false);
  });
});

describe("applySupersetPairing — HSR-Guard (Sprint v1.5)", () => {
  it("strips supersetGroup from Hex Bar Deadlift even if template sets it", () => {
    const exercises: Exercise[] = [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, supersetGroup: "A1" },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, supersetGroup: "A1" },
    ];
    const result = applySupersetPairing(exercises, 2, "strength_a");
    const hex = find(result, "Hex Bar Deadlift");
    expect(hex?.supersetGroup ?? null).toBe(null);
  });

  it("strips supersetGroup from Romanian Deadlift", () => {
    const exercises: Exercise[] = [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, supersetGroup: "B1" },
    ];
    const result = applySupersetPairing(exercises, 2, "strength_b");
    const rdl = find(result, "Romanian Deadlift");
    expect(rdl?.supersetGroup ?? null).toBe(null);
  });
});

describe("applySupersetPairing — order assignment", () => {
  it("assigns order 1 to first exercise of pair, order 2 to second", () => {
    const exercises: Exercise[] = [
      { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8, supersetGroup: "A1" },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, supersetGroup: "A1" },
    ];
    const result = applySupersetPairing(exercises, 3, "strength_a");
    expect(find(result, "Bench Press")?.supersetOrder).toBe(1);
    expect(find(result, "Face Pulls")?.supersetOrder).toBe(2);
  });

  it("order-1 gets restSec=0 (immediate transition)", () => {
    const exercises: Exercise[] = [
      { name: "Goblet Squat", sets: 3, reps: 10, rpeCap: 7, supersetGroup: "B2" },
      { name: "Seated Cable Row", sets: 3, reps: 10, rpeCap: 7, supersetGroup: "B2" },
    ];
    const result = applySupersetPairing(exercises, 1, "strength_b");
    expect(find(result, "Goblet Squat")?.restSec).toBe(0);
  });

  it("heavy compound order-2 (loadPct >= 65) gets 120s cycle rest", () => {
    const exercises: Exercise[] = [
      { name: "Goblet Squat", sets: 3, reps: 10, rpeCap: 7, supersetGroup: "A3" },
      { name: "Barbell Row", sets: 4, reps: 8, loadPct: 65, rpeCap: 8, supersetGroup: "A3" },
    ];
    const result = applySupersetPairing(exercises, 2, "strength_a");
    expect(find(result, "Barbell Row")?.restSec).toBe(120);
  });

  it("light accessory order-2 gets 60s cycle rest", () => {
    const exercises: Exercise[] = [
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", rpeCap: 7, supersetGroup: "A3" },
      { name: "DB Row", sets: 3, reps: 10, rpeCap: 7, supersetGroup: "A3" },
    ];
    const result = applySupersetPairing(exercises, 1, "strength_a");
    expect(find(result, "DB Row")?.restSec).toBe(60);
  });
});

describe("applySupersetPairing — Block 1 templates (Sprint v1.5: now uses pairings)", () => {
  it("StrA: DB Shoulder Press + Face Pulls paired as A1 (Sprint v1.7)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[1]!.strength_a, 1, "strength_a");
    expect(find(result, "DB Shoulder Press")?.supersetGroup).toBe("A1");
    expect(find(result, "Face Pulls")?.supersetGroup).toBe("A1");
  });

  it("StrA: BSS + DB Row paired as A3 (new Quad+Back superset)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[1]!.strength_a, 1, "strength_a");
    expect(find(result, "Bulgarian Split Squat")?.supersetGroup).toBe("A3");
    expect(find(result, "DB Row")?.supersetGroup).toBe("A3");
  });

  it("StrB: Goblet Squat + Seated Cable Row paired as B2", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[1]!.strength_b, 1, "strength_b");
    expect(find(result, "Goblet Squat")?.supersetGroup).toBe("B2");
    expect(find(result, "Seated Cable Row")?.supersetGroup).toBe("B2");
  });

  it("StrC: DB Row + Broad Jumps + Lat Pulldown paired as C1 (Sprint v1.7: Lat Pulldown re-homed, C3 removed)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[1]!.strength_c, 1, "strength_c");
    expect(find(result, "DB Row")?.supersetGroup).toBe("C1");
    expect(find(result, "Broad Jumps")?.supersetGroup).toBe("C1");
    expect(find(result, "Lat Pulldown")?.supersetGroup).toBe("C1");
    // Walking Lunge removed in the quad cut.
    expect(find(result, "Walking Lunge")).toBeUndefined();
  });

  it("Hex Bar Deadlift NOT paired in any Block 1 session", () => {
    for (const slot of ["strength_a", "strength_c"] as const) {
      const result = applySupersetPairing(
        BLOCK_TEMPLATES[1]![slot],
        1,
        slot,
      );
      const hex = find(result, "Hex Bar Deadlift");
      expect(hex?.supersetGroup ?? null).toBe(null);
      expect(hex?.restSec).toBe(180);
    }
  });
});

describe("applySupersetPairing — Block 3 templates (maintenance)", () => {
  it("StrA: Step-ups + Face Pulls (A1), Goblet Squat + Cable Row (A3)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[3]!.strength_a, 3, "strength_a");
    expect(find(result, "Step-ups")?.supersetGroup).toBe("A1");
    expect(find(result, "Face Pulls")?.supersetGroup).toBe("A1");
    expect(find(result, "Goblet Squat")?.supersetGroup).toBe("A3");
    expect(find(result, "Seated Cable Row")?.supersetGroup).toBe("A3");
  });

  it("StrB: Nordic Curls + Face Pulls (B1), BSS + Lat Pulldown (B2)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[3]!.strength_b, 3, "strength_b");
    expect(find(result, "Nordic Curls")?.supersetGroup).toBe("B1");
    expect(find(result, "Bulgarian Split Squat")?.supersetGroup).toBe("B2");
    expect(find(result, "Lat Pulldown")?.supersetGroup).toBe("B2");
  });

  it("StrC: DB Row + Box Jumps (C1), Walking Lunge + Chin-ups (C3)", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[3]!.strength_c, 3, "strength_c");
    expect(find(result, "DB Row")?.supersetGroup).toBe("C1");
    expect(find(result, "Box Jumps")?.supersetGroup).toBe("C1");
    expect(find(result, "Walking Lunge")?.supersetGroup).toBe("C3");
    expect(find(result, "Chin-ups")?.supersetGroup).toBe("C3");
  });
});

describe("applySupersetPairing — Block 5 falls back to Block 4 templates", () => {
  it("Block 5 strength_a inherits Block 4 supersets (via walk-down fallback)", () => {
    // Block 5 has no template — getStrengthTemplate walks down to Block 4.
    // applySupersetPairing applied to Block 4 template still pairs.
    const result = applySupersetPairing(BLOCK_TEMPLATES[4]!.strength_a, 5, "strength_a");
    expect(find(result, "Bulgarian Split Squat")?.supersetGroup).toBe("A1");
    expect(find(result, "Band Pull-Aparts")?.supersetGroup).toBe("A1");
  });

  it("HSR still guarded in Block 5", () => {
    const result = applySupersetPairing(BLOCK_TEMPLATES[4]!.strength_a, 5, "strength_a");
    const hex = find(result, "Hex Bar Deadlift");
    expect(hex?.supersetGroup ?? null).toBe(null);
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
