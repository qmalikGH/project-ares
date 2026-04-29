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
  // Block 1: foundation. HSR is introduced, accessories are "classic" (bilateral,
  // bilateral-pull, basic plyo).
  1: {
    strength_a: [
      // HSR — slow tempo is the active ingredient for tendon remodeling
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180 },
      { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      { name: "Reverse Lunge", sets: 3, reps: "10/leg", loadPct: 60, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      { name: "Calf Raises", sets: 3, reps: 12, loadPct: 50, rpeCap: 7, tempo: "2-2-2", restSec: 60 },
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 }, // HSR
      { name: "Pull-ups", sets: 4, reps: 8, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      { name: "Hip Thrust", sets: 3, reps: 10, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
    ],
    strength_c: [
      { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180 }, // HSR
      { name: "DB Bench Press", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
      { name: "Broad Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 120, notes: "Plyo (knee-friendly alternative to box jumps)" },
      { name: "Farmer's Carry", sets: 3, reps: "30m", loadPct: 60, rpeCap: 6, restSec: 90 },
    ],
  },
  // Block 2: Build / Threshold-Intro (weeks 5-8). HSR-Lifts (Hex Bar, RDL)
  // identical to Block 1 — Kongsgaard 2009 tendon-protocol consistency.
  // Accessories vary systematically (Kassiano 2022): different angle, unilateral
  // vs bilateral, anti-extension instead of anti-rotation, soleus instead of
  // gastrocnemius. Volume / RPE caps the same; only the movement pool changes.
  2: {
    strength_a: [
      { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      { name: "Incline DB Press", sets: 3, reps: 8, loadPct: 70, rpeCap: 8, tempo: "2-1-1", restSec: 120 },                  // var: anderer Winkel als Bench
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 90 },        // var: lauf-spezifischer als Reverse Lunge
      { name: "Seated Calf Raises", sets: 3, reps: 15, loadPct: 45, rpeCap: 7, tempo: "2-2-2", restSec: 60 },                // var: Soleus statt Gastrocnemius
      { name: "Dead Bug", sets: 3, reps: "10/side", rpeCap: 6, tempo: "2-2-2", restSec: 60 },                                 // var: Anti-Extension statt Anti-Rotation
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                 // HSR — KONSTANT
      { name: "Barbell Row", sets: 4, reps: 8, loadPct: 65, rpeCap: 8, tempo: "2-1-1", restSec: 120 },                       // var: horizontal Pull statt vertikal (Pull-ups)
      { name: "Single-Leg Hip Thrust", sets: 3, reps: "10/leg", loadPct: 50, rpeCap: 7, tempo: "2-1-1", restSec: 90 },       // var: unilateral
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },                            // gleich: bewährt
    ],
    strength_c: [
      { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180 },                  // HSR — KONSTANT
      { name: "Push-ups", sets: 3, reps: 12, rpeCap: 7, tempo: "2-1-1", restSec: 90, notes: "Weighted vest if BW too easy" },// var: höhere Reps, BW-progression
      { name: "Box Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 120, notes: "Low box ~30cm, reactive plyo" },// var: reaktiver als Broad Jumps
      { name: "Suitcase Carry", sets: 3, reps: "30m/side", loadPct: 50, rpeCap: 6, restSec: 90 },                            // var: unilateral statt bilateral
    ],
  },
  // Block 3-5: intentionally undefined — derived during Block 2 W4 deload
  // from the user's actual training data (rolling 1RM, RPE trends, knee NRS).
};

/**
 * Look up the strength template for a (block, slot) pair. Falls back to
 * Block 1 when the block has no template defined yet — keeps the engine
 * working through Block 3-5 even before they're authored.
 */
function getStrengthTemplate(
  blockNumber: BlockNumber,
  type: StrengthSlot,
): Exercise[] {
  const block = BLOCK_TEMPLATES[blockNumber] ?? BLOCK_TEMPLATES[1]!;
  return block[type];
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
 * Apply Superset-Pairing rules in-place on a copy of `exercises`.
 *
 * Pairing strategy (per session type, only Block 2-4):
 *   strength_a: Bench Press (1) + Pallof Press (2) → group "A1"
 *               (push + anti-rotation; minimal antagonist conflict)
 *   strength_b: Pull-ups (1) + Hip Thrust (2) → group "B1"
 *               (vertical pull + posterior-chain hinge; different muscle groups)
 *   strength_c: no pair (Broad Jumps + Farmer's Carry don't antagonize cleanly)
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

  return exercises.map((ex) => {
    // HSR-Lifts NEVER paired — full rest is the active ingredient.
    if (isHsrLift(ex.name)) return { ...ex };

    if (sessionType === "strength_a") {
      if (ex.name === "Bench Press") {
        return {
          ...ex,
          supersetGroup: "A1",
          supersetOrder: 1,
          supersetRationale:
            "Push + Anti-rotation: low antagonist conflict, time-efficient.",
          restSec: SUPERSET_INTRA_REST_SEC,
        };
      }
      if (ex.name === "Pallof Press") {
        // Original Pallof restSec = 60s; full pair-rest matches the heavier
        // partner (Bench had 120s) so we don't drop recovery in the chain.
        return {
          ...ex,
          supersetGroup: "A1",
          supersetOrder: 2,
          supersetRationale:
            "Push + Anti-rotation: low antagonist conflict, time-efficient.",
          restSec: 90,
        };
      }
    }

    if (sessionType === "strength_b") {
      if (ex.name === "Pull-ups") {
        return {
          ...ex,
          supersetGroup: "B1",
          supersetOrder: 1,
          supersetRationale:
            "Pull + Hip-hinge: different muscle groups, no antagonist conflict.",
          restSec: SUPERSET_INTRA_REST_SEC,
        };
      }
      if (ex.name === "Hip Thrust") {
        return {
          ...ex,
          supersetGroup: "B1",
          supersetOrder: 2,
          supersetRationale:
            "Pull + Hip-hinge: different muscle groups, no antagonist conflict.",
          restSec: 120,
        };
      }
    }

    // strength_c → no pairs in v0.7 (no clean antagonist match).
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

    // Prepend Wall Sit when active tendon therapy — visible in plannedSessions JSON,
    // so the WeekView can show it without re-running the modulator.
    if (wallSitNeeded) {
      exercises = [{ ...WALL_SIT }, ...exercises];
    }

    return {
      date: dateAt(offsetDays),
      type,
      durationMin: phaseConfig.strengthMode === "minimal" ? 30 : 50,
      exercises,
      rpeTarget: phaseConfig.strengthRpeCap - 1,
      periodizationLabel,
      periodizationRationale: periodAdjustment.rationale,
    };
  };

  const sessions: SessionPlan[] = [];

  if (phaseConfig.strengthMode === "minimal") {
    // Minimal mode: only 1× strength per week (Wed)
    sessions.push(buildSession("strength_a", 2));
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
export { BLOCK_TEMPLATES, getStrengthTemplate };
