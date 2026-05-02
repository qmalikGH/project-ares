// Sprint v0.13: Pre-Run Activation block tests.
// Verifies the hip/core activation template for run-only days.

import { describe, it, expect } from "vitest";
import {
  PRE_RUN_ACTIVATION,
  ACTIVATION_DURATION_MIN,
} from "@/lib/coach-engine/run-coach/activation";

describe("PRE_RUN_ACTIVATION", () => {
  it("contains 4 exercises", () => {
    expect(PRE_RUN_ACTIVATION).toHaveLength(4);
  });

  it("all exercises are marked as warmup", () => {
    for (const ex of PRE_RUN_ACTIVATION) {
      expect(ex.isWarmup).toBe(true);
    }
  });

  it("all RPE caps are <= 4", () => {
    for (const ex of PRE_RUN_ACTIVATION) {
      expect(ex.rpeCap).toBeLessThanOrEqual(4);
    }
  });

  it("all exercises have names and sets/reps", () => {
    for (const ex of PRE_RUN_ACTIVATION) {
      expect(ex.name).toBeTruthy();
      expect(ex.sets).toBeGreaterThan(0);
      expect(ex.reps).toBeTruthy();
    }
  });

  it("includes the expected exercise names", () => {
    const names = PRE_RUN_ACTIVATION.map((e) => e.name);
    expect(names).toContain("Glute Bridge");
    expect(names).toContain("Clamshell");
    expect(names).toContain("Dead Bug");
    expect(names).toContain("Bird Dog");
  });

  it("has 2 sets per exercise", () => {
    for (const ex of PRE_RUN_ACTIVATION) {
      expect(ex.sets).toBe(2);
    }
  });

  it("all exercises have short rest (recovery is not the goal)", () => {
    for (const ex of PRE_RUN_ACTIVATION) {
      expect(ex.restSec).toBeLessThanOrEqual(30);
    }
  });
});

describe("ACTIVATION_DURATION_MIN", () => {
  it("is 5 minutes", () => {
    expect(ACTIVATION_DURATION_MIN).toBe(5);
  });
});
