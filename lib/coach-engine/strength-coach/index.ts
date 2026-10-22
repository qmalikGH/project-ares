// StrengthCoachLogic — 2 sessions/week (A Mon, B Thu; Sprint 3.3), deadlift-
// based HSR, RPE-based load progression
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
import type { ComebackWeek } from "../comeback";
import { loadPctToKg } from "./one-rm";
import { insertWarmupSets } from "./warmup";
import { progressionModeFor } from "./progression-mode";

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
//   - HSR-Lifts (Deadlift, Romanian Deadlift) stay IDENTICAL across blocks —
//     Kongsgaard 2009 (HSR for patellar tendinopathy) shows consistent
//     slow-heavy stimulus is the active ingredient. Don't break the
//     tendon-remodeling protocol mid-macrocycle.
//   - Accessories vary systematically (Kassiano 2022, biomechanically
//     motivated): different angles, unilateral vs bilateral, anti-extension
//     vs anti-rotation, vertical vs horizontal pull, etc.
//
// Sprint 3.3 (A2/A3) — four training days: Kraft C is merged into A and B.
//   - Strength runs in the office gym, which has no hex bar: the HSR hinge is a
//     conventional barbell Deadlift (same 3-3-1 tempo, same HSR status). C's
//     hinge becomes back-off sets after A's top sets (`isBackoff`).
//   - C's plyo opens A (fresh, before lifting); C's vertical pull pairs with A's
//     press; C's horizontal press goes to B with one more set, paired with C's
//     row; C's quad work pairs with a pull in B; carries close B.
//   - Tibialis Raises, Short Foot and Single-Leg Calf Raises moved to the home
//     prevention routine (`mobility`, 3× a week).
//   - Upper body per week (W1 base): chest ≥ 8 hard sets, lateral delt ≥ 6
//     (Lateral Raises + overhead press), triceps ≥ 3 direct sets.
//   - "Nothing gets less": per block, every exercise's set sum in A+B is at
//     least its old A+B+C sum (tests/coach-engine/strength-coach/four-day-merge).
type StrengthSlot = "strength_a" | "strength_b";
/** Session types that carry strength work; strength_c stays for history only. */
type StrengthSessionType = "strength_a" | "strength_b" | "strength_c";
type BlockTemplateMap = Partial<Record<BlockNumber, Record<StrengthSlot, Exercise[]>>>;

// Sprint 3.3 (A3): new upper-body accessories, shared by the blocks.
const LATERAL_RAISES: Exercise = {
  name: "Lateral Raises", sets: 3, reps: "12-15", rpeCap: 7, tempo: "2-1-1", restSec: 60,
  notes: "Seitliche Schulter (Sprint 3.3).",
};
const TRICEPS_PUSHDOWN: Exercise = {
  name: "Cable Triceps Pushdown", sets: 3, reps: 12, rpeCap: 7, tempo: "2-1-1", restSec: 60,
  notes: "Trizeps direkt (Sprint 3.3).",
};
const DEADLIFT_TOP: Exercise = {
  name: "Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180,
  notes: "Konventionell, Langhantel (HSR, kein Superset).",
};
const DEADLIFT_BACKOFF: Exercise = {
  name: "Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180,
  isBackoff: true,
  notes: "Back-off nach den Topsätzen (vorher der Hinge aus Kraft C).",
};

