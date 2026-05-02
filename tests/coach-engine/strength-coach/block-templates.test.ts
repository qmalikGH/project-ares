// Sprint v0.11: Block-2 templates load automatically when phaseConfig.blockNumber=2,
// HSR-Lifts stay constant across blocks, fillAbsoluteLoads snaps to 2.5kg.
import { describe, it, expect } from "vitest";

import {
  BLOCK_TEMPLATES,
  fillAbsoluteLoads,
  generateWeekStrengthPlan,
  getStrengthTemplate,
} from "@/lib/coach-engine/strength-coach";
import type { Exercise, PhaseConfig } from "@/lib/coach-engine/types";

const baseConfig = (blockNumber: 1 | 2 | 3 | 4 | 5): PhaseConfig => ({
  blockNumber,
  phaseName: "ACCUMULATION_AEROBIC_BASE",
  durationWeeks: 4,
  enduranceTID: { z1: 78, z2: 20, z3: 2 },
  strengthMode: "linear_progression",
  strengthRpeCap: 8,
  volumeProgression: "linear_increase",
  vdotTarget: 42,
});

describe("BLOCK_TEMPLATES", () => {
  it("defines templates for Block 1 and Block 2", () => {
    expect(BLOCK_TEMPLATES[1]).toBeDefined();
    expect(BLOCK_TEMPLATES[2]).toBeDefined();
  });

  it("Block 2 keeps HSR lifts identical to Block 1 (Kongsgaard 2009)", () => {
    const findByName = (list: Exercise[], name: string) =>
      list.find((e) => e.name === name);

    const b1HexA = findByName(BLOCK_TEMPLATES[1]!.strength_a, "Hex Bar Deadlift");
    const b2HexA = findByName(BLOCK_TEMPLATES[2]!.strength_a, "Hex Bar Deadlift");
    expect(b1HexA?.sets).toBe(b2HexA?.sets);
    expect(b1HexA?.reps).toBe(b2HexA?.reps);
    expect(b1HexA?.loadPct).toBe(b2HexA?.loadPct);
    expect(b1HexA?.tempo).toBe(b2HexA?.tempo);

    const b1RDL = findByName(BLOCK_TEMPLATES[1]!.strength_b, "Romanian Deadlift");
    const b2RDL = findByName(BLOCK_TEMPLATES[2]!.strength_b, "Romanian Deadlift");
    expect(b1RDL?.sets).toBe(b2RDL?.sets);
    expect(b1RDL?.loadPct).toBe(b2RDL?.loadPct);
  });

  it("Block 2 swaps accessories systematically (Kassiano 2022)", () => {
    const namesB1A = BLOCK_TEMPLATES[1]!.strength_a.map((e) => e.name);
    const namesB2A = BLOCK_TEMPLATES[2]!.strength_a.map((e) => e.name);
    expect(namesB1A).toContain("Bench Press");
    expect(namesB1A).toContain("Reverse Lunge");
    expect(namesB2A).toContain("Incline DB Press");
    expect(namesB2A).toContain("Bulgarian Split Squat");
    expect(namesB2A).not.toContain("Bench Press");
    expect(namesB2A).not.toContain("Reverse Lunge");

    const namesB1B = BLOCK_TEMPLATES[1]!.strength_b.map((e) => e.name);
    const namesB2B = BLOCK_TEMPLATES[2]!.strength_b.map((e) => e.name);
    expect(namesB1B).toContain("Pull-ups");
    expect(namesB2B).toContain("Barbell Row");
    expect(namesB2B).not.toContain("Pull-ups");
  });
});

describe("getStrengthTemplate fallback", () => {
  it("falls back to Block 1 templates when block 3-5 are undefined", () => {
    const b3 = getStrengthTemplate(3, "strength_a");
    const b1 = getStrengthTemplate(1, "strength_a");
    expect(b3).toBe(b1);

    const b5 = getStrengthTemplate(5, "strength_b");
    const b1b = getStrengthTemplate(1, "strength_b");
    expect(b5).toBe(b1b);
  });
});

describe("generateWeekStrengthPlan picks block-specific templates", () => {
  const monday = new Date("2026-04-27T00:00:00.000Z");

  it("Block 2 produces Strength A with Incline DB Press (not Bench Press)", () => {
    const plan = generateWeekStrengthPlan(baseConfig(2), 5, monday);
    const strA = plan.sessions.find((s) => s.type === "strength_a");
    expect(strA).toBeDefined();
    const names = (strA!.exercises ?? []).map((e) => e.name);
    expect(names).toContain("Incline DB Press");
    expect(names).not.toContain("Bench Press");
  });

  it("Block 1 produces Strength A with Bench Press (control)", () => {
    const plan = generateWeekStrengthPlan(baseConfig(1), 1, monday);
    const strA = plan.sessions.find((s) => s.type === "strength_a");
    const names = (strA!.exercises ?? []).map((e) => e.name);
    expect(names).toContain("Bench Press");
  });
});

describe("fillAbsoluteLoads", () => {
  const sample: Exercise[] = [
    { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8 },
    { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8 },
    // No loadPct — should pass through unchanged.
    { name: "Pull-ups", sets: 4, reps: 8, rpeCap: 8 },
  ];

  it("snaps loadAbs to 2.5 kg plates from user 1RM × loadPct", () => {
    const result = fillAbsoluteLoads(sample, {
      "Hex Bar Deadlift": 120, // 120 × 0.82 = 98.4 → 97.5
      "Bench Press": 80, // 80 × 0.75 = 60.0 → 60.0
    });
    expect(result[0].loadAbs).toBe(97.5);
    expect(result[1].loadAbs).toBe(60);
  });

  it("leaves loadAbs undefined when no 1RM is known for the exercise", () => {
    const result = fillAbsoluteLoads(sample, {
      "Hex Bar Deadlift": 120,
      // Bench Press intentionally missing
    });
    expect(result[0].loadAbs).toBe(97.5);
    expect(result[1].loadAbs).toBeUndefined();
  });

  it("passes through exercises without loadPct (Pull-ups, isometrics)", () => {
    const result = fillAbsoluteLoads(sample, {
      "Hex Bar Deadlift": 120,
      "Pull-ups": 90, // ignored — Pull-ups has no loadPct
    });
    expect(result[2].loadAbs).toBeUndefined();
  });

  it("returns inputs unchanged when no maxEstimates is provided", () => {
    expect(fillAbsoluteLoads(sample, null)).toStrictEqual(sample);
    expect(fillAbsoluteLoads(sample, undefined)).toStrictEqual(sample);
  });
});

describe("generateWeekStrengthPlan integrates fillAbsoluteLoads", () => {
  const monday = new Date("2026-04-27T00:00:00.000Z");

  it("Block 2 + 1RM map populates loadAbs on Hex Bar Deadlift", () => {
    const plan = generateWeekStrengthPlan(baseConfig(2), 5, monday, null, null, {
      "Hex Bar Deadlift": 120,
    });
    const strA = plan.sessions.find((s) => s.type === "strength_a");
    const hex = strA!.exercises!.find((e) => e.name === "Hex Bar Deadlift" && !e.isWarmup);
    expect(hex?.loadAbs).toBe(97.5); // 120 × 0.82 = 98.4 → 97.5
  });
});
