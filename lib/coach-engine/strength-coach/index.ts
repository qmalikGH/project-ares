// StrengthCoachLogic — 3 sessions/week, hex-bar focused, RPE-based load progression
// See science_doc.md Kap 4.5 (Hybrid Strength) & spec 6.3.
// Pure functions.

import type {
  Exercise,
  PhaseConfig,
  SessionPlan,
  TherapyPhase,
  WeekStrengthData,
  WeekStrengthPlan,
} from "../types";

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

const STRENGTH_A_BASE: Exercise[] = [
  // HSR — slow tempo is the active ingredient for tendon remodeling
  { name: "Hex Bar Deadlift", sets: 4, reps: 5, loadPct: 82, rpeCap: 8, tempo: "3-3-1", restSec: 180 },
  { name: "Bench Press", sets: 3, reps: 8, loadPct: 75, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
  { name: "Reverse Lunge", sets: 3, reps: "10/leg", loadPct: 60, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
  { name: "Calf Raises", sets: 3, reps: 12, loadPct: 50, rpeCap: 7, tempo: "2-2-2", restSec: 60 },
  { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
];

const STRENGTH_B_BASE: Exercise[] = [
  { name: "Romanian Deadlift", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "3-3-1", restSec: 180 }, // HSR
  { name: "Pull-ups", sets: 4, reps: 8, rpeCap: 8, tempo: "2-1-1", restSec: 120 },
  { name: "Hip Thrust", sets: 3, reps: 10, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
  { name: "Pallof Press", sets: 3, reps: "10/side", rpeCap: 6, tempo: "1-2-1", restSec: 60 },
];

const STRENGTH_C_BASE: Exercise[] = [
  { name: "Hex Bar Deadlift", sets: 3, reps: 6, loadPct: 75, rpeCap: 7, tempo: "3-3-1", restSec: 180 }, // HSR
  { name: "DB Bench Press", sets: 3, reps: 8, loadPct: 70, rpeCap: 7, tempo: "2-1-1", restSec: 90 },
  { name: "Broad Jumps", sets: 3, reps: 5, rpeCap: 7, tempo: "X-X-X", restSec: 120, notes: "Plyo (knee-friendly alternative to box jumps)" },
  { name: "Farmer's Carry", sets: 3, reps: "30m", loadPct: 60, rpeCap: 6, restSec: 90 },
];

const STRENGTH_TEMPLATES = {
  strength_a: STRENGTH_A_BASE,
  strength_b: STRENGTH_B_BASE,
  strength_c: STRENGTH_C_BASE,
} as const;

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
// Week strength plan
// ============================================
/**
 * Generate week's strength plan: A (Mon), B (Wed), C (Fri).
 * `weekStartDate` = Monday of the week (Date with 0:00 time).
 * `therapyPhase` controls whether Wall Sit is prepended to each strength
 * session as the active tendon-therapy stimulus (REACTIVE / DISREPAIR).
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
): WeekStrengthPlan {
  const dateAt = (offsetDays: number): Date =>
    new Date(weekStartDate.getTime() + offsetDays * 86400000);

  const wallSitNeeded = therapyPhase === "REACTIVE" || therapyPhase === "DISREPAIR";

  const buildSession = (
    type: "strength_a" | "strength_b" | "strength_c",
    offsetDays: number,
  ): SessionPlan => {
    let exercises = STRENGTH_TEMPLATES[type].map((e) => ({ ...e }));
    exercises = applyMode(exercises, phaseConfig.strengthMode, phaseConfig.strengthRpeCap);

    // Sprint v0.7: layer Superset-Pairing for Block 2-4 (HSR-protected).
    exercises = applySupersetPairing(exercises, phaseConfig.blockNumber, type);

    // Apply RPE-based progression from previous session of same type, if any
    if (prevWeekData) {
      const prevSession = prevWeekData.sessions.find((s) => s.type === type);
      if (prevSession?.rpeReported !== undefined) {
        exercises = exercises.map((ex) => {
          if (ex.loadPct !== undefined) {
            const adjusted = adjustLoadForRPE(prevSession.rpeReported!, phaseConfig.strengthRpeCap, ex.loadPct);
            return { ...ex, loadPct: adjusted };
          }
          return ex;
        });
      }
    }

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

// Re-export for SessionModulator
export const STRENGTH_TEMPLATES_PUBLIC = STRENGTH_TEMPLATES;
