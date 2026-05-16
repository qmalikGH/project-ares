// StrengthCoachLogic — 3 sessions/week, hex-bar focused, RPE-based load progression
// See science_doc.md Kap 4.5 (Hybrid Strength) & spec 6.3.
// Pure functions.

import type {
  BlockNumber,
  Exercise,
  PhaseConfig,
  SessionPlan,
  TherapyPhase,
  WeekStrengthData,
  WeekStrengthPlan,
} from "../types";
import {
  applyPeriodization,
  computePeriodizationAdjustment,
  getPeriodizationLabel,
  weekInBlockOf,
} from "./periodization";
import { loadPctToKg } from "./one-rm";
import { insertWarmupSets } from "./warmup";

// ============================================
// Templates
// ============================================
//
// Tempo + rest values per science_doc.md:
//   - Kap 8.4 (HSR): slow 3-3-1 tempo with 3min rest is the validated stimulus
//     for patellar tendinopathy reconditioning (Kongsgaard 2009)
//   - Kap 4.5 (Hybrid pauses): 90-180s for compound lifts to keep RPE accurate
//     without crushing same-day cardio capacity

export const WALL_SIT: Exercise = {
  name: "Wall Sit",
  sets: 5,
  reps: "45sec",
  rpeCap: 6,
  tempo: "iso",
  restSec: 30,
  notes: "Pre-workout (Sehnen-Therapie, Phase REACTIVE/DISREPAIR)",
};

// ============================================
// BLOCK_TEMPLATES (Sprint v0.11)
// ============================================
//
// Block-specific exercise templates — replaces v0.10's `STRENGTH_*_BASE` flat
// constants. Engine looks up `BLOCK_TEMPLATES[phaseConfig.blockNumber]` and
// falls back to Block-1 if a block has no template defined yet.
//
// Variation strategy:
//   - HSR-Lifts (Hex Bar Deadlift, Romanian Deadlift) stay IDENTICAL across
//     blocks — Kongsgaard 2009 (HSR for patellar tendinopathy) shows
//     consistent slow-heavy stimulus is the active ingredient. Don't break
//     the tendon-remodeling protocol mid-macrocycle.
//   - Accessories vary systematically (Kassiano 2022, biomechanically
//     motivated): different angles, unilateral vs bilateral, anti-extension
//     vs anti-rotation, vertical vs horizontal pull, etc.
//
// Block 3-5 are intentionally undefined — they will be derived from the
// actual training data accumulated during Block 1+2 (rolling 1RM, RPE
// trends, knee-pain NRS) at the W4 deload of Block 2.
type StrengthSlot = "strength_a" | "strength_b" | "strength_c";
type BlockTemplateMap = Partial<Record<BlockNumber, Record<StrengthSlot, Exercise[]>>>;

