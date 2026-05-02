// Sprint v0.13: Warmup ramp-up set generator tests.
// Verifies the 3-stage protocol (50%×5, 70%×3, 85%×2) for compound lifts.

import { describe, it, expect } from "vitest";
import {
  generateWarmupSetsForExercise,
  insertWarmupSets,
} from "@/lib/coach-engine/strength-coach/warmup";
import type { Exercise } from "@/lib/coach-engine/types";

// ============================================
// generateWarmupSetsForExercise
// ============================================

describe("generateWarmupSetsForExercise", () => {
  it("generates 3 ramp-up sets for compound lift at 82%", () => {
    const exercise: Exercise = {
      name: "Hex Bar Deadlift",
      sets: 4,
      reps: 5,
      loadPct: 82,
      rpeCap: 8,
    };
    const warmups = generateWarmupSetsForExercise(exercise);
    expect(warmups).toHaveLength(3);

    // Stage 1: 82% × 0.50 = 41%
    expect(warmups[0].loadPct).toBe(41);
    expect(warmups[0].reps).toBe(5);
    expect(warmups[0].sets).toBe(1);
    expect(warmups[0].isWarmup).toBe(true);
    expect(warmups[0].name).toBe("Hex Bar Deadlift");

    // Stage 2: 82% × 0.70 ≈ 57%
    expect(warmups[1].loadPct).toBe(57);
    expect(warmups[1].reps).toBe(3);
    expect(warmups[1].isWarmup).toBe(true);

    // Stage 3: 82% × 0.85 ≈ 70%
    expect(warmups[2].loadPct).toBe(70);
    expect(warmups[2].reps).toBe(2);
    expect(warmups[2].isWarmup).toBe(true);
  });

  it("returns empty array for accessories below threshold (loadPct < 60)", () => {
    const exercise: Exercise = {
      name: "Bulgarian Split Squat",
      sets: 3,
      reps: "8/leg",
      loadPct: 55,
      rpeCap: 7,
    };
    const warmups = generateWarmupSetsForExercise(exercise);
    expect(warmups).toHaveLength(0);
  });

  it("returns empty array for exercises without loadPct (bodyweight)", () => {
    const exercise: Exercise = {
      name: "Pull-ups",
      sets: 4,
      reps: 8,
      rpeCap: 8,
    };
    const warmups = generateWarmupSetsForExercise(exercise);
    expect(warmups).toHaveLength(0);
  });

  it("returns empty array for accessories with no loadPct (string reps)", () => {
    const exercise: Exercise = {
      name: "Pallof Press",
      sets: 3,
      reps: "10/side",
      rpeCap: 6,
    };
    const warmups = generateWarmupSetsForExercise(exercise);
    expect(warmups).toHaveLength(0);
  });

  it("generates warmup for exercise exactly at 60% threshold", () => {
    const exercise: Exercise = {
      name: "Reverse Lunge",
      sets: 3,
      reps: "8/leg",
      loadPct: 60,
      rpeCap: 7,
    };
    const warmups = generateWarmupSetsForExercise(exercise);
    expect(warmups).toHaveLength(3);
    // Stage 1: 60% × 0.50 = 30%
    expect(warmups[0].loadPct).toBe(30);
  });

  it("fills absolute kg when 1RM is provided", () => {
    const exercise: Exercise = {
      name: "Hex Bar Deadlift",
      sets: 4,
      reps: 5,
      loadPct: 82,
      rpeCap: 8,
    };
    const warmups = generateWarmupSetsForExercise(exercise, 120);
    expect(warmups).toHaveLength(3);
    // All warmup sets should have loadAbs filled
    for (const wu of warmups) {
      expect(wu.loadAbs).toBeDefined();
      expect(wu.loadAbs).toBeGreaterThan(0);
    }
    // Stage 1: 41% of 120 = 49.2 → snapped to 50kg
    expect(warmups[0].loadAbs).toBe(50);
  });

  it("does not fill loadAbs when 1RM is null", () => {
    const exercise: Exercise = {
      name: "Hex Bar Deadlift",
      sets: 4,
      reps: 5,
      loadPct: 82,
      rpeCap: 8,
    };
    const warmups = generateWarmupSetsForExercise(exercise, null);
    for (const wu of warmups) {
      expect(wu.loadAbs).toBeUndefined();
    }
  });

  it("sets warmup RPE lower than working RPE", () => {
    const exercise: Exercise = {
      name: "Bench Press",
      sets: 3,
      reps: 8,
      loadPct: 75,
      rpeCap: 8,
    };
    const warmups = generateWarmupSetsForExercise(exercise);
    for (const wu of warmups) {
      expect(wu.rpeCap).toBeLessThan(exercise.rpeCap!);
      expect(wu.rpeCap).toBeGreaterThanOrEqual(3);
    }
  });

  it("preserves tempo from working exercise", () => {
    const exercise: Exercise = {
      name: "Hex Bar Deadlift",
      sets: 4,
      reps: 5,
      loadPct: 82,
      rpeCap: 8,
      tempo: "3-3-1",
    };
    const warmups = generateWarmupSetsForExercise(exercise);
    for (const wu of warmups) {
      expect(wu.tempo).toBe("3-3-1");
    }
  });
});

