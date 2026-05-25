// Sprint v1.6: Tests for the superset grouping logic used in ExerciseList.
import { describe, it, expect } from "vitest";
import { groupBySupersets } from "@/components/training/shared";
import type { ExerciseShape } from "@/components/training/shared";

function ex(name: string, supersetGroup?: string | null): ExerciseShape {
  return { name, sets: 3, reps: 10, supersetGroup: supersetGroup ?? null };
}

describe("groupBySupersets", () => {
  it("groups consecutive exercises with the same supersetGroup", () => {
    const exercises = [
      ex("Hex Bar Deadlift"),
      ex("Reverse Lunge", "A1"),
      ex("Face Pulls", "A1"),
      ex("Tib Raises", "A2"),
      ex("Pallof Press", "A2"),
    ];

    const groups = groupBySupersets(exercises);

    expect(groups).toHaveLength(3); // 1 single + 2 supersets
    expect(groups[0].type).toBe("single");
    expect(groups[0].exercises[0].name).toBe("Hex Bar Deadlift");

    expect(groups[1].type).toBe("superset");
    if (groups[1].type === "superset") {
      expect(groups[1].supersetGroup).toBe("A1");
      expect(groups[1].exercises).toHaveLength(2);
      expect(groups[1].exercises[0].name).toBe("Reverse Lunge");
      expect(groups[1].exercises[1].name).toBe("Face Pulls");
    }

    expect(groups[2].type).toBe("superset");
    if (groups[2].type === "superset") {
      expect(groups[2].supersetGroup).toBe("A2");
      expect(groups[2].exercises).toHaveLength(2);
    }
  });

  it("keeps exercises without supersetGroup as singles", () => {
    const exercises = [
      ex("Hex Bar Deadlift"),
      ex("Bench Press"),
      ex("DB Row"),
    ];

    const groups = groupBySupersets(exercises);

    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.type === "single")).toBe(true);
  });

  it("handles empty array", () => {
    expect(groupBySupersets([])).toEqual([]);
  });

  it("handles a single exercise", () => {
    const groups = groupBySupersets([ex("Pull-ups")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("single");
  });

  it("handles all exercises in one superset", () => {
    const exercises = [
      ex("Bulgarian Split Squat", "A3"),
      ex("DB Row", "A3"),
    ];

    const groups = groupBySupersets(exercises);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("superset");
    if (groups[0].type === "superset") {
      expect(groups[0].supersetGroup).toBe("A3");
      expect(groups[0].exercises).toHaveLength(2);
    }
  });

  it("treats null supersetGroup as single", () => {
    const exercises = [
      { ...ex("Hex Bar Deadlift"), supersetGroup: null },
      ex("Bench Press"),
    ];

    const groups = groupBySupersets(exercises);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.type === "single")).toBe(true);
  });

  it("splits non-consecutive exercises with same group into separate groups", () => {
    const exercises = [
      ex("Reverse Lunge", "A1"),
      ex("Face Pulls", "A1"),
      ex("Hex Bar Deadlift"), // breaks the group
      ex("Tib Raises", "A1"), // same group label but not consecutive
      ex("Pallof Press", "A1"),
    ];

    const groups = groupBySupersets(exercises);

    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("superset");
    expect(groups[1].type).toBe("single");
    expect(groups[2].type).toBe("superset");
    if (groups[0].type === "superset" && groups[2].type === "superset") {
      expect(groups[0].supersetGroup).toBe("A1");
      expect(groups[0].exercises).toHaveLength(2);
      expect(groups[2].supersetGroup).toBe("A1");
      expect(groups[2].exercises).toHaveLength(2);
    }
  });

  it("Block 1 StrA layout: 2 compounds + 3 supersets", () => {
    // Real Block 1 StrA from Sprint v1.5
    const exercises = [
      ex("Hex Bar Deadlift"),
      ex("Bench Press"),
      ex("Reverse Lunge", "A1"),
      ex("Face Pulls", "A1"),
      ex("Tibialis Anterior Raises", "A2"),
      ex("Pallof Press", "A2"),
      ex("Bulgarian Split Squat", "A3"),
      ex("DB Row", "A3"),
    ];

    const groups = groupBySupersets(exercises);

    expect(groups).toHaveLength(5); // 2 singles + 3 supersets
    expect(groups[0].type).toBe("single");
    expect(groups[1].type).toBe("single");
    expect(groups[2].type).toBe("superset");
    expect(groups[3].type).toBe("superset");
    expect(groups[4].type).toBe("superset");
  });
});
