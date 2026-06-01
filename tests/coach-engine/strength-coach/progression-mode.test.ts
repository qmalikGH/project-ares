// Sprint 2.1 — progression-mode classifier. Pure, no DB.
import { describe, it, expect } from "vitest";

import {
  progressionModeFor,
  tmIncrementKg,
  TM_COMPOUNDS,
} from "@/lib/coach-engine/strength-coach/progression-mode";

describe("progressionModeFor", () => {
  it("classifies loaded compounds as training_max", () => {
    expect(progressionModeFor("Hex Bar Deadlift")).toBe("training_max");
    expect(progressionModeFor("Romanian Deadlift")).toBe("training_max");
    expect(progressionModeFor("Bench Press")).toBe("training_max");
    expect(progressionModeFor("Barbell Row")).toBe("training_max");
    expect(progressionModeFor("DB Shoulder Press")).toBe("training_max");
    expect(progressionModeFor("Hip Thrust")).toBe("training_max");
  });

  it("classifies accessories / carries / plyos as rep_rpe", () => {
    expect(progressionModeFor("DB Row")).toBe("rep_rpe");
    expect(progressionModeFor("Face Pulls")).toBe("rep_rpe");
    expect(progressionModeFor("Farmer's Carry")).toBe("rep_rpe");
    expect(progressionModeFor("Box Jumps")).toBe("rep_rpe");
    expect(progressionModeFor("Single-Leg Calf Raises")).toBe("rep_rpe");
    expect(progressionModeFor("Goblet Squat")).toBe("rep_rpe");
  });

  it("classifies isometrics / activation as none", () => {
    expect(progressionModeFor("Wall Sit")).toBe("none");
    expect(progressionModeFor("Short Foot Exercise")).toBe("none");
  });
});

describe("tmIncrementKg", () => {
  it("gives +5 kg to lower-body hinge/press", () => {
    expect(tmIncrementKg("Hex Bar Deadlift")).toBe(5);
    expect(tmIncrementKg("Romanian Deadlift")).toBe(5);
    expect(tmIncrementKg("Hip Thrust")).toBe(5);
  });

  it("gives +2.5 kg to upper-body lifts", () => {
    expect(tmIncrementKg("Bench Press")).toBe(2.5);
    expect(tmIncrementKg("Barbell Row")).toBe(2.5);
    expect(tmIncrementKg("DB Shoulder Press")).toBe(2.5);
  });

  it("gives 0 to non-TM exercises", () => {
    expect(tmIncrementKg("Face Pulls")).toBe(0);
    expect(tmIncrementKg("Wall Sit")).toBe(0);
  });

  it("every TM compound has a non-zero increment", () => {
    for (const name of TM_COMPOUNDS) {
      expect(tmIncrementKg(name)).toBeGreaterThan(0);
    }
  });
});