const BLOCK_TEMPLATES: BlockTemplateMap = {
  // ===========================================================================
  // Block 1 — Aerobic Base. Sprint v1.5 Quad+Back supersets; Sprint 3.3 merge.
  // Accessories are paired as antagonist supersets (Paz 2017, Robbins 2010):
  // no performance loss vs straight sets, ~40% time savings. HSR compounds
  // NEVER paired (Kongsgaard 2009). supersetGroup is set directly on the
  // template; applySupersetPairing just propagates the metadata.
  // ===========================================================================
  1: {
    strength_a: [
      { name: "Broad Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 60,
        notes: "Plyo zuerst, frisch vor dem Heben. RFD-Komponente — nicht kürzen." },
      { ...DEADLIFT_TOP },
      { ...DEADLIFT_BACKOFF },
      // === SUPERSET A1: Horizontal-Push ↔ Vertical Pull ===
      { name: "Bench Press", sets: 4, reps: 8, loadPct: 75, rpeCap: 8, tempo: "2-1-1", restSec: 120,
        supersetGroup: "A1" },
      { name: "Lat Pulldown", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A1",
        notes: "Vertikal Pull. Langfrist-Transfer: Schwimmen (Ironman), Laufhaltung." },
      // === SUPERSET A2: Overhead-Push ↔ Rear Delt (Sprint v1.7) ===
      { name: "DB Shoulder Press", sets: 3, reps: 10, loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A2",
        notes: "Overhead-Push: vorderer/seitl. Delta + Schulterstabilität (athletisch, Sprint v1.7)." },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        supersetGroup: "A2",
        notes: "Schulter-Gesundheit: Posterior Delt + External Rotation." },
      // === SUPERSET A3: Quad ↔ Back ===
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A3",
        notes: "Unilateral Quad-dominant. Lauf-spezifisch (Single-Leg Stability)." },
      { name: "DB Row", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A3",
        notes: "Horizontal Pull. DL-Lockout + Laufhaltung bei Ermüdung." },
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },
      { name: "Pull-ups", sets: 4, reps: 8, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // === SUPERSET B1: Horizontal-Push ↔ Row (from Kraft C, press +1 set) ===
      { name: "DB Bench Press", sets: 4, reps: 8, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        supersetGroup: "B1" },
      { name: "DB Row", sets: 3, reps: 10, loadPct: 60, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B1" },
      // === SUPERSET B2: Glute ↔ Shoulder ↔ Lateral Delt ===
      { name: "Hip Thrust", sets: 3, reps: 10, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B2" },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        supersetGroup: "B2",
        notes: "Schulter-Gesundheit." },
      { ...LATERAL_RAISES, supersetGroup: "B2" },
      // === SUPERSET B3: Quad ↔ Back ↔ Triceps ===
      { name: "Goblet Squat", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B3",
        notes: "Front-loaded Quad. Bilateral, einfaches Pattern." },
      { name: "Seated Cable Row", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B3",
        notes: "Horizontal Pull. Rhomboids + Lats." },
      { ...TRICEPS_PUSHDOWN, supersetGroup: "B3" },
      { name: "Farmer's Carry", sets: 3, reps: "30m", loadPct: 60, rpeCap: 6, restSec: 60 },
    ],
  },
  // ===========================================================================
  // Block 2 — Build / Threshold-Intro. Kassiano-Rotation: Quad-Pool BSS →
  // Walking Lunge → Step-ups → Goblet Squat; Back-Pool DB Row → Cable Row →
  // Lat Pulldown → Chin-ups.
  // ===========================================================================
  2: {
    strength_a: [
      { name: "Box Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 60,
        notes: "Low box ~30cm, reactive plyo. Zuerst, frisch vor dem Heben. RFD-Komponente — nicht kürzen." },
      { ...DEADLIFT_TOP },
      { ...DEADLIFT_BACKOFF },
      // === SUPERSET A1: Incline Press ↔ Vertical Pull ===
      { name: "Incline DB Press", sets: 4, reps: 8, loadPct: 70, rpeCap: 8, tempo: "2-1-1", restSec: 120,
        supersetGroup: "A1" },
      { name: "Chin-ups", sets: 3, reps: 8, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A1",
        notes: "Supinated Grip — Biceps + Lat." },
      // === SUPERSET A2: Lower ↔ Shoulder ===
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A2" },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        supersetGroup: "A2",
        notes: "Schulter-Gesundheit." },
      // === SUPERSET A3: Core ↔ Overhead-Push (Sprint v1.7: DB Shoulder Press) ===
      { name: "Dead Bug", sets: 3, reps: "10/side", rpeCap: 6, tempo: "2-2-2", restSec: 60,
        supersetGroup: "A3" },
      { name: "DB Shoulder Press", sets: 3, reps: 10, loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A3",
        notes: "Overhead-Push: vorderer/seitl. Delta + Schulterstabilität (athletisch, Sprint v1.7)." },
      // === SUPERSET A4: Quad ↔ Back ===
      { name: "Walking Lunge", sets: 3, reps: "10/leg", rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A4",
        notes: "Dynamic Quad + Glute." },
      { name: "Lat Pulldown", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A4",
        notes: "Vertikal Pull." },
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },
      { name: "Barbell Row", sets: 4, reps: 8, loadPct: 65, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
      // === SUPERSET B1: Horizontal-Push ↔ Row (from Kraft C, press +1 set) ===
      { name: "Push-ups", sets: 4, reps: 12, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        supersetGroup: "B1",
        notes: "Weighted vest if BW too easy." },
      { name: "DB Row", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B1",
        notes: "Horizontal Pull." },
      // === SUPERSET B2: Glute ↔ Shoulder ↔ Horizontal Pull ===
      { name: "Single-Leg Hip Thrust", sets: 3, reps: "10/leg", loadPct: 50, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B2" },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        supersetGroup: "B2",
        notes: "Schulter-Gesundheit." },
      { name: "Seated Cable Row", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B2",
        notes: "Horizontal Pull. Rhomboids + Lats." },
      // === SUPERSET B3: Lateral Delt ↔ Triceps ===
      { ...LATERAL_RAISES, supersetGroup: "B3" },
      { ...TRICEPS_PUSHDOWN, supersetGroup: "B3" },
      { name: "Suitcase Carry", sets: 3, reps: "30m/side", loadPct: 50, rpeCap: 6, restSec: 60 },
    ],
  },
  // ===========================================================================
  // Block 3 — Transmutation / Threshold (maintenance mode: lower body ×0.75
  // sets, upper body keeps its sets — Sprint 3.3). Nordic Curls (van Dyk 2019:
  // 51% fewer hamstring injuries). Sprint 3.3: exactly the coach's worked
  // example in #21.
  // ===========================================================================
  3: {
    strength_a: [
      { name: "Box Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 60,
        notes: "Zuerst, frisch vor dem Heben." },
      { ...DEADLIFT_TOP },
      { ...DEADLIFT_BACKOFF },
      // === SUPERSET A1: Horizontal-Push ↔ Vertical Pull ===
      { name: "Bench Press", sets: 4, reps: 8, loadPct: 75, rpeCap: 8, tempo: "2-1-1", restSec: 120,
        supersetGroup: "A1" },
      { name: "Chin-ups", sets: 3, reps: 8, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A1" },
      // === SUPERSET A2: Lower ↔ Rear Delt ↔ Lateral Delt ===
      { name: "Step-ups", sets: 3, reps: "8/leg", loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A2",
        notes: "Box-Höhe knie-hoch. Lauf-spezifische Kraft (Balsalobre-Fernandez 2016)." },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        supersetGroup: "A2" },
      { ...LATERAL_RAISES, supersetGroup: "A2" },
      // === SUPERSET A3: Quad ↔ Back ===
      { name: "Goblet Squat", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A3" },
      { name: "Seated Cable Row", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A3" },
      { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },
      // === SUPERSET B1: Horizontal-Push ↔ Row (from Kraft C, press +1 set) ===
      { name: "DB Bench Press", sets: 4, reps: 8, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        supersetGroup: "B1" },
      { name: "DB Row", sets: 3, reps: 10, loadPct: 60, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B1" },
      // === SUPERSET B2: Quad ↔ Vertical Pull ===
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B2" },
      { name: "Pull-ups", sets: 4, reps: 8, rpeCap: 8, tempo: "2-1-1", restSec: 120,
        supersetGroup: "B2" },
      // === SUPERSET B3: Quad ↔ Back ↔ Triceps ===
      { name: "Walking Lunge", sets: 3, reps: "10/leg", rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B3" },
      { name: "Lat Pulldown", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B3" },
      { ...TRICEPS_PUSHDOWN, supersetGroup: "B3" },
      // === SUPERSET B4: Hamstring ↔ Rear Delt ↔ Overhead-Push ===
      { name: "Nordic Curls", sets: 3, reps: 6, rpeCap: 7, tempo: "3-1-X", restSec: 60,
        supersetGroup: "B4",
        notes: "Van Dyk 2019: 51% weniger Hamstring-Verletzungen. Exzentrisch, Partner/GHR." },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        supersetGroup: "B4" },
      { name: "DB Shoulder Press", sets: 3, reps: 10, loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B4",
        notes: "Overhead-Push: vorderer/seitl. Delta (Sprint 3.3)." },
      { name: "Farmer's Carry", sets: 3, reps: "30m", loadPct: 60, rpeCap: 6, restSec: 60 },
    ],
  },
  // ===========================================================================
  // Block 4 — Transmutation / VO2max (maintenance mode). Power/reactive
  // focus (Depth Drops). Kassiano rotation continued. Nordic Curls stay.
  // Sprint 3.3: the second vertical pull (Lat Pulldown) stays paired with the
  // quad work in B, as in its old Kraft-C superset.
  // ===========================================================================
  4: {
    strength_a: [
      { name: "Depth Drops", sets: 3, reps: 5, rpeCap: 6, tempo: "X-X-X", restSec: 60,
        notes: "Von 20-30cm Box. Reactive Strength für VO2max-Phase. Zuerst, frisch." },
      { ...DEADLIFT_TOP },
      { ...DEADLIFT_BACKOFF },
      // === SUPERSET A1: Incline Press ↔ Vertical Pull ===
      { name: "Incline DB Press", sets: 4, reps: 8, loadPct: 70, rpeCap: 8, tempo: "2-1-1", restSec: 120,
        supersetGroup: "A1" },
      { name: "Chin-ups", sets: 3, reps: 8, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A1" },
      // === SUPERSET A2: Lower ↔ Rear Delt ↔ Lateral Delt ===
      { name: "Bulgarian Split Squat", sets: 3, reps: "8/leg", loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A2" },
      { name: "Band Pull-Aparts", sets: 3, reps: 20, rpeCap: 5, restSec: 60,
        supersetGroup: "A2",
        notes: "Variation von Face Pulls — Posterior Delt + Rhomboids." },
      { ...LATERAL_RAISES, supersetGroup: "A2" },
      // === SUPERSET A3: Quad ↔ Back ===
      { name: "Step-ups", sets: 3, reps: "8/leg", rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A3" },
      { name: "DB Row", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "A3" },
      { name: "Dead Bug", sets: 3, reps: "10/side", rpeCap: 6, tempo: "2-2-2", restSec: 60 },
    ],
    strength_b: [
      { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 },
      // === SUPERSET B1: Row ↔ Horizontal-Push (from Kraft C, press +1 set) ===
      { name: "Barbell Row", sets: 4, reps: 8, loadPct: 65, rpeCap: 8, tempo: "2-1-1", restSec: 120,
        supersetGroup: "B1" },
      { name: "Push-ups", sets: 4, reps: 12, rpeCap: 7, tempo: "2-1-1", restSec: 90,
        supersetGroup: "B1",
        notes: "Weighted vest wenn BW zu leicht." },
      // === SUPERSET B2: Hamstring ↔ Rear Delt ↔ Overhead-Push ===
      { name: "Nordic Curls", sets: 3, reps: 6, rpeCap: 7, tempo: "3-1-X", restSec: 60,
        supersetGroup: "B2",
        notes: "Van Dyk 2019: 51% weniger Hamstring-Verletzungen." },
      { name: "Face Pulls", sets: 3, reps: 15, rpeCap: 6, tempo: "1-2-1", restSec: 60,
        supersetGroup: "B2" },
      { name: "DB Shoulder Press", sets: 3, reps: 10, loadPct: 55, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B2",
        notes: "Overhead-Push: vorderer/seitl. Delta (Sprint 3.3)." },
      // === SUPERSET B3: Quad ↔ Back ↔ Triceps ===
      { name: "Walking Lunge", sets: 3, reps: "10/leg", rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B3" },
      { name: "Seated Cable Row", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B3" },
      { ...TRICEPS_PUSHDOWN, supersetGroup: "B3" },
      // === SUPERSET B4: Quad ↔ Vertical Pull ===
      { name: "Goblet Squat", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B4" },
      { name: "Lat Pulldown", sets: 3, reps: 10, rpeCap: 7, tempo: "2-1-1", restSec: 60,
        supersetGroup: "B4" },
      { name: "Suitcase Carry", sets: 3, reps: "30m/side", loadPct: 50, rpeCap: 6, restSec: 60 },
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
 *
 * Sprint 3.3: there is no Kraft C any more — strength_c returns [] so callers
 * that still walk all three slots (history, TM targets) keep working.
 */
export function getStrengthTemplate(
  blockNumber: BlockNumber,
  type: StrengthSessionType,
): Exercise[] {
  if (type === "strength_c") return [];
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
// HSR-Lifts must NEVER be paired (Kongsgaard 2009): the slow-tempo Deadlift
// (Hex Bar until Sprint 3.3) and RDL produce the tendon-loading stimulus only
// with full 3-min rest. Paired with a quick antagonist, the rest collapses and the stimulus
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

// "Hex Bar Deadlift" stays for history and any hand-edited plan.
const HSR_LIFTS = new Set(["Deadlift", "Hex Bar Deadlift", "Romanian Deadlift", "RDL"]);

export function isHsrLift(name: string): boolean {
  return HSR_LIFTS.has(name);
}

/** Pause between A and B in a superset pair. Brief: 0-15s. */
const SUPERSET_INTRA_REST_SEC = 0;

/**
 * Apply Superset-Pairing rules to the exercises array.
 *
 * Sprint v1.5 — Template-driven: the template defines `supersetGroup`
 * directly on each exercise. This function:
 *   1. Strips supersetGroup from any HSR-Lift (safety net — HSR must NEVER
 *      be paired; Kongsgaard 2009 tendon-loading needs full rest).
 *   2. Assigns supersetOrder (1 = first of pair, 2 = second) by encounter
 *      order within each group.
 *   3. Sets restSec=0 on exercise1 (immediate transition) and a longer
 *      restSec on exercise2 (cycle rest) — defaults to 60s, raised to 120s
 *      for heavy compound partners.
 *
 * Block 1 + Block 5 are NOT special-cased anymore — the template decides.
 * If a template lists supersetGroups, they apply; if not, straight sets.
 *
 * Pure function — input array is not mutated; returns a new array.
 */
export function applySupersetPairing(
  exercises: Exercise[],
  // blockNumber + sessionType kept for backward compatibility with callers
  // and for future block-specific rules; currently unused since pairing is
  // template-driven.
  _blockNumber: number,
  _sessionType: StrengthSessionType,
): Exercise[] {
  // Count seen-so-far per group to assign supersetOrder.
  const seen: Record<string, number> = {};

  return exercises.map((ex) => {
    // HSR-Guard: strip supersetGroup from heavy compound lifts.
    if (isHsrLift(ex.name)) {
      const { supersetGroup: _g, supersetOrder: _o, supersetRationale: _r, ...rest } = ex;
      void _g; void _o; void _r;
      return { ...rest };
    }

    if (!ex.supersetGroup) return { ...ex };

    const group = ex.supersetGroup;
    seen[group] = (seen[group] ?? 0) + 1;
    const order = seen[group];

    // Order 1 = immediate transition, order 2+ = cycle rest.
    // For very heavy partners (loadPct >= 65%), bump cycle rest to 120s
    // so we don't burn the heavy compound by under-resting.
    const isHeavy = (ex.loadPct ?? 0) >= 65;
    const restSec = order === 1 ? SUPERSET_INTRA_REST_SEC : (isHeavy ? 120 : 60);

    return {
      ...ex,
      supersetOrder: order,
      restSec,
    };
  });
}

// ============================================
// Volume modulation by strength mode
// ============================================
/**
 * Sprint 3.3 (A3): upper-body work — chest, shoulders, triceps, pulling. In
 * `maintenance` it keeps its sets: running interferes mainly with the lower
 * body (Wilson 2012), and the athlete is building upper-body mass. Lower body,
 * hinge, plyo, carries and core still follow the mode factor; `minimal` (the
 * Block-5 taper) reduces everything.
 */
const UPPER_BODY: ReadonlySet<string> = new Set([
  "Bench Press", "DB Bench Press", "Incline DB Press", "Push-ups",
  "DB Shoulder Press", "Lateral Raises", "Cable Triceps Pushdown",
  "Face Pulls", "Band Pull-Aparts",
  "Pull-ups", "Chin-ups", "Lat Pulldown", "Seated Cable Row", "DB Row", "Barbell Row",
]);

export function isUpperBodyExercise(name: string): boolean {
  return UPPER_BODY.has(name);
}

function applyMode(
  exercises: Exercise[],
  mode: PhaseConfig["strengthMode"],
  rpeCap: 7 | 8 | 9,
): Exercise[] {
  const setMultiplier = mode === "minimal" ? 0.5 : mode === "maintenance" ? 0.75 : 1;

  return exercises.map((ex) => {
    const factor = mode === "maintenance" && UPPER_BODY.has(ex.name) ? 1 : setMultiplier;
    const newSets = Math.max(2, Math.round(ex.sets * factor));
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

/**
 * Sprint 3.3 (A2): until the athlete calibrates a Deadlift TM, 85 % of the Hex
 * Bar TM stands in — conservative, a conventional deadlift usually moves less
 * than a hex bar. Returns the map to load from and whether the stand-in is used.
 */
export const DEADLIFT_PLACEHOLDER_SHARE = 0.85;
export const DEADLIFT_CALIBRATION_HINT =
  "Kalibrierung: in 5er-Sätzen bis RPE 7 steigern, TM ≈ Last ÷ 0,79 in den Settings eintragen.";

export function withDeadliftPlaceholder(
  maxEstimates: Record<string, number> | null | undefined,
): { estimates: Record<string, number> | null; placeholder: boolean } {
  if (!maxEstimates) return { estimates: null, placeholder: false };
  const own = maxEstimates["Deadlift"];
  if (typeof own === "number" && own > 0) return { estimates: maxEstimates, placeholder: false };
  const hex = maxEstimates["Hex Bar Deadlift"];
  if (typeof hex !== "number" || hex <= 0) return { estimates: maxEstimates, placeholder: false };
  return {
    estimates: { ...maxEstimates, Deadlift: Math.round(hex * DEADLIFT_PLACEHOLDER_SHARE * 10) / 10 },
    placeholder: true,
  };
}

// ============================================
// Week strength plan
// ============================================
/**
 * Generate week's strength plan: A (Mon), B (Thu). Sprint 3.3: no Kraft C.
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
  /** Sprint v1.5 — load-override-week from the WeeklyPlan row. Passed
   *  through to computePeriodizationAdjustment. null = no override. */
  loadOverrideWeek: 1 | 2 | 3 | 4 | null = null,
  /** Sprint 2.4 — return-to-training week (1-3) after a layoff ≥ 21 days.
   *  Scales load + week-1 sets down. null = no ramp. */
  comebackWeek: ComebackWeek | null = null,
): WeekStrengthPlan {
  const dateAt = (offsetDays: number): Date =>
    new Date(weekStartDate.getTime() + offsetDays * 86400000);

  const wallSitNeeded = therapyPhase === "REACTIVE" || therapyPhase === "DISREPAIR";

  // Sprint v0.10: derive week-in-block (1-4) from absolute weekNumber. Drives
  // the 3:1 loading-to-deload pattern in computePeriodizationAdjustment.
  const weekInBlock = weekInBlockOf(weekNumber, phaseConfig.durationWeeks);
  const periodizationLabel = getPeriodizationLabel(weekInBlock);

  const buildSession = (
    type: StrengthSlot,
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
      prevShinPainNrs: prevSession?.shinPainNrs ?? null,
      prevRpeReported: prevSession?.rpeReported ?? null,
      baselineRpeCap: phaseConfig.strengthRpeCap,
      strengthMode: phaseConfig.strengthMode,
      loadOverrideWeek,
      comebackWeek,
    });
    // Sprint v1.7: pass block baseline RPE-cap so accessories don't get the W3→9 bump.
    exercises = applyPeriodization(exercises, periodAdjustment, phaseConfig.strengthRpeCap);

    // Sprint v0.7: layer Superset-Pairing for Block 2-4 (HSR-protected).
    // Runs AFTER periodization so the periodization-adjusted loads/sets are
    // what get paired up.
    exercises = applySupersetPairing(exercises, phaseConfig.blockNumber, type);

    // Sprint v0.11: fill absolute kg loads from user's 1RM estimates AFTER
    // all percentage-based adjustments. snapped to 2.5kg plates. Pass-through
    // when no 1RM data is available (UI falls back to percent-only).
    // Sprint 3.3: Deadlift falls back to 85 % of the Hex Bar TM, flagged.
    const { estimates, placeholder } = withDeadliftPlaceholder(userMaxEstimates);
    exercises = fillAbsoluteLoads(exercises, estimates);
    if (placeholder) {
      exercises = exercises.map((e) =>
        e.name === "Deadlift" && !e.isBackoff
          ? { ...e, notes: `TM-Platzhalter (85 % Hex Bar). ${DEADLIFT_CALIBRATION_HINT}` }
          : e,
      );
    }

    // Sprint v0.13: insert warmup ramp-up sets for compound lifts (loadPct >= 60%).
    // Runs AFTER periodization + superset-pairing + absolute-load-fill so that
    // the warmup percentages are relative to the periodized working load.
    // See science_doc Viveiros 2024, Ribeiro 2020, Morrison 2022, Kraemer 2024.
    exercises = insertWarmupSets(exercises, estimates);

    // Prepend Wall Sit when active tendon therapy — visible in plannedSessions JSON,
    // so the WeekView can show it without re-running the modulator.
    if (wallSitNeeded) {
      exercises = [{ ...WALL_SIT }, ...exercises];
    }

    // Sprint 2.1: stamp progressionMode so UI + engine share one source of
    // truth (TM compounds vs rep/RPE accessories vs none).
    exercises = exercises.map((e) => ({
      ...e,
      progressionMode: progressionModeFor(e.name),
    }));

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

  // Sprint 3.3 (A1): two strength days in every mode — Mon A, Thu B, the
  // office days. Kraft C is merged into A and B (see BLOCK_TEMPLATES); the
  // `minimal` mode still reduces sets, not sessions (Sprint v1.4: without B,
  // upper pull drops to 0 in the peak phase — Ogasawara 2013).
  const sessions: SessionPlan[] = [buildSession("strength_a", 0), buildSession("strength_b", 3)];

  return {
    weekNumber,
    blockNumber: phaseConfig.blockNumber,
    sessions,
  };
}

// Re-export for SessionModulator + tests. Block 1 is exposed as the legacy
// `strength_a/b` shape so existing imports keep working — Block 2+ should
// use `getStrengthTemplate(blockNumber, slot)` instead.
export const STRENGTH_TEMPLATES_PUBLIC = {
  strength_a: BLOCK_TEMPLATES[1]!.strength_a,
  strength_b: BLOCK_TEMPLATES[1]!.strength_b,
} as const;
export { BLOCK_TEMPLATES };
