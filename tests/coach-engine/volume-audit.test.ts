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

// Sprint v1.7: DB Shoulder Press = vertical/overhead push → upper_push bucket.
const PUSH = new Set(["Bench Press", "DB Bench Press", "Incline DB Press", "Push-ups", "DB Shoulder Press"]);
// Sprint v1.5: Pull pool now includes Cable Row + Lat Pulldown.
const PULL = new Set(["Pull-ups", "Chin-ups", "Barbell Row", "DB Row", "Seated Cable Row", "Lat Pulldown"]);
const SHOULDERS = new Set(["Face Pulls", "Band Pull-Aparts"]);
const CORE = new Set(["Pallof Press", "Dead Bug"]);
const THERAPY = new Set([
  "Tibialis Anterior Raises",
  "Short Foot Exercise",
]);
const CARRIES = new Set(["Farmer's Carry", "Suitcase Carry"]);
// Sprint v1.5 — Quad sub-classification (squat/lunge patterns). Subset of
// lower_body. Hex Bar DL, RDL, Hip Thrust, Nordic Curls are hip/hinge/post-
// chain, NOT quad-dominant.
const QUADS = new Set([
  "Reverse Lunge",
  "Bulgarian Split Squat",
  "Goblet Squat",
  "Walking Lunge",
  "Step-ups",
  "Front Squat",
]);

function classify(name: string): string {
  if (PUSH.has(name)) return "upper_push";
  if (PULL.has(name)) return "upper_pull";
  if (SHOULDERS.has(name)) return "shoulders";
  if (CORE.has(name)) return "core";
  if (THERAPY.has(name)) return "therapy";
  if (CARRIES.has(name)) return "carries";
  return "lower_body";
}

function countQuadSets(plan: WeekStrengthPlan): number {
  let sets = 0;
  for (const session of plan.sessions) {
    for (const ex of session.exercises ?? []) {
      if (ex.isWarmup) continue;
      if (QUADS.has(ex.name)) sets += ex.sets;
    }
  }
  return sets;
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
      const plan = generateW1(blockNumber);
      const counts = countSetsByGroup(plan);
      const quads = countQuadSets(plan);

      it("upper_push >= 6 sets", () => {
        expect(counts.upper_push).toBeGreaterThanOrEqual(6);
      });
      // Sprint v1.5: Pull (Lat/Bizeps incl. Cable Row + Lat Pulldown) target 10+
      it("upper_pull >= 10 sets (Sprint v1.5 hypertrophy target)", () => {
        expect(counts.upper_pull).toBeGreaterThanOrEqual(10);
      });
      it("shoulders >= 4 sets", () => {
        expect(counts.shoulders).toBeGreaterThanOrEqual(4);
      });
      // Sprint v1.7: Quad-Cut 12→~6 (athletischer Charakter, BSS + 1 Rotation;
      // schützt das Laufen, lokale Interferenz minimiert).
      it("quads >= 6 sets (Sprint v1.7 quad cut)", () => {
        expect(quads).toBeGreaterThanOrEqual(6);
      });
      it("quads <= 8 sets (Sprint v1.7 — kein Hypertrophie-Volumen)", () => {
        expect(quads).toBeLessThanOrEqual(8);
      });
      it("lower_body >= 13 sets (HSR + Quads + Hip)", () => {
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
      const plan = generateW1(blockNumber);
      const counts = countSetsByGroup(plan);
      const quads = countQuadSets(plan);

      it("upper_push >= 4 sets", () => {
        expect(counts.upper_push).toBeGreaterThanOrEqual(4);
      });
      // Sprint v1.5: maintenance keeps Pull (Lat/Bizeps) above minimum
      it("upper_pull >= 7 sets (maintenance Sprint v1.5)", () => {
        expect(counts.upper_pull).toBeGreaterThanOrEqual(7);
      });
      it("shoulders >= 4 sets", () => {
        expect(counts.shoulders).toBeGreaterThanOrEqual(4);
      });
      it("quads >= 6 sets (after maintenance multiplier)", () => {
        expect(quads).toBeGreaterThanOrEqual(6);
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

  // Sprint v1.7 — Shoulder press is present as a real overhead-push movement.
  it("DB Shoulder Press present in Block 1 & 2 templates (~3 sets)", async () => {
    const { BLOCK_TEMPLATES } = await import("@/lib/coach-engine/strength-coach");
    for (const b of [1, 2] as const) {
      const all = [
        ...(BLOCK_TEMPLATES[b]?.strength_a ?? []),
        ...(BLOCK_TEMPLATES[b]?.strength_b ?? []),
        ...(BLOCK_TEMPLATES[b]?.strength_c ?? []),
      ];
      const press = all.find((e) => e.name === "DB Shoulder Press");
      expect(press, `Block ${b} missing DB Shoulder Press`).toBeTruthy();
      expect(press?.sets, `Block ${b} DB Shoulder Press sets`).toBe(3);
    }
  });

  // Sprint v1.7 — Plyos are the RFD component; must survive the quad cut.
  it("Plyos preserved after quad cut (Broad Jumps B1, Box Jumps B2)", async () => {
    const { BLOCK_TEMPLATES } = await import("@/lib/coach-engine/strength-coach");
    const names = (b: 1 | 2) =>
      [
        ...(BLOCK_TEMPLATES[b]?.strength_a ?? []),
        ...(BLOCK_TEMPLATES[b]?.strength_b ?? []),
        ...(BLOCK_TEMPLATES[b]?.strength_c ?? []),
      ].map((e) => e.name);
    expect(names(1)).toContain("Broad Jumps");
    expect(names(2)).toContain("Box Jumps");
  });

  // Sprint v1.7 — Accessory-RPE capped at 8 (no W3→9); main lifts may reach 9.
  const MAIN_LIFTS = new Set([
    "Bench Press", "Incline DB Press", "DB Bench Press", "Barbell Row", "Pull-ups",
  ]);
  const HSR = new Set(["Hex Bar Deadlift", "Romanian Deadlift", "RDL"]);

  it("Accessory rpeCap <= 8 in W3 (no W3→9 bump on accessories)", () => {
    for (const b of [1, 2] as const) {
      for (const session of generateW3(b).sessions) {
        for (const ex of session.exercises ?? []) {
          if (ex.isWarmup || ex.rpeCap === undefined) continue;
          if (HSR.has(ex.name) || MAIN_LIFTS.has(ex.name)) continue;
          expect(
            ex.rpeCap,
            `Block ${b} ${session.type} ${ex.name} accessory rpeCap > 8`,
          ).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it("Main lifts may reach RPE 9 in W3 (athletic heavy character preserved)", () => {
    let foundNine = false;
    for (const b of [1, 2] as const) {
      for (const ex of generateW3(b).sessions.flatMap((s) => s.exercises ?? [])) {
        if (!ex.isWarmup && MAIN_LIFTS.has(ex.name) && ex.rpeCap === 9) foundNine = true;
      }
    }
    expect(foundNine, "expected >= 1 main lift at RPE 9 in W3").toBe(true);
  });
});
