// SessionModulator — aggregate plan + sensor outputs → final session
// See science_doc.md Kap 9.4 (Decision Tree) & spec 6.7.
// Pure function. No async. Sequential modulation pipeline:
//   1. Hard constraints   (knee >= 8, RED+ACWR critical, multi-risk)
//   2. Readiness-based    (YELLOW/ORANGE/RED bands)
//   3. Knee-based         (5-7 score range)
//   4. Load-based         (ACWR > 1.3)
//   5. Therapy phase      (REACTIVE adds wall-sit, REACTIVE blocks intensity)

import type {
  Exercise,
  FinalSession,
  LimitationsOutput,
  LoadOutput,
  ReadinessOutput,
  SessionPlan,
} from "../types";
import { WALL_SIT } from "../strength-coach";

const KNEE_HARD_THRESHOLD = 8;
const KNEE_MOD_LOWER = 5;
const KNEE_MOD_UPPER = 7;
const ACWR_HIGH_LOWER = 1.3;
const ACWR_DANGER = 1.4;
const ACWR_HIGH_UPPER = 1.5;

const M_PACE_FALLBACK = "5:05"; // VDOT 42 marathon pace; consumer should pass paces in plan

function isRunSession(session: SessionPlan): boolean {
  return [
    "easy_run",
    "threshold_run",
    "tempo_run",
    "vo2max_intervals",
    "long_run",
    "calibration_run",
    "time_trial_5k",
  ].includes(session.type);
}

function isStrengthSession(session: SessionPlan): boolean {
  return session.type.startsWith("strength");
}

function applyLoadCap(exercises: Exercise[] | undefined, capPct: number): Exercise[] | undefined {
  if (!exercises) return exercises;
  return exercises.map((ex) => {
    if (ex.loadPct === undefined) return ex;
    return { ...ex, loadPct: Math.min(ex.loadPct, capPct * 100) };
  });
}

function removeExercises(exercises: Exercise[] | undefined, names: string[]): Exercise[] | undefined {
  if (!exercises) return exercises;
  const lowerNames = names.map((n) => n.toLowerCase());
  return exercises.filter((ex) => {
    const lower = ex.name.toLowerCase();
    return !lowerNames.some((n) => lower.includes(n));
  });
}

function prependExercise(exercises: Exercise[] | undefined, ex: Exercise): Exercise[] {
  return exercises ? [ex, ...exercises] : [ex];
}

function makeRecoverySession(date: Date, reason: string): FinalSession {
  return {
    date,
    type: "active_recovery",
    durationMin: 30,
    intensityZone: 1,
    rpeTarget: 3,
    notes: "Active recovery — light mobility / walk only.",
    wasModified: true,
    modifications: [`Hard constraint: ${reason} — Session zu Active Recovery geswapt`],
    confidence: 95,
    explanation: `Schutz-Session: ${reason}. Heute Recovery, kein Training.`,
  };
}

function makeRestSession(date: Date, reason: string): FinalSession {
  return {
    date,
    type: "rest",
    wasModified: true,
    modifications: [`Hard constraint: ${reason} — Vollständige Pause`],
    confidence: 95,
    explanation: `Vollständige Pause: ${reason}.`,
  };
}

function computeConfidence(
  readiness: ReadinessOutput,
  load: LoadOutput,
  limitations: LimitationsOutput,
): number {
  let conf = 80;
  if (readiness.band === "RED") conf -= 20;
  else if (readiness.band === "ORANGE") conf -= 10;
  else if (readiness.band === "YELLOW") conf -= 5;
  if (load.band === "DANGER") conf -= 15;
  else if (load.band === "HIGH") conf -= 5;
  if (limitations.kneeScoreToday >= KNEE_MOD_LOWER) conf -= 10;
  return Math.max(40, Math.min(100, conf));
}

function generateBriefExplanation(modifications: string[]): string {
  if (modifications.length === 0) return "Plan unverändert — alle Sensoren grün.";
  return modifications.join(" · ");
}

/**
 * Modulate a planned session given today's sensor outputs.
 * Sequential, explainable, pure.
 */
