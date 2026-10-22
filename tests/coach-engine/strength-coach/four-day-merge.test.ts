// Sprint 3.3 (A2/A3) — Kraft C wird auf A und B verteilt. "Nichts wird weniger":
// pro Template-Block 1–4 hat jede Übung im neuen A+B mindestens so viele Sätze
// wie im alten A+B+C. Ausgenommen sind die drei Präventionsübungen (→ Heim-
// Routine) und Hex Bar → Deadlift (gleiche Satzzahl, andere Übung).
import { describe, expect, it } from "vitest";

import {
  BLOCK_TEMPLATES,
  generateWeekStrengthPlan,
  isHsrLift,
} from "@/lib/coach-engine/strength-coach";
import { BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";
import type { Exercise } from "@/lib/coach-engine/types";

/** Σ Sätze je Übung über A+B+C, eingefroren vom Stand vor Sprint 3.3
 *  (vor dem Umbau gegen die damaligen Templates geprüft). */
const OLD_SET_SUMS: Record<1 | 2 | 3 | 4, Record<string, number>> = {
  1: {
    "Hex Bar Deadlift": 7, "Bench Press": 3, "DB Shoulder Press": 3, "Face Pulls": 6,
    "Tibialis Anterior Raises": 3, "Pallof Press": 3, "Bulgarian Split Squat": 3, "DB Row": 6,
    "Romanian Deadlift": 3, "Pull-ups": 4, "Hip Thrust": 3, "Goblet Squat": 3,
    "Seated Cable Row": 3, "Short Foot Exercise": 2, "DB Bench Press": 3, "Broad Jumps": 3,
    "Lat Pulldown": 3, "Single-Leg Calf Raises": 3, "Farmer's Carry": 3,
  },
  2: {
    "Hex Bar Deadlift": 7, "Incline DB Press": 3, "Bulgarian Split Squat": 3, "Face Pulls": 6,
    "Tibialis Anterior Raises": 3, "Dead Bug": 3, "DB Shoulder Press": 3, "Walking Lunge": 3,
    "Lat Pulldown": 3, "Romanian Deadlift": 3, "Barbell Row": 4, "Single-Leg Hip Thrust": 3,
    "Seated Cable Row": 3, "Short Foot Exercise": 2, "Push-ups": 3, "Chin-ups": 3,
    "Box Jumps": 3, "DB Row": 3, "Single-Leg Calf Raises": 3, "Suitcase Carry": 3,
  },
  3: {
    "Hex Bar Deadlift": 7, "Bench Press": 3, "Step-ups": 3, "Face Pulls": 6,
    "Tibialis Anterior Raises": 3, "Pallof Press": 3, "Goblet Squat": 3, "Seated Cable Row": 3,
    "Romanian Deadlift": 3, "Pull-ups": 4, "Nordic Curls": 3, "Bulgarian Split Squat": 3,
    "Lat Pulldown": 3, "Short Foot Exercise": 2, "DB Bench Press": 3, "DB Row": 3,
    "Box Jumps": 3, "Single-Leg Calf Raises": 3, "Farmer's Carry": 3, "Walking Lunge": 3,
    "Chin-ups": 3,
  },
  4: {
    "Hex Bar Deadlift": 7, "Incline DB Press": 3, "Bulgarian Split Squat": 3, "Band Pull-Aparts": 3,
    "Tibialis Anterior Raises": 3, "Dead Bug": 3, "Step-ups": 3, "DB Row": 3,
    "Romanian Deadlift": 3, "Barbell Row": 4, "Nordic Curls": 3, "Face Pulls": 3,
    "Walking Lunge": 3, "Seated Cable Row": 3, "Short Foot Exercise": 2, "Push-ups": 3,
    "Chin-ups": 3, "Depth Drops": 3, "Single-Leg Calf Raises": 3, "Suitcase Carry": 3,
    "Goblet Squat": 3, "Lat Pulldown": 3,
  },
};

const PREVENTION = new Set(["Tibialis Anterior Raises", "Short Foot Exercise", "Single-Leg Calf Raises"]);
const RENAMED: Record<string, string> = { "Hex Bar Deadlift": "Deadlift" };
const BLOCKS = [1, 2, 3, 4] as const;

function templateSums(block: 1 | 2 | 3 | 4): Record<string, number> {
  const t = BLOCK_TEMPLATES[block]!;
  const sums: Record<string, number> = {};
  for (const ex of [...t.strength_a, ...t.strength_b]) sums[ex.name] = (sums[ex.name] ?? 0) + ex.sets;
  return sums;
}

const sumOf = (exs: Exercise[], names: readonly string[]) =>
  exs.filter((e) => !e.isWarmup && names.includes(e.name)).reduce((n, e) => n + e.sets, 0);

const CHEST = ["Bench Press", "DB Bench Press", "Incline DB Press", "Push-ups"];
const LATERAL_DELT = ["Lateral Raises", "DB Shoulder Press"];
const TRICEPS = ["Cable Triceps Pushdown"];

describe("template invariant: nothing gets less", () => {
  it.each(BLOCKS)("block %i: Σ sets per exercise in A+B ≥ old A+B+C", (b) => {
    const now = templateSums(b);
    for (const [name, oldSets] of Object.entries(OLD_SET_SUMS[b])) {
      if (PREVENTION.has(name)) continue;
      const target = RENAMED[name] ?? name;
      expect({ name: target, sets: now[target] ?? 0 }).toEqual({ name: target, sets: expect.any(Number) });
      expect(now[target] ?? 0, `${target} in block ${b}`).toBeGreaterThanOrEqual(oldSets);
    }
  });

  it.each(BLOCKS)("block %i: prevention work left the gym templates", (b) => {
    for (const name of PREVENTION) expect(templateSums(b)[name]).toBeUndefined();
  });

  it.each(BLOCKS)("block %i: Deadlift replaces the hex bar — 4×5 top sets, then 3×6 back-off", (b) => {
    const a = BLOCK_TEMPLATES[b]!.strength_a;
    expect(a.find((e) => e.name === "Hex Bar Deadlift")).toBeUndefined();
    const dl = a.filter((e) => e.name === "Deadlift");
    expect(dl).toHaveLength(2);
    expect(dl[0]).toMatchObject({ sets: 4, reps: 5, loadPct: 82, tempo: "3-3-1" });
    expect(dl[1]).toMatchObject({ sets: 3, reps: 6, loadPct: 75, tempo: "3-3-1", isBackoff: true });
  });

  it.each(BLOCKS)("block %i: the plyo opens Kraft A", (b) => {
    expect(BLOCK_TEMPLATES[b]!.strength_a[0].tempo).toBe("X-X-X");
  });
});

describe("upper-body volume (A3), W1 base", () => {
  it.each(BLOCKS)("block %i: chest ≥ 8, lateral delt ≥ 6, triceps ≥ 3 direct", (b) => {
    const t = BLOCK_TEMPLATES[b]!;
    const all = [...t.strength_a, ...t.strength_b];
    expect(sumOf(all, CHEST)).toBeGreaterThanOrEqual(8);
    expect(sumOf(all, LATERAL_DELT)).toBeGreaterThanOrEqual(6);
    expect(sumOf(all, TRICEPS)).toBeGreaterThanOrEqual(3);
  });

  // Coach decision #21 point 10: in maintenance the targets hold AFTER the mode
  // factor — upper body keeps its sets, lower body still follows the factor.
  it.each([3, 4] as const)("block %i (maintenance): targets hold in the generated W1", (b) => {
    const plan = generateWeekStrengthPlan(BLOCK_CONFIGS[b], 1, new Date("2026-11-30T00:00:00.000Z"));
    const all = plan.sessions.flatMap((s) => s.exercises ?? []);
    expect(sumOf(all, CHEST)).toBeGreaterThanOrEqual(8);
    expect(sumOf(all, LATERAL_DELT)).toBeGreaterThanOrEqual(6);
    expect(sumOf(all, TRICEPS)).toBeGreaterThanOrEqual(3);
    // Lower body still reduced: Deadlift 4 → 3 top sets.
    const dl = all.find((e) => e.name === "Deadlift" && !e.isWarmup && !e.isBackoff)!;
    expect(dl.sets).toBe(3);
  });
});

describe("generated weeks", () => {
  it.each([1, 2, 3, 4, 5] as const)("block %i: only Kraft A (Mon) and B (Thu), never strength_c", (b) => {
    const monday = new Date("2026-11-30T00:00:00.000Z");
    const plan = generateWeekStrengthPlan(BLOCK_CONFIGS[b], 1, monday);
    expect(plan.sessions.map((s) => s.type)).toEqual(["strength_a", "strength_b"]);
    expect(plan.sessions.map((s) => (s.date.getTime() - monday.getTime()) / 86400000)).toEqual([0, 3]);
  });

  it.each([1, 2, 3, 4, 5] as const)("block %i: no HSR lift (Deadlift, RDL) in a superset", (b) => {
    const plan = generateWeekStrengthPlan(BLOCK_CONFIGS[b], 2, new Date("2026-11-30T00:00:00.000Z"));
    for (const ex of plan.sessions.flatMap((s) => s.exercises ?? [])) {
      if (isHsrLift(ex.name)) expect(ex.supersetGroup, ex.name).toBeUndefined();
    }
    expect(isHsrLift("Deadlift")).toBe(true);
  });

  it("the back-off gets no warm-up of its own", () => {
    const plan = generateWeekStrengthPlan(BLOCK_CONFIGS[2], 1, new Date("2026-11-30T00:00:00.000Z"), null, null, {
      Deadlift: 120,
    });
    const a = plan.sessions[0].exercises!;
    const dlWarmups = a.filter((e) => e.isWarmup && e.name === "Deadlift");
    expect(dlWarmups).toHaveLength(3);
    // All three ramp sets sit before the top sets, none before the back-off.
    const backoffIdx = a.findIndex((e) => e.isBackoff);
    expect(a[backoffIdx - 1].name).toBe("Deadlift");
    expect(a[backoffIdx - 1].isWarmup).toBeFalsy();
  });

  it("without a Deadlift TM, 85 % of the Hex Bar TM stands in — flagged", () => {
    const plan = generateWeekStrengthPlan(BLOCK_CONFIGS[2], 1, new Date("2026-11-30T00:00:00.000Z"), null, null, {
      "Hex Bar Deadlift": 100,
    });
    const top = plan.sessions[0].exercises!.find((e) => e.name === "Deadlift" && !e.isWarmup && !e.isBackoff)!;
    // 82 % × (0.85 × 100) = 69.7 → 70 on 2.5-kg plates.
    expect(top.loadAbs).toBe(70);
    expect(top.notes).toContain("Kalibrierung");
  });

  it("a calibrated Deadlift TM wins over the stand-in", () => {
    const plan = generateWeekStrengthPlan(BLOCK_CONFIGS[2], 1, new Date("2026-11-30T00:00:00.000Z"), null, null, {
      "Hex Bar Deadlift": 100,
      Deadlift: 120,
    });
    const top = plan.sessions[0].exercises!.find((e) => e.name === "Deadlift" && !e.isWarmup && !e.isBackoff)!;
    expect(top.loadAbs).toBe(97.5);
    expect(top.notes ?? "").not.toContain("Kalibrierung");
  });
});
