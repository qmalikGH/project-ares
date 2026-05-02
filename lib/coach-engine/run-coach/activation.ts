// Pre-Run Activation Block (Sprint v0.13) — pure module.
//
// Short hip/core activation routine for run-only days (Tue quality,
// Sat long run). On strength+easy days (Mon/Thu/Fri) the strength templates
// already cover these movement patterns — activation is NOT added there.
//
// Evidence base:
//   - Leppänen 2024 (RCT, n=325, 24wk): hip+core programme before running
//     → 34% fewer LE injuries, 52% fewer substantial overuse injuries
//     in novice recreational runners.
//   - Naderi 2025 (RCT, n=264): multi-component programme (core, flexibility,
//     neuromuscular) → 47% fewer RRIs, 54% fewer overuse injuries.
//   - Note: Leppänen 2024 found ankle+foot exercises did NOT reduce injuries
//     and even increased acute injury risk. We therefore focus on HIP+CORE,
//     not ankle/foot, for the pre-run block. Ankle/foot exercises (Tibialis
//     Raises, Short Foot, Calf Raises) remain in the strength templates
//     where they're performed under controlled, non-pre-fatigued conditions.
//
// Programme (~5 min):
//   1. Glute Bridge         — 2×10, bilateral hip activation
//   2. Clamshell            — 2×10/side, hip external rotation / glute med
//   3. Dead Bug             — 2×8/side, anterior core stability
//   4. Bird Dog             — 2×8/side, posterior chain + anti-rotation
//
// Pure — returns a fixed array of activation exercises.

import type { Exercise } from "../types";

export const PRE_RUN_ACTIVATION: Exercise[] = [
  {
    name: "Glute Bridge",
    sets: 2,
    reps: 10,
    rpeCap: 4,
    tempo: "2-2-1",
    restSec: 15,
    isWarmup: true,
    notes: "Bilateral. Becken voll heben, Gesäß aktivieren.",
  },
  {
    name: "Clamshell",
    sets: 2,
    reps: "10/side",
    rpeCap: 4,
    tempo: "2-1-1",
    restSec: 15,
    isWarmup: true,
    notes: "Seitlage. Knie öffnen, Füße zusammen. Glute Med Activation.",
  },
  {
    name: "Dead Bug",
    sets: 2,
    reps: "8/side",
    rpeCap: 4,
    tempo: "2-2-2",
    restSec: 15,
    isWarmup: true,
    notes: "Rücken flach am Boden. Gegenüberliegenden Arm + Bein strecken.",
  },
  {
    name: "Bird Dog",
    sets: 2,
    reps: "8/side",
    rpeCap: 4,
    tempo: "2-2-2",
    restSec: 15,
    isWarmup: true,
    notes: "Vierfüßlerstand. Gegenüberliegenden Arm + Bein strecken. Anti-Rotation.",
  },
];

/** Estimated duration of the activation block in minutes. */
export const ACTIVATION_DURATION_MIN = 5;
