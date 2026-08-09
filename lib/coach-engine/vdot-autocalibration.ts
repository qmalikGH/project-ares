// VDOT auto-calibration — Sprint 2.6 (A6).
//
// WHY THIS EXISTS
// VDOT is the single number every prescribed running pace derives from. Until
// now it was a manual pin: set to 39 on 2026-04-28 and still 39 on 2026-08-09 —
// frozen through a whole training block AND nine weeks of detraining. The
// machinery to measure it existed the entire time (vdot-calculator.ts, three
// methods, confidence-weighted) but the only consumer wrote a NOTIFICATION with
// a prefill link. Across 3.5 months that never once produced a correction.
//
// The failure is self-reinforcing: VDOT too low → every pace too easy → the
// training stimulus lands below target → fitness does not move → VDOT stays low.
//
// THE ASYMMETRY (the reason this module is worth its own file)
// Lowering VDOT makes every future session slower. That is always safe.
// Raising it makes every future session faster — and for an athlete with a
// bone-stress history (MTSS), that is the direction that hurts. So the two
// directions do NOT get the same guardrails:
//
//   down  → step ≤ 3, never blocked by training state
//   up    → step ≤ 2, and blocked outright while the comeback ramp is running
//           or the shin gate is not "progress"
//
// A low-confidence measurement is rejected in BOTH directions. The first draft
// let drops through unchecked ("slower is always safe") — running it against the
// real June window disproved that: the calculator's linear-regression method
// extrapolated from a 148-162 bpm sample out to 195 bpm and returned VDOT 24
// next to HRC's 44, and the confidence-weighted mean landed at 34 — worse than
// either input. Applying that would have re-created the very under-training loop
// this module exists to break. Low confidence is not evidence in either
// direction; the asymmetry lives in the step caps and the state blocks.
//
// The +2/week ceiling is also a physiology statement: genuine VDOT improvement
// runs roughly 1 point per 3-6 weeks for a trained recreational runner (faster
// during a detraining rebound). A measured jump of +5 in one week is
// measurement noise, not fitness, and must not reach the athlete's paces.
//
// Pure module: no db, no next/*, own input types. The impure driver lives in
// vdot-recalibration.ts so this file stays trivially testable.

/** Below this |delta| we do not move at all — hysteresis against noise. */
export const AUTO_MIN_DELTA = 2;
/** Max single-step rise. See the physiology note above. */
export const AUTO_MAX_STEP_UP = 2;
/** Max single-step drop. Larger than UP because slower is safe. */
export const AUTO_MAX_STEP_DOWN = 3;
/** How long a deliberate manual pin outranks a measurement. */
export const MANUAL_PIN_TTL_DAYS = 28;

/**
 * VDOT_TABLE (lib/coach-engine/run-coach/index.ts) has contiguous keys 35..50
 * and then jumps to 55 — nothing below 35, and a hole at 51..54. `vdotToPaces`
 * SILENTLY snaps to the nearest key, so a measured 32 would run as 35 and a
 * measured 52 would run as 50. We refuse to write outside the contiguous band
 * and report it instead of letting the snap happen unseen.
 */
export const VDOT_TABLE_MIN = 35;
export const VDOT_TABLE_MAX = 50;

/** The source values written to UserSettings.vdotSource. */
export const VDOT_SOURCE_MANUAL = "manual";
export const VDOT_SOURCE_AUTO = "auto_rolling_14runs";

export type VdotAutoStatus =
  /** Applied — newVdot is set. */
  | "applied"
  /** The clamped/stepped result equals the current value. */
  | "unchanged"
  /** Calibrator could not produce an estimate. */
  | "insufficient_data"
  /** |delta| below the hysteresis band. */
  | "below_delta"
  /** A deliberate manual pin is still within its TTL. */
  | "manual_pin_fresh"
  /** Rejected in either direction: the methods disagree too much to act on. */
  | "low_confidence"
  /** Upward move rejected: athlete is inside the return-to-training ramp. */
  | "blocked_comeback"
  /** Upward move rejected: shin/RHR gate is holding or regressing. */
  | "blocked_shin"
  /** Estimate falls outside the pace table's well-defined band. */
  | "out_of_table_range";

export interface VdotAutoInput {
  currentVdot: number;
  /** From calibrateVdotFromRuns. */
  calibration: {
    finalVdot: number;
    confidence: "low" | "medium" | "high";
    insufficientData: boolean;
  };
  /** UserSettings.vdotSource — only VDOT_SOURCE_MANUAL gets the TTL. */
  vdotSource: string | null;
  /** UserSettings.vdotOverrideAt. */
  vdotSetAt: Date | null;
  /** True while the Sprint 2.4 comeback ramp covers the imminent week. */
  layoffActive: boolean;
  /** The Sprint 2.3 run-volume gate. */
  volumeGate: "progress" | "hold" | "regress";
  now: Date;
}

