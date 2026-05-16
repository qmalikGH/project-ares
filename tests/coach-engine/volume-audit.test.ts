// Volume Audit (Sprint v1.4) — Regression-Schutz für die Strength-Engine.
//
// Diese Tests validieren für jeden Block × Woche die erwarteten Working-Set-
// Zahlen pro Muskelgruppe. Wenn jemand Templates ändert oder die Engine-Logik
// anpasst und die Volumen-Korridore verletzt werden, schlägt die Audit-Test-
// Suite an.
//
// Klassifikation:
//   - upper_push: Bench, DB Bench, Incline DB, Push-ups
//   - upper_pull (Lat/Bizeps): Pull-ups, Chin-ups, Barbell Row, DB Row
//   - shoulders (Rear Delt/Ext.Rot.): Face Pulls, Band Pull-Aparts
//   - lower_body: HSR-Lifts + Reverse Lunge + BSS + Step-ups + Hip Thrust +
//     Single-Leg Hip Thrust + Nordic Curls + Plyo (Box Jumps, Broad Jumps,
//     Depth Drops) + Carries + Calf Raises
//   - core: Pallof Press + Dead Bug
//   - therapy: Tib Raises + Short Foot (zählt nicht in MEV-Korridore)

import { describe, it, expect } from "vitest";
import { generateWeekStrengthPlan } from "@/lib/coach-engine/strength-coach";
import { BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";
import type { BlockNumber, WeekStrengthPlan } from "@/lib/coach-engine/types";

const monday = new Date("2026-04-27T00:00:00.000Z");

const PUSH = new Set(["Bench Press", "DB Bench Press", "Incline DB Press", "Push-ups"]);
const PULL = new Set(["Pull-ups", "Chin-ups", "Barbell Row", "DB Row"]);
const SHOULDERS = new Set(["Face Pulls", "Band Pull-Aparts"]);
const CORE = new Set(["Pallof Press", "Dead Bug"]);
const THERAPY = new Set([
  "Tibialis Anterior Raises",
  "Short Foot Exercise",
]);
const CARRIES = new Set(["Farmer's Carry", "Suitcase Carry"]);

function classify(name: string): string {
  if (PUSH.has(name)) return "upper_push";
  if (PULL.has(name)) return "upper_pull";
  if (SHOULDERS.has(name)) return "shoulders";
  if (CORE.has(name)) return "core";
  if (THERAPY.has(name)) return "therapy";
  if (CARRIES.has(name)) return "carries";
  return "lower_body";
}

function countSetsByGroup(plan: WeekStrengthPlan): Record<string, number> {
  const counts: Record<string, number> = {
    upper_push: 0,
    upper_pull: 0,
    shoulders: 0,
    lower_body: 0,
    core: 0,
    therapy: 0,
    carries: 0,
  };
  for (const session of plan.sessions) {
    for (const ex of session.exercises ?? []) {
      // Skip warmup ramp-up sets — they're not working sets.
      if (ex.isWarmup) continue;
      // Skip Wall Sit (therapy-only, not part of working-set classification).
      if (ex.name === "Wall Sit") continue;
      const group = classify(ex.name);
      counts[group] += ex.sets;
    }
  }
  return counts;
}

// week 1 = Block 1 W1, week 5 = Block 2 W1, week 9 = Block 3 W1, etc.
function generateW1(blockNumber: BlockNumber): WeekStrengthPlan {
  const weekNumber = (blockNumber - 1) * 4 + 1;
  return generateWeekStrengthPlan(BLOCK_CONFIGS[blockNumber], weekNumber, monday);
}

function generateW3(blockNumber: BlockNumber): WeekStrengthPlan {
  const weekNumber = (blockNumber - 1) * 4 + 3;
  return generateWeekStrengthPlan(BLOCK_CONFIGS[blockNumber], weekNumber, monday);
}

describe("Volume audit — Block 1 + 2 (linear_progression)", () => {
  for (const blockNumber of [1, 2] as const) {
    describe(`Block ${blockNumber} W1 baseline`, () => {
      const counts = countSetsByGroup(generateW1(blockNumber));

      it("upper_push >= 6 sets", () => {
        expect(counts.upper_push).toBeGreaterThanOrEqual(6);
      });
      it("upper_pull >= 5 sets (was 0 in StrC pre-v1.4)", () => {
        expect(counts.upper_pull).toBeGreaterThanOrEqual(5);
      });
      it("shoulders >= 4 sets (was 0 across whole macrocycle pre-v1.4)", () => {
        expect(counts.shoulders).toBeGreaterThanOrEqual(4);
      });
      it("lower_body >= 13 sets", () => {
        expect(counts.lower_body).toBeGreaterThanOrEqual(13);
      });
      it("core >= 1 set", () => {
        expect(counts.core).toBeGreaterThanOrEqual(1);
      });
    });

    describe(`Block ${blockNumber} W3 peak`, () => {
      const counts = countSetsByGroup(generateW3(blockNumber));

      it("upper_push >= 7 sets (W3 +33% on accessories)", () => {
        expect(counts.upper_push).toBeGreaterThanOrEqual(7);
      });
      it("upper_pull >= 7 sets", () => {
        expect(counts.upper_pull).toBeGreaterThanOrEqual(7);
      });
      it("shoulders >= 6 sets", () => {
        expect(counts.shoulders).toBeGreaterThanOrEqual(6);
      });
    });
  }
});

describe("Volume audit — Block 3 + 4 (maintenance)", () => {
  for (const blockNumber of [3, 4] as const) {
    describe(`Block ${blockNumber} W1 baseline (×0.75 maintenance)`, () => {
      const counts = countSetsByGroup(generateW1(blockNumber));

      it("upper_push >= 4 sets", () => {
        expect(counts.upper_push).toBeGreaterThanOrEqual(4);
      });
      it("upper_pull >= 4 sets (was 0-5 pre-v1.4)", () => {
        expect(counts.upper_pull).toBeGreaterThanOrEqual(4);
      });
      it("shoulders >= 4 sets", () => {
        expect(counts.shoulders).toBeGreaterThanOrEqual(4);
      });
      it("lower_body >= 10 sets", () => {
        expect(counts.lower_body).toBeGreaterThanOrEqual(10);
      });
    });
  }
});

describe("Volume audit — Block 5 (minimal)", () => {
  const plan = generateW1(5);

  it("has 2 sessions (StrA + StrB), not 1", () => {
    expect(plan.sessions).toHaveLength(2);
  });

  const counts = countSetsByGroup(plan);

  it("upper_push >= 2 sets (was 2 pre-v1.4, no regression)", () => {
    expect(counts.upper_push).toBeGreaterThanOrEqual(2);
  });
  it("upper_pull >= 2 sets (was 0 pre-v1.4 — major fix)", () => {
    expect(counts.upper_pull).toBeGreaterThanOrEqual(2);
  });
  it("shoulders >= 2 sets (was 0 pre-v1.4 — major fix)", () => {
    expect(counts.shoulders).toBeGreaterThanOrEqual(2);
  });
  it("no muscle group has 0 working sets", () => {
    expect(counts.upper_push).toBeGreaterThan(0);
    expect(counts.upper_pull).toBeGreaterThan(0);
    expect(counts.shoulders).toBeGreaterThan(0);
    expect(counts.lower_body).toBeGreaterThan(0);
  });
});

describe("Volume audit — Structural invariants", () => {
  it("Every session in every block has >= 1 push OR >= 1 pull movement", () => {
    for (const blockNumber of [1, 2, 3, 4, 5] as const) {
      const plan = generateW1(blockNumber);
      for (const session of plan.sessions) {
        const names = (session.exercises ?? []).filter((e) => !e.isWarmup).map((e) => e.name);
        const hasPushOrPull =
          names.some((n) => PUSH.has(n)) ||
          names.some((n) => PULL.has(n)) ||
          names.some((n) => SHOULDERS.has(n));
        expect(hasPushOrPull, `Block ${blockNumber} ${session.type} missing push/pull`).toBe(true);
      }
    }
  });

  it("HSR-Lifts (Hex Bar DL, RDL) have IDENTICAL TEMPLATE parameters across Block 1-4", async () => {
    // Compare at the TEMPLATE level (pre-mode-multiplier). Live-generated
    // sets differ because maintenance/minimal modes reduce them, but the
    // template parameters (sets, loadPct, tempo, reps) must stay identical
    // per Kongsgaard 2009 tendon-loading protocol consistency.
    const { BLOCK_TEMPLATES } = await import("@/lib/coach-engine/strength-coach");

    const findHex = (blockNumber: BlockNumber, slot: "strength_a" | "strength_b" | "strength_c") =>
      BLOCK_TEMPLATES[blockNumber]?.[slot].find((e) => e.name === "Hex Bar Deadlift");
    const findRdl = (blockNumber: BlockNumber) =>
      BLOCK_TEMPLATES[blockNumber]?.strength_b.find((e) => e.name === "Romanian Deadlift");

    const b1HexA = findHex(1, "strength_a");
    const b1RdlB = findRdl(1);
    for (const b of [2, 3, 4] as const) {
      const hexA = findHex(b, "strength_a");
      expect(hexA?.sets, `Block ${b} Hex Bar StrA sets`).toBe(b1HexA?.sets);
      expect(hexA?.loadPct, `Block ${b} Hex Bar StrA loadPct`).toBe(b1HexA?.loadPct);
      expect(hexA?.tempo, `Block ${b} Hex Bar StrA tempo`).toBe(b1HexA?.tempo);
      expect(hexA?.reps, `Block ${b} Hex Bar StrA reps`).toBe(b1HexA?.reps);

      const rdl = findRdl(b);
      expect(rdl?.sets, `Block ${b} RDL sets`).toBe(b1RdlB?.sets);
      expect(rdl?.loadPct, `Block ${b} RDL loadPct`).toBe(b1RdlB?.loadPct);
      expect(rdl?.tempo, `Block ${b} RDL tempo`).toBe(b1RdlB?.tempo);
    }
  });
});
