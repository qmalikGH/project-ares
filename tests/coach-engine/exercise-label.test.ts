import { describe, it, expect } from "vitest";
import { exerciseDisplayName } from "@/lib/coach-engine/exercise-label";

describe("exerciseDisplayName (Sprint 3.4, #28)", () => {
  it("marks back-off sets", () => {
    expect(exerciseDisplayName({ name: "Deadlift", isBackoff: true })).toBe("Deadlift (Back-off)");
  });

  it("leaves every other exercise unchanged", () => {
    expect(exerciseDisplayName({ name: "Deadlift" })).toBe("Deadlift");
    expect(exerciseDisplayName({ name: "Deadlift", isBackoff: false })).toBe("Deadlift");
    expect(exerciseDisplayName({ name: "Face Pulls", isBackoff: null })).toBe("Face Pulls");
  });
});