const BLOCK_TEMPLATES: BlockTemplateMap = {
  // Block 1: foundation. HSR introduced, accessories "classic". Sprint v1.4
  // adds Face Pulls (shoulder health + horizontal pull) in StrA + StrB and
  // DB Row in StrC so no session has 0 pull volume.
  1: {
    strength_a: [
      // HSR — slow tempo for tendon remodeling (Kongsgaard 2009)
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180 },
      // Push
      { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // Lower accessory
      { name: "Reverse Lunge", sets: 3, reps: "10/leg", loadPct: 60, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      // Pull / Shoulder — Sprint v1.4: balances Bench, posterior delt + ext rotation
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        notes: "Schulter-Gesundheit: Posterior Delt + External Rotation. Cable oder Band." },
      // Therapy
      { name: "Tibialis Anterior Raises", sets: 3, reps: 15, rpeCap: 6, tempo: "2-1-2", restSec: 60,
        notes: "Shin-Splint-Prävention (Marques 2025). Ferse auf Stufe, Fußspitze heben." },
      // Core
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
    ],
    strength_b: [
      // HSR
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },
      // Pull (vertical)
      { name: "Pull-ups", sets: 4, reps: 8, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // Lower accessory
      { name: "Hip Thrust", sets: 3, reps: 10, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      // Shoulder — Sprint v1.4
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        notes: "Schulter-Gesundheit." },
      // Therapy
      { name: "Short Foot Exercise", sets: 2, reps: "30sec hold", rpeCap: 5, restSec: 30,
        notes: "Intrinsic foot muscles (Newsham 2023: 93% weniger Rezidive). Fußgewölbe aktiv anheben, barfuß." },
    ],
    strength_c: [
      // HSR
      { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180 },
      // Push
      { name: "DB Bench Press", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      // Pull (horizontal) — Sprint v1.4: balances DB Bench Press, StrC had 0 pull before
      { name: "DB Row", sets: 3, reps: 10, loadPct: 60, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        notes: "Horizontal Pull — gleicht DB Bench Press aus." },
      // Plyo
      { name: "Broad Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 120,
        notes: "Plyo (knee-friendly alternative to box jumps)" },
      // Therapy
      { name: "Single-Leg Calf Raises", sets: 3, reps: "12/leg", rpeCap: 7, tempo: "2-2-2", restSec: 60,
        notes: "Auf Stufe, volle ROM. Soleus-fokussiert für Lauf-Stoßdämpfung." },
      // Carry
      { name: "Farmer's Carry", sets: 3, reps: "30m", loadPct: 60, rpeCap: 6, restSec: 90 },
    ],
  },
  // Block 2: Build / Threshold-Intro. Same template structure, systematic
  // variation (Kassiano 2022): different angles, unilateral, anti-extension.
  // Sprint v1.4: Face Pulls in StrA+StrB, Chin-ups in StrC.
  2: {
    strength_a: [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      { name: "Incline DB Press", sets: 3, reps: 8, loadPct: 70, rpeCap: 8, tempo: "2-1-1", restSec: 120 },                  // var: anderer Winkel
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 90 },        // var: unilateral
      // Shoulder — Sprint v1.4
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        notes: "Schulter-Gesundheit." },
      { name: "Tibialis Anterior Raises", sets: 3, reps: 15, rpeCap: 6, tempo: "2-1-2", restSec: 60,
        notes: "Shin-Splint-Prävention (Marques 2025)." },
      { name: "Dead Bug", sets: 3, reps: "10/side", rpeCap: 6, tempo: "2-2-2", restSec: 60 },                                 // var: Anti-Extension
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                 // HSR — KONSTANT
      { name: "Barbell Row", sets: 4, reps: 8, loadPct: 65, rpeCap: 8, tempo: "2-1-1", restSec: 120 },                       // var: horizontal
      { name: "Single-Leg Hip Thrust", sets: 3, reps: "10/leg", loadPct: 50, rpeCap: 7, tempo: "2-1-1", restSec: 90 },       // var: unilateral
      // Shoulder — Sprint v1.4
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        notes: "Schulter-Gesundheit." },
      { name: "Short Foot Exercise", sets: 2, reps: "30sec hold", rpeCap: 5, restSec: 30,
        notes: "Intrinsic foot muscles (Newsham 2023)." },
    ],
    strength_c: [
      { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      { name: "Push-ups", sets: 3, reps: 12, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        notes: "Weighted vest if BW too easy" },
      // Pull — Sprint v1.4: Chin-ups (supinated grip, biceps + lat). Variation: vertical pull complements StrB Barbell Row (horizontal).
      { name: "Chin-ups", sets: 3, reps: 8, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        notes: "Supinated Grip — Biceps + Lat. Variation zu Barbell Row (StrB)." },
      { name: "Box Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 120,
        notes: "Low box ~30cm, reactive plyo" },
      { name: "Single-Leg Calf Raises", sets: 3, reps: "12/leg", rpeCap: 7, tempo: "2-2-2", restSec: 60,
        notes: "Soleus-fokussiert." },
      { name: "Suitcase Carry", sets: 3, reps: "30m/side", loadPct: 50, rpeCap: 6, restSec: 90 },                            // var: unilateral
    ],
  },
  // Block 3: Transmutation / Threshold. Run volume rises (Long Run 75min) —
  // strength shifts to run-specific (unilateral) + hamstring resilience
  // (Nordic Curls, van Dyk 2019: 51% reduction in hamstring injuries).
  3: {
    strength_a: [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      // Push — back to Bench (rotation from Block 2 Incline DB)
      { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // Lower — Step-ups (run-specific, unilateral)
      { name: "Step-ups", sets: 3, reps: "8/leg", loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        notes: "Box-Höhe knie-hoch. Lauf-spezifische unilaterale Kraft (Balsalobre-Fernandez 2016)." },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        notes: "Schulter-Gesundheit." },
      { name: "Tibialis Anterior Raises", sets: 3, reps: 15, rpeCap: 6, tempo: "2-1-2", restSec: 60,
        notes: "Shin-Splint-Prävention (Marques 2025)." },
      // Core — back to Anti-Rotation (rotation from Block 2 Dead Bug)
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                 // HSR — KONSTANT
      // Pull — back to vertical (rotation from Block 2 Barbell Row)
      { name: "Pull-ups", sets: 4, reps: 8, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // Hamstring resilience — Sprint v1.4: Nordic Curls (van Dyk 2019)
      { name: "Nordic Curls", sets: 3, reps: 6, rpeCap: 7, tempo: "3-1-X", restSec: 120,
        notes: "Exzentrisch betont. Partner oder GHR-Bank. Van Dyk 2019: 51% weniger Hamstring-Verletzungen." },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        notes: "Schulter-Gesundheit." },
      { name: "Short Foot Exercise", sets: 2, reps: "30sec hold", rpeCap: 5, restSec: 30,
        notes: "Intrinsic foot muscles (Newsham 2023)." },
    ],
    strength_c: [
      { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      // Push — DB Bench (rotation)
      { name: "DB Bench Press", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      // Pull — DB Row (horizontal; StrB has vertical Pull-ups)
      { name: "DB Row", sets: 3, reps: 10, loadPct: 60, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      // Plyo — Box Jumps for reactive strength
      { name: "Box Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 120 },
      { name: "Single-Leg Calf Raises", sets: 3, reps: "12/leg", rpeCap: 7, tempo: "2-2-2", restSec: 60 },
      // Carry — back to bilateral (rotation)
      { name: "Farmer's Carry", sets: 3, reps: "30m", loadPct: 60, rpeCap: 6, restSec: 90 },
    ],
  },
  // Block 4: Transmutation / VO2max. Same maintenance mode as Block 3 but
  // run focus shifts to Z3 (VO2max). Strength varies (Kassiano 2022) and
  // emphasizes power/reactive (Depth Drops). Hamstring work continues
  // (high run volume).
  4: {
    strength_a: [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      // Push — Incline DB (rotation from Block 3 Flat Bench)
      { name: "Incline DB Press", sets: 3, reps: 8, loadPct: 70, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // Lower — BSS (rotation from Block 3 Step-ups)
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      // Shoulder — Band Pull-Aparts (rotation from Face Pulls)
      { name: "Band Pull-Aparts", sets: 3, reps: 20, rpeCap: 5, restSec: 45,
        notes: "Variation von Face Pulls — Posterior Delt + Rhomboids." },
      { name: "Tibialis Anterior Raises", sets: 3, reps: 15, rpeCap: 6, tempo: "2-1-2", restSec: 60,
        notes: "Shin-Splint-Prävention (Marques 2025)." },
      // Core — Dead Bug (rotation from Block 3 Pallof)
      { name: "Dead Bug", sets: 3, reps: "10/side", rpeCap: 6, tempo: "2-2-2", restSec: 60 },
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                 // HSR — KONSTANT
      // Pull — Barbell Row (rotation from Block 3 Pull-ups)
      { name: "Barbell Row", sets: 4, reps: 8, loadPct: 65, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // Hamstring — Nordic Curls stay (proven, high run volume)
      { name: "Nordic Curls", sets: 3, reps: 6, rpeCap: 7, tempo: "3-1-X", restSec: 120,
        notes: "Van Dyk 2019: 51% weniger Hamstring-Verletzungen." },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        notes: "Schulter-Gesundheit." },
      { name: "Short Foot Exercise", sets: 2, reps: "30sec hold", rpeCap: 5, restSec: 30,
        notes: "Intrinsic foot muscles (Newsham 2023)." },
    ],
    strength_c: [
      { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      // Push — Push-ups (rotation)
      { name: "Push-ups", sets: 3, reps: 12, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        notes: "Weighted vest wenn BW zu leicht." },
      // Pull — Chin-ups (rotation from Block 3 DB Row → vertical)
      { name: "Chin-ups", sets: 3, reps: 8, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      // Plyo — Depth Drops (power for VO2max phase)
      { name: "Depth Drops", sets: 3, reps: 5, rpeCap: 6, tempo: "X-X-X", restSec: 120,
        notes: "Von 20-30cm Box fallen lassen, sofort springen. Reactive Strength Index." },
      { name: "Single-Leg Calf Raises", sets: 3, reps: "12/leg", rpeCap: 7, tempo: "2-2-2", restSec: 60 },
      // Carry — Suitcase (rotation)
      { name: "Suitcase Carry", sets: 3, reps: "30m/side", loadPct: 50, rpeCap: 6, restSec: 90 },
    ],
  },
  // Block 5: intentionally undefined — falls through to Block 4 via the
  // Sprint v1.4 walk-down fallback chain. With strengthMode "minimal" and
  // 2 sessions (StrA+StrB), gives the peaking phase a sane volume floor
  // while preserving exercise variation.
};

/**
 * Look up the strength template for a (block, slot) pair. Walks DOWNWARD
 * to the nearest defined block — e.g. Block 5 falls back to Block 4 (which
 * preserves the latest exercise variation set), not Block 1. Block 1 is
 * always defined and acts as the ultimate fallback.
 *
 * Sprint v1.4: previously fell back to Block 1 unconditionally, which made
 * Block 5 lose all the systematic variation from Block 2-4.
 */
export function getStrengthTemplate(
  blockNumber: BlockNumber,
  type: StrengthSlot,
): Exercise[] {
  // Walk downward to find the nearest defined block
  for (let b = blockNumber; b >= 1; b--) {
    const block = BLOCK_TEMPLATES[b as BlockNumber];
    if (block) return block[type];
  }
  // Unreachable in practice — Block 1 is always defined.
  return BLOCK_TEMPLATES[1]![type];
}

// ============================================
// RPE-based load adjustment
// ============================================
/**
 * Adjust load for next session based on previous session's RPE vs cap.
 * From spec 6.3.
 */
export function adjustLoadForRPE(prevRpe: number, rpeCap: number, currentLoad: number): number {
  if (currentLoad <= 0) return currentLoad;
  if (prevRpe < rpeCap - 1) return Math.round(currentLoad * 1.025 * 10) / 10; // +2.5%
  if (prevRpe < rpeCap) return Math.round(currentLoad * 1.01 * 10) / 10; // +1%
  if (prevRpe > rpeCap + 1) return Math.round(currentLoad * 0.95 * 10) / 10; // -5%
  return currentLoad;
}

// ============================================
// Superset pairing (Sprint v0.7)
// ============================================
//
// HSR-Lifts must NEVER be paired (Kongsgaard 2009): the slow-tempo Hex Bar
// Deadlift and RDL produce the tendon-loading stimulus only with full 3-min
// rest. Paired with a quick antagonist, the rest collapses and the stimulus
// is lost.
//
// Other compound + accessory pairs ARE eligible for antagonist supersets per
// Zhang 2025 (no hypertrophy loss on antagonist pairs at matched volume) and
// Iversen 2024 (small max-strength reduction on agonist pairs only).
//
// Block schedule (sprint_v0.7_prompt.md):
//   - Block 1 (Aerobic Base + Tendon-Therapy): pure Straight Sets
//   - Block 2-4 (Build/Specific): accessory antagonist pairs allowed
//   - Block 5 (Peaking): pure Straight Sets again

const HSR_LIFTS = new Set(["Hex Bar Deadlift", "Romanian Deadlift", "RDL"]);

export function isHsrLift(name: string): boolean {
  return HSR_LIFTS.has(name);
}

/** Pause between A and B in a superset pair. Brief: 0-15s. */
const SUPERSET_INTRA_REST_SEC = 0;

/**
 * Pairing-Rule für ein Block × Session-Pair. Sprint v1.4 — table-driven
 * replaces the hardcoded if/else chain that only handled Block 2-4 partially.
 *
 * `exercise1` runs first with restSec=0 (immediate transition). `exercise2`
 * runs with the partnerRestSec (matches the heavier partner so we don't
 * drop recovery in the chain).
 */
type PairingRule = {
  exercise1: string;
  exercise2: string;
  group: string;
  rationale: string;
  /** Rest after exercise2 finishes the pair (cycle rest). Defaults to 90s. */
  partnerRestSec?: number;
};

const PAIRING_RULES: Record<number, Partial<Record<StrengthSlot, PairingRule[]>>> = {
  2: {
    strength_a: [
      { exercise1: "Incline DB Press", exercise2: "Face Pulls", group: "A1",
        rationale: "Push + Rear Pull: low antagonist conflict, time-efficient." },
    ],
    strength_b: [
      { exercise1: "Barbell Row", exercise2: "Single-Leg Hip Thrust", group: "B1",
        rationale: "Pull + Hip-hinge: different muscle groups, no antagonist conflict.",
        partnerRestSec: 120 },
    ],
    strength_c: [], // Push-ups + Chin-ups remain Straight Sets in Block 2
  },
  3: {
    strength_a: [
      { exercise1: "Bench Press", exercise2: "Face Pulls", group: "A1",
        rationale: "Push + Rear Pull: low antagonist conflict, time-efficient." },
    ],
    strength_b: [
      { exercise1: "Pull-ups", exercise2: "Nordic Curls", group: "B1",
        rationale: "Pull + Knee-flexion: different muscle patterns.",
        partnerRestSec: 120 },
    ],
    strength_c: [
      { exercise1: "DB Bench Press", exercise2: "DB Row", group: "C1",
        rationale: "Classic antagonist pair: Push + Pull, balanced fatigue." },
    ],
  },
  4: {
    strength_a: [
      { exercise1: "Incline DB Press", exercise2: "Band Pull-Aparts", group: "A1",
        rationale: "Push + Rear Pull: low fatigue interaction." },
    ],
    strength_b: [
      { exercise1: "Barbell Row", exercise2: "Nordic Curls", group: "B1",
        rationale: "Pull + Knee-flexion: different patterns.",
        partnerRestSec: 120 },
    ],
    strength_c: [
      { exercise1: "Push-ups", exercise2: "Chin-ups", group: "C1",
        rationale: "BW Push + BW Pull: low fatigue interaction, time-efficient." },
    ],
  },
};

/**
 * Apply Superset-Pairing rules in-place on a copy of `exercises`.
 *
 * Block 1 + Block 5 → pure Straight Sets (no pairs). HSR-Lifts NEVER paired
 * (Kongsgaard 2009: full rest is the tendon-loading stimulus).
 *
 * Pure function — input array is not mutated; returns a new array.
 */
export function applySupersetPairing(
  exercises: Exercise[],
  blockNumber: number,
  sessionType: "strength_a" | "strength_b" | "strength_c",
): Exercise[] {
  // Block 1 + Block 5 → pure Straight Sets, no modification.
  if (blockNumber === 1 || blockNumber === 5) {
    return exercises.map((ex) => ({ ...ex }));
  }

  const rules = PAIRING_RULES[blockNumber]?.[sessionType] ?? [];
  if (rules.length === 0) return exercises.map((ex) => ({ ...ex }));

  return exercises.map((ex) => {
    // HSR-Lifts NEVER paired — full rest is the active ingredient.
    if (isHsrLift(ex.name)) return { ...ex };

    for (const rule of rules) {
      if (ex.name === rule.exercise1) {
        return {
          ...ex,
          supersetGroup: rule.group,
          supersetOrder: 1,
          supersetRationale: rule.rationale,
          restSec: SUPERSET_INTRA_REST_SEC,
        };
      }
      if (ex.name === rule.exercise2) {
        return {
          ...ex,
          supersetGroup: rule.group,
          supersetOrder: 2,
          supersetRationale: rule.rationale,
          restSec: rule.partnerRestSec ?? 90,
        };
      }
    }
    return { ...ex };
  });
}

// ============================================
// Volume modulation by strength mode
// ============================================
function applyMode(
  exercises: Exercise[],
  mode: PhaseConfig["strengthMode"],
  rpeCap: 7 | 8 | 9,
): Exercise[] {
  const setMultiplier = mode === "minimal" ? 0.5 : mode === "maintenance" ? 0.75 : 1;

  return exercises.map((ex) => {
    const newSets = Math.max(2, Math.round(ex.sets * setMultiplier));
    const newRpeCap = Math.min(ex.rpeCap ?? rpeCap, rpeCap);
    return { ...ex, sets: newSets, rpeCap: newRpeCap };
  });
}

// ============================================
// Absolute load fill (Sprint v0.11)
// ============================================
/**
 * Fill `loadAbs` (kg) on every exercise with a `loadPct` AND a known 1RM.
 * Snaps to 2.5 kg plate increments via `loadPctToKg`.
 *
 * Pure: returns a new array, never mutates inputs. Exercises without a
 * matching 1RM entry pass through unchanged — the UI falls back to the
 * percentage-only display.
 */
export function fillAbsoluteLoads(
  exercises: Exercise[],
  maxEstimates: Record<string, number> | null | undefined,
): Exercise[] {
  if (!maxEstimates) return exercises;
  return exercises.map((ex) => {
    if (ex.loadPct === undefined) return ex;
    const oneRM = maxEstimates[ex.name];
    if (typeof oneRM !== "number" || oneRM <= 0) return ex;
    return { ...ex, loadAbs: loadPctToKg(oneRM, ex.loadPct) };
  });
}

// ============================================
// Week strength plan
// ============================================
/**
 * Generate week's strength plan: A (Mon), B (Wed), C (Fri).
 * `weekStartDate` = Monday of the week (Date with 0:00 time).
 * `therapyPhase` controls whether Wall Sit is prepended to each strength
 * session as the active tendon-therapy stimulus (REACTIVE / DISREPAIR).
 *
 * `userMaxEstimates` (Sprint v0.11) — JSON map { exerciseName: kg } from
 * UserSettings.exerciseMaxEstimates. When provided, every exercise with
 * a `loadPct` gets `loadAbs` filled (snapped to 2.5kg plates). When null,
 * the UI keeps showing percent-only — backwards compatible.
 *
 * Note: SessionModulator also prepends Wall Sit defensively at modulation
 * time, so adding it here is idempotent — `hasWallSit` checks dedupe.
 */
export function generateWeekStrengthPlan(
  phaseConfig: PhaseConfig,
  weekNumber: number,
  weekStartDate: Date,
  prevWeekData: WeekStrengthData | null = null,
  therapyPhase: TherapyPhase | null = null,
  userMaxEstimates: Record<string, number> | null = null,
): WeekStrengthPlan {
  const dateAt = (offsetDays: number): Date =>
    new Date(weekStartDate.getTime() + offsetDays * 86400000);

  const wallSitNeeded = therapyPhase === "REACTIVE" || therapyPhase === "DISREPAIR";

  // Sprint v0.10: derive week-in-block (1-4) from absolute weekNumber. Drives
  // the 3:1 loading-to-deload pattern in computePeriodizationAdjustment.
  const weekInBlock = weekInBlockOf(weekNumber, phaseConfig.durationWeeks);
  const periodizationLabel = getPeriodizationLabel(weekInBlock);

  const buildSession = (
    type: "strength_a" | "strength_b" | "strength_c",
    offsetDays: number,
  ): SessionPlan => {
    let exercises = getStrengthTemplate(phaseConfig.blockNumber, type).map((e) => ({ ...e }));
    exercises = applyMode(exercises, phaseConfig.strengthMode, phaseConfig.strengthRpeCap);

    // Sprint v0.10: replace the legacy RPE-only adjustment with the full
    // periodization pipeline (week-pattern + RPE-feedback + pain-override).
    // The legacy adjustLoadForRPE stays exported for any caller still using
    // it directly; here we go through the new module.
    const prevSession = prevWeekData?.sessions.find((s) => s.type === type);
    const periodAdjustment = computePeriodizationAdjustment({
      weekInBlock,
      blockNumber: phaseConfig.blockNumber,
      prevPainNrs: prevSession?.kneePainNrs ?? null,
      prevRpeReported: prevSession?.rpeReported ?? null,
      baselineRpeCap: phaseConfig.strengthRpeCap,
      strengthMode: phaseConfig.strengthMode,
    });
    exercises = applyPeriodization(exercises, periodAdjustment);

    // Sprint v0.7: layer Superset-Pairing for Block 2-4 (HSR-protected).
    // Runs AFTER periodization so the periodization-adjusted loads/sets are
    // what get paired up.
    exercises = applySupersetPairing(exercises, phaseConfig.blockNumber, type);

    // Sprint v0.11: fill absolute kg loads from user's 1RM estimates AFTER
    // all percentage-based adjustments. snapped to 2.5kg plates. Pass-through
    // when no 1RM data is available (UI falls back to percent-only).
    exercises = fillAbsoluteLoads(exercises, userMaxEstimates);

    // Sprint v0.13: insert warmup ramp-up sets for compound lifts (loadPct >= 60%).
    // Runs AFTER periodization + superset-pairing + absolute-load-fill so that
    // the warmup percentages are relative to the periodized working load.
    // See science_doc Viveiros 2024, Ribeiro 2020, Morrison 2022, Kraemer 2024.
    exercises = insertWarmupSets(exercises, userMaxEstimates);

    // Prepend Wall Sit when active tendon therapy — visible in plannedSessions JSON,
    // so the WeekView can show it without re-running the modulator.
    if (wallSitNeeded) {
      exercises = [{ ...WALL_SIT }, ...exercises];
    }

    // Sprint v0.13: account for warmup time in session duration (~1.5 min per set).
    const warmupCount = exercises.filter((e) => e.isWarmup).length;
    const warmupTimeMin = Math.ceil(warmupCount * 1.5);
    const baseDuration = phaseConfig.strengthMode === "minimal" ? 30 : 50;

    return {
      date: dateAt(offsetDays),
      type,
      durationMin: baseDuration + warmupTimeMin,
      exercises,
      rpeTarget: phaseConfig.strengthRpeCap - 1,
      periodizationLabel,
      periodizationRationale: periodAdjustment.rationale,
    };
  };

  const sessions: SessionPlan[] = [];

  if (phaseConfig.strengthMode === "minimal") {
    // Minimal mode: 2× strength per week (Mon StrA + Thu StrB).
    // Sprint v1.4: was 1 session — but without StrB, Upper Pull volume drops
    // to 0 across the entire peaking phase (functional detraining,
    // Ogasawara 2013: strength loss after 3wk inactivity for a muscle group).
    sessions.push(buildSession("strength_a", 0));
    sessions.push(buildSession("strength_b", 3));
  } else {
    // Standard 3-day split: Mon A, Wed B, Fri C
    sessions.push(buildSession("strength_a", 0));
    sessions.push(buildSession("strength_b", 2));
    sessions.push(buildSession("strength_c", 4));
  }

  return {
    weekNumber,
    blockNumber: phaseConfig.blockNumber,
    sessions,
  };
}

// Re-export for SessionModulator + tests. Block 1 is exposed as the legacy
// `strength_a/b/c` shape so existing imports keep working — Block 2+ should
// use `getStrengthTemplate(blockNumber, slot)` instead.
export const STRENGTH_TEMPLATES_PUBLIC = {
  strength_a: BLOCK_TEMPLATES[1]!.strength_a,
  strength_b: BLOCK_TEMPLATES[1]!.strength_b,
  strength_c: BLOCK_TEMPLATES[1]!.strength_c,
} as const;
export { BLOCK_TEMPLATES };