export interface VdotAutoDecision {
  status: VdotAutoStatus;
  currentVdot: number;
  /** What the calibrator measured, before caps and clamps. */
  measuredVdot: number;
  /** The value to persist, or null when nothing is applied. */
  newVdot: number | null;
  direction: "up" | "down" | "none";
  /** German one-liner — goes into vdotOverrideRationale and the notification. */
  reason: string;
}

function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 86400000;
}

function decision(
  status: VdotAutoStatus,
  input: VdotAutoInput,
  direction: "up" | "down" | "none",
  newVdot: number | null,
  reason: string,
): VdotAutoDecision {
  return {
    status,
    currentVdot: input.currentVdot,
    measuredVdot: input.calibration.finalVdot,
    newVdot,
    direction,
    reason,
  };
}

/**
 * Decide whether a measured VDOT may replace the stored one.
 *
 * Precedence is top-to-bottom and deliberate: cheap disqualifiers first, then
 * the manual pin, then the asymmetric direction rules. Pure — no side effects,
 * inputs are never mutated.
 */
export function decideVdotUpdate(input: VdotAutoInput): VdotAutoDecision {
  const { currentVdot, calibration, vdotSource, vdotSetAt, layoffActive, volumeGate, now } = input;

  if (calibration.insufficientData) {
    return decision("insufficient_data", input, "none", null, "Zu wenig Laufdaten für eine Messung.");
  }

  const measured = calibration.finalVdot;
  const delta = measured - currentVdot;

  if (Math.abs(delta) < AUTO_MIN_DELTA) {
    return decision(
      "below_delta",
      input,
      "none",
      null,
      `Messung ${measured} liegt weniger als ${AUTO_MIN_DELTA} Punkte von ${currentVdot} entfernt — kein Handlungsbedarf.`,
    );
  }

  // A deliberate manual pin outranks a measurement for MANUAL_PIN_TTL_DAYS.
  // Only "manual" qualifies: values written by the engine (or by an operator
  // script as an explicit placeholder) do not get this protection.
  if (vdotSource === VDOT_SOURCE_MANUAL && vdotSetAt) {
    const age = daysBetween(now, vdotSetAt);
    if (age < MANUAL_PIN_TTL_DAYS) {
      const remaining = Math.ceil(MANUAL_PIN_TTL_DAYS - age);
      return decision(
        "manual_pin_fresh",
        input,
        "none",
        null,
        `Manuell gesetzter VDOT ${currentVdot} gilt noch ${remaining} Tage — Messung ${measured} nicht angewendet.`,
      );
    }
  }

  const direction: "up" | "down" = delta > 0 ? "up" : "down";

  // Not evidence in either direction — see the header note on the June window.
  if (calibration.confidence === "low") {
    return decision(
      "low_confidence",
      input,
      direction,
      null,
      `Messung ${measured} verworfen: die Schätzmethoden weichen zu stark voneinander ab.`,
    );
  }

  if (direction === "up") {
    // Every rejection below keeps the athlete on the SLOWER of the two values.
    if (layoffActive) {
      return decision(
        "blocked_comeback",
        input,
        "up",
        null,
        `Messung ${measured} würde die Tempi anheben — während des Wiedereinstiegs wird nicht angehoben.`,
      );
    }
    if (volumeGate !== "progress") {
      return decision(
        "blocked_shin",
        input,
        "up",
        null,
        `Messung ${measured} würde die Tempi anheben — Schienbein-/RHR-Gate steht auf "${volumeGate}".`,
      );
    }
  }

  const cap = direction === "up" ? AUTO_MAX_STEP_UP : AUTO_MAX_STEP_DOWN;
  const stepped = currentVdot + Math.sign(delta) * Math.min(Math.abs(delta), cap);

  if (stepped < VDOT_TABLE_MIN || stepped > VDOT_TABLE_MAX) {
    return decision(
      "out_of_table_range",
      input,
      direction,
      null,
      `Messung ${measured} liegt außerhalb des abgedeckten Bereichs ${VDOT_TABLE_MIN}–${VDOT_TABLE_MAX} — nicht angewendet, damit die Pace-Tabelle nicht still auf den nächsten Wert springt.`,
    );
  }

  if (stepped === currentVdot) {
    return decision("unchanged", input, "none", null, `VDOT bleibt bei ${currentVdot}.`);
  }

  const capped = Math.abs(delta) > cap;
  const reason =
    `VDOT ${currentVdot} → ${stepped} (Messung ${measured}, Konfidenz ${calibration.confidence})` +
    (capped ? `, auf ${cap} Punkte pro Schritt begrenzt` : "") +
    ".";

  return decision("applied", input, direction, stepped, reason);
}