// ============================================
// insertWarmupSets
// ============================================

describe("insertWarmupSets", () => {
  it("inserts warmup sets before qualifying compound exercises", () => {
    const exercises: Exercise[] = [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8 },
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6 },
    ];
    const result = insertWarmupSets(exercises);

    // 3 warmups + 1 working HBD + 1 Pallof = 5 total
    expect(result).toHaveLength(5);
    // First 3 are warmups
    expect(result[0].isWarmup).toBe(true);
    expect(result[1].isWarmup).toBe(true);
    expect(result[2].isWarmup).toBe(true);
    // Then working HBD
    expect(result[3].name).toBe("Hex Bar Deadlift");
    expect(result[3].isWarmup).toBeUndefined();
    // Then Pallof (no warmup)
    expect(result[4].name).toBe("Pallof Press");
  });

  it("deduplicates warmup for same exercise appearing twice", () => {
    const exercises: Exercise[] = [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8 },
      { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8 },
      { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7 },
    ];
    const result = insertWarmupSets(exercises);

    const hexWarmups = result.filter(
      (e) => e.name === "Hex Bar Deadlift" && e.isWarmup,
    );
    // Only one set of 3 warmups for HBD, not 6
    expect(hexWarmups).toHaveLength(3);

    const benchWarmups = result.filter(
      (e) => e.name === "Bench Press" && e.isWarmup,
    );
    expect(benchWarmups).toHaveLength(3);
  });

  it("does not insert warmups for exercises below 60% loadPct", () => {
    const exercises: Exercise[] = [
      { name: "Tibialis Anterior Raises", sets: 3, reps: 15, rpeCap: 6 },
      { name: "Short Foot Exercise", sets: 2, reps: "30sec hold", rpeCap: 5 },
    ];
    const result = insertWarmupSets(exercises);
    expect(result.filter((e) => e.isWarmup)).toHaveLength(0);
    expect(result).toHaveLength(2);
  });

  it("is idempotent ��� running insertWarmupSets twice produces same result", () => {
    const exercises: Exercise[] = [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8 },
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6 },
    ];
    const firstPass = insertWarmupSets(exercises);
    const secondPass = insertWarmupSets(firstPass);
    // Second pass should not add MORE warmups — the existing warmup sets
    // pass through (isWarmup check), and the working set already has its
    // name in warmedUpExercises from the first-pass warmups.
    expect(secondPass).toEqual(firstPass);
  });

  it("passes maxEstimates to fill loadAbs on warmup sets", () => {
    const exercises: Exercise[] = [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8 },
    ];
    const result = insertWarmupSets(exercises, { "Hex Bar Deadlift": 120 });
    const warmups = result.filter((e) => e.isWarmup);
    for (const wu of warmups) {
      expect(wu.loadAbs).toBeDefined();
      expect(wu.loadAbs).toBeGreaterThan(0);
    }
  });

  it("returns same order for non-qualifying exercises", () => {
    const exercises: Exercise[] = [
      { name: "A", sets: 3, reps: 10, rpeCap: 6 },
      { name: "B", sets: 3, reps: 10, rpeCap: 6 },
      { name: "C", sets: 3, reps: 10, rpeCap: 6 },
    ];
    const result = insertWarmupSets(exercises);
    expect(result).toEqual(exercises);
  });

  it("is deterministic — same inputs produce same outputs", () => {
    const exercises: Exercise[] = [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8 },
      { name: "Hip Thrust", sets: 3, reps: 10, loadPct: 70, rpeCap: 7 },
    ];
    const maxEstimates = { "Hex Bar Deadlift": 120, "Hip Thrust": 80 };
    const result1 = insertWarmupSets(exercises, maxEstimates);
    const result2 = insertWarmupSets(exercises, maxEstimates);
    expect(result1).toEqual(result2);
  });
});