export function modulateSession(
  plannedSession: SessionPlan,
  readiness: ReadinessOutput,
  load: LoadOutput,
  limitations: LimitationsOutput,
): FinalSession {
  // ============================================
  // 1. HARD CONSTRAINTS
  // ============================================
  if (limitations.kneeScoreToday >= KNEE_HARD_THRESHOLD) {
    return makeRecoverySession(plannedSession.date, `Knee-Score ${limitations.kneeScoreToday} (>= ${KNEE_HARD_THRESHOLD})`);
  }
  if (readiness.band === "RED" && load.acwrRolling > ACWR_DANGER) {
    return makeRestSession(plannedSession.date, `Readiness RED + ACWR ${load.acwrRolling.toFixed(2)}`);
  }
  if (readiness.band === "RED" && limitations.kneeScoreToday >= KNEE_MOD_LOWER) {
    return makeRecoverySession(plannedSession.date, "Multiple risk factors (RED + Knee)");
  }

  // ============================================
  // 2. SOFT CONSTRAINTS — sequential
  // ============================================
  const modulated: SessionPlan = { ...plannedSession };
  if (plannedSession.exercises) modulated.exercises = plannedSession.exercises.map((e) => ({ ...e }));
  const modifications: string[] = [];

  // Readiness ORANGE: drop intensity, reduce volume
  if (readiness.band === "ORANGE") {
    if (modulated.intensityZone === 3) {
      modulated.intensityZone = 2;
      modifications.push("Readiness Orange — Intensität von Z3 auf Z2 reduziert");
    }
    if (modulated.durationMin) {
      modulated.durationMin = Math.round(modulated.durationMin * 0.8);
      modifications.push("Readiness Orange — Volumen 80%");
    }
  }

  // Readiness YELLOW + threshold → marathon pace
  if (readiness.band === "YELLOW" && modulated.type === "threshold_run") {
    modulated.paceTarget = { from: M_PACE_FALLBACK, to: M_PACE_FALLBACK };
    modulated.type = "tempo_run";
    modifications.push("Readiness Yellow — Pace auf Marathon statt Threshold");
  }

  // Knee 5-7: load cap + remove plyo on strength, intensity max Z2 on runs
  if (
    limitations.kneeScoreToday >= KNEE_MOD_LOWER &&
    limitations.kneeScoreToday <= KNEE_MOD_UPPER
  ) {
    if (isStrengthSession(modulated)) {
      modulated.exercises = applyLoadCap(modulated.exercises, 0.7);
      modulated.exercises = removeExercises(modulated.exercises, [
        "broad jump",
        "box jump",
        "depth jump",
        "heavy squat",
      ]);
      modifications.push(`Knee ${limitations.kneeScoreToday} — Last-Cap 70%, Plyo entfernt`);
    }
    if (isRunSession(modulated) && (modulated.intensityZone ?? 1) > 2) {
      modulated.intensityZone = 2;
      modifications.push("Knee aufmerksam — Lauf-Intensität auf Z2 begrenzt");
    }
  }

  // Knee 7 (upper end): block intervals shorter than 3 min
  if (limitations.kneeScoreToday === KNEE_MOD_UPPER) {
    if (modulated.type === "vo2max_intervals" || modulated.type === "threshold_run") {
      modulated.type = "easy_run";
      modulated.intensityZone = 1;
      modulated.paceTarget = undefined;
      modulated.structure = undefined;
      modifications.push("Knee 7 — Intervalle gestrichen, ersetzt durch Easy");
    }
  }

  // Load HIGH (1.3 < ACWR <= 1.5): volume 90%
  if (load.acwrRolling > ACWR_HIGH_LOWER && load.acwrRolling <= ACWR_HIGH_UPPER) {
    if (modulated.durationMin) {
      modulated.durationMin = Math.round(modulated.durationMin * 0.9);
      modifications.push(`ACWR ${load.acwrRolling.toFixed(2)} — Volumen 90%`);
    }
  }

  // ============================================
  // 3. THERAPY-PHASE ADJUSTMENTS
  // ============================================
  if (limitations.therapyPhase === "REACTIVE") {
    if (isStrengthSession(modulated)) {
      modulated.exercises = prependExercise(modulated.exercises, WALL_SIT);
      // wall-sit add is "expected" in REACTIVE — only annotate if not yet present
      const hasWallSit = plannedSession.exercises?.some((e) =>
        e.name.toLowerCase().includes("wall sit"),
      );
      if (!hasWallSit) {
        modifications.push("Therapy REACTIVE — Wall Sit pre-workout hinzugefügt");
      }
    }
    if (isRunSession(modulated) && (modulated.intensityZone ?? 1) > 1) {
      modulated.intensityZone = 1;
      modulated.paceTarget = undefined;
      modulated.structure = undefined;
      if (modulated.type !== "easy_run") {
        modulated.type = "easy_run";
      }
      modifications.push("Therapy REACTIVE — nur Easy Running");
    }
  } else if (limitations.therapyPhase === "DISREPAIR") {
    if (isStrengthSession(modulated)) {
      const hasWallSit = (modulated.exercises ?? []).some((e) =>
        e.name.toLowerCase().includes("wall sit"),
      );
      if (!hasWallSit) {
        modulated.exercises = prependExercise(modulated.exercises, WALL_SIT);
        modifications.push("Therapy DISREPAIR — Wall Sit pre-workout hinzugefügt");
      }
    }
  }

  return {
    ...modulated,
    wasModified: modifications.length > 0,
    modifications,
    confidence: computeConfidence(readiness, load, limitations),
    explanation: generateBriefExplanation(modifications),
  };
}
