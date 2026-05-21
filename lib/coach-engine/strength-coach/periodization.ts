// Strength Periodization Engine 2.0 (Sprint v0.10) — pure module.
//
// Implements 4-week-block 3:1 loading-to-deload progression for strength
// training in a recreational-runner context. All decisions deterministic
// from inputs; no I/O.
//
// Evidence base (citations live in code comments where the rule fires):
//   - Petré 2021 (n=27 SR): untrained/moderately-trained → no significant
//     interference on 1RM; classical linear progression works.
//   - McLeod 2023 (44 SR umbrella): RT load + volume are the strength
//     drivers; periodize on those, not frequency.
//   - Schoenfeld 2019 (25-study MA): volume-equated 1-3+/wk equivalent;
//     3 sessions/week is sufficient.
//   - Casado 2022: hard-day / easy-day basis is standard periodization.
//   - Agergaard 2021: HSR (90% 1RM) ≈ MSR (55% 1RM) when volume-equated.
//   - Pavlova 2023 (110-study MA): higher intensity > body-mass-only,
//     lower frequency (<daily) > daily for tendon adaptation.
//   - Breda 2020 (RCT, n=76): PTLE > pure eccentric (VISA-P +28 vs +18).
//   - Escriche-Escuder 2020 / Sprague 2020: pain-guided progression
//     (NRS≤3 progress, 4–5 hold, >5 step back) shows higher compliance.
import type { Exercise } from "../types";

// ============================================
// Public types
// ============================================

export type WeekInBlock = 1 | 2 | 3 | 4;

export interface PeriodizationContext {
  weekInBlock: WeekInBlock;
  blockNumber: number;
  /** Last logged knee pain NRS (0–10) for this session-type in the prior week. null if untracked. */
  prevPainNrs: number | null;
  /** Last reported RPE for this session-type. null if no prior session. */
  prevRpeReported: number | null;
  /** Phase's RPE-cap baseline (e.g. 8 for Block 1). */
  baselineRpeCap: number;
  /**
   * Phase's strength mode. Sprint v1.4: when "maintenance" or "minimal",
   * the W4 setMultiplier is softened (0.80 instead of 0.67) because the
   * mode-multiplier (0.75 maintenance / 0.5 minimal) already compounds with
   * the deload, otherwise: 0.75 × 0.67 = 0.50, which can drop accessories
   * below the 2-set MEV floor after rounding.
   */
  strengthMode: "linear_progression" | "maintenance" | "minimal";
  /**
   * Sprint v1.5 — Block-Reset Ramp-Up: when set, the LOAD multiplier from
   * this target week-in-block overrides the actual `weekInBlock` load.
   * Sets, RPE-cap, and rationale still follow the row's real `weekInBlock`.
   *
   * Use case: after illness, restart Block 1 with W1 volume (sets unchanged)
   * but apply the W2 +2.5% load increment because the athlete keeps the
   * strength gain from the previous block. `loadOverrideWeek: 2` while
   * `weekInBlock: 1` = "W1 volume + W2 loads".
   *
   * `null` / undefined → no override (default behavior).
   */
  loadOverrideWeek?: WeekInBlock | null;
}

export interface PeriodizationAdjustment {
  /** Multiplier applied to loadPct of every exercise. */
  loadMultiplier: number;
  /** Multiplier applied to set count (rounded to int, min 2). */
  setMultiplier: number;
  /** Delta added to rpeCap (clamped to [5, 10]). */
  rpeCapDelta: number;
  /** True when last session's NRS 4-5 → HSR holds load (no progression). */
  painLockedHsr: boolean;
  /** True when last session's NRS > 5 → HSR steps back (-5% load). */
  painSteppedBack: boolean;
  /** Human-readable rationale string for UI + coach-context. */
  rationale: string;
}

// ============================================
// Constants
// ============================================

/** HSR lifts that drive tendon-loading. Pain-guided overrides apply only to these. */
const HSR_LIFTS: ReadonlySet<string> = new Set([
  "Hex Bar Deadlift",
  "Romanian Deadlift",
  "RDL",
]);

/** NRS threshold semantics, per Escriche-Escuder 2020 + Sprague 2020. */
const NRS_HOLD_LOWER = 4;
const NRS_STEP_BACK_THRESHOLD = 5; // strictly greater steps back

/**
 * Sprint v1.5 — Load-only multiplier for a target week-in-block, used by
 * the loadOverrideWeek mechanism. Mirrors the LOAD column from the W1-W4
 * pattern in computePeriodizationAdjustment, WITHOUT touching sets or RPE.
 */
function loadMultiplierForWeek(week: WeekInBlock): number {
  switch (week) {
    case 1: return 1.0;
    case 2: return 1.025;
    case 3: return 1.05;
    case 4: return 0.85;
  }
}

// ============================================
// computePeriodizationAdjustment
// ============================================

/**
 * Compute the periodization adjustment for one strength-session-type in a given
 * week of a 4-week block.
 *
 * Pattern (3:1 Casado/McLeod):
 *   Week 1 (Adaptation):  baseline load, baseline volume, baseline RPE-cap.
 *   Week 2 (Build 1):     +2.5% load,    same volume,     baseline RPE-cap.
 *   Week 3 (Build 2/Peak): +5% load,     +33% sets (non-HSR), +1 RPE-cap.
 *   Week 4 (Deload):      85% load,      67% sets,        −1 RPE-cap.
 *
 * Pain override (HSR only — Hex Bar Deadlift, RDL):
 *   prevPainNrs > 5  → step back: HSR loadMultiplier = 0.95 (handled at apply-time)
 *   prevPainNrs 4–5  → hold:      HSR loadMultiplier = 1.00 (no progression even in W2/W3)
 *   prevPainNrs ≤ 3  → progress normally
 *
 * RPE-feedback bump (every exercise):
 *   prevRpeReported < baselineRpeCap − 2 → ×1.01 (small bump, last session too easy)
 *   prevRpeReported > baselineRpeCap + 1 → ×0.95 (pullback, too hard)
 *
 * Pure — does not mutate inputs.
 */
export function computePeriodizationAdjustment(
  ctx: PeriodizationContext,
): PeriodizationAdjustment {
  let painLockedHsr = false;
  let painSteppedBack = false;
  if (ctx.prevPainNrs !== null) {
    if (ctx.prevPainNrs > NRS_STEP_BACK_THRESHOLD) painSteppedBack = true;
    else if (ctx.prevPainNrs >= NRS_HOLD_LOWER) painLockedHsr = true;
  }

  let loadMultiplier = 1.0;
  let setMultiplier = 1.0;
  let rpeCapDelta = 0;
  let weekRationale = "";

  switch (ctx.weekInBlock) {
    case 1:
      weekRationale = "W1 Adaptation: baseline load, baseline volume.";
      break;
    case 2:
      loadMultiplier = 1.025;
      weekRationale = "W2 Build 1: +2.5% load, same volume.";
      break;
    case 3:
      loadMultiplier = 1.05;
      setMultiplier = 1.33;
      rpeCapDelta = 1;
      weekRationale =
        "W3 Build 2/Peak: +5% load, +1 set on accessories, +1 RPE-cap.";
      break;
    case 4:
      loadMultiplier = 0.85;
      // Sprint v1.4: softer deload when mode is already reducing volume.
      // maintenance: 0.75 × 0.67 = 0.50 (too aggressive, accessories hit MEV
      // floor after rounding). 0.75 × 0.80 = 0.60 is closer to maintenance
      // minimum. minimal mode same — already 0.5x, no need to compound.
      setMultiplier = ctx.strengthMode === "linear_progression" ? 0.67 : 0.80;
      rpeCapDelta = -1;
      weekRationale = ctx.strengthMode === "linear_progression"
        ? "W4 Deload: 85% load, 67% sets, -1 RPE-cap."
        : "W4 Deload (maintenance-adjusted): 85% load, 80% sets, -1 RPE-cap.";
      break;
  }

  // Sprint v1.5 — Block-Reset Ramp-Up: override the LOAD multiplier with a
  // different week-in-block's value while keeping the row's actual set count
  // and RPE-cap. Use case: W1 volume + W2 loads after illness reset.
  if (ctx.loadOverrideWeek != null && ctx.loadOverrideWeek !== ctx.weekInBlock) {
    const overrideLoad = loadMultiplierForWeek(ctx.loadOverrideWeek);
    loadMultiplier = overrideLoad;
    weekRationale += ` [Load-Override: W${ctx.loadOverrideWeek} loads (×${overrideLoad}), volume from W${ctx.weekInBlock}]`;
  }

  // RPE-based fine-tune: only if we have a prior reading. Never zero — small
  // bump or pullback that nudges the linear progression.
  let rpeAdjustment = 1.0;
  if (ctx.prevRpeReported !== null) {
    if (ctx.prevRpeReported < ctx.baselineRpeCap - 2) rpeAdjustment = 1.01;
    else if (ctx.prevRpeReported > ctx.baselineRpeCap + 1) rpeAdjustment = 0.95;
  }
  loadMultiplier *= rpeAdjustment;

  let rationale = weekRationale;
  if (painSteppedBack) rationale += " HSR pain-stepped-back (last NRS > 5).";
  else if (painLockedHsr)
    rationale += " HSR pain-locked (last NRS 4-5, no progression).";
  if (rpeAdjustment !== 1.0) {
    rationale +=
      rpeAdjustment > 1.0
        ? " RPE bump (last session too easy)."
        : " RPE pullback (last session too hard).";
  }

  return {
    loadMultiplier,
    setMultiplier,
    rpeCapDelta,
    painLockedHsr,
    painSteppedBack,
    rationale,
  };
}

// ============================================
// applyPeriodization
// ============================================

/**
 * Apply a PeriodizationAdjustment to an array of exercises.
 *
 * HSR-Lift rules (Hex Bar Deadlift / RDL):
 *   - Pain step-back: load ×0.95, sets stay (no extra volume on stepped-back HSR)
 *   - Pain hold:      load ×1.00, sets stay
 *   - Otherwise:      load ×adjustment.loadMultiplier
 *   - Set increase from W3 (+33%) is NEVER applied to HSR — extra volume on
 *     heavy compound + tendon work invites overuse.
 *
 * Non-HSR exercises take the full adjustment.
 *
 * Pure — returns a new array; inputs are not mutated.
 */
export function applyPeriodization(
  exercises: Exercise[],
  adjustment: PeriodizationAdjustment,
): Exercise[] {
  return exercises.map((ex) => {
    const isHsr = HSR_LIFTS.has(ex.name);

    let effectiveLoadMult = adjustment.loadMultiplier;
    let effectiveSetMult = adjustment.setMultiplier;
    let painNote: string | undefined;

    if (isHsr) {
      if (adjustment.painSteppedBack) {
        effectiveLoadMult = 0.95;
        effectiveSetMult = 1.0;
        painNote = "HSR pain-stepped-back: -5% load.";
      } else if (adjustment.painLockedHsr) {
        effectiveLoadMult = 1.0;
        effectiveSetMult = 1.0;
        painNote = "HSR pain-locked: no load progression.";
      }
      // Cap: HSR never gets the W3 +33% set bump.
      effectiveSetMult = Math.min(effectiveSetMult, 1.0);
    }

    const newLoadPct =
      ex.loadPct !== undefined
        ? Math.round(ex.loadPct * effectiveLoadMult * 10) / 10
        : ex.loadPct;
    const newSets = Math.max(2, Math.round(ex.sets * effectiveSetMult));
    const newRpeCap =
      ex.rpeCap !== undefined
        ? Math.max(5, Math.min(10, ex.rpeCap + adjustment.rpeCapDelta))
        : ex.rpeCap;

    const next: Exercise & { periodizationNote?: string } = {
      ...ex,
      sets: newSets,
      loadPct: newLoadPct,
      rpeCap: newRpeCap,
    };
    if (painNote) next.periodizationNote = painNote;
    return next;
  });
}

// ============================================
// Helper: human-readable label for a week-in-block
// ============================================

export function getPeriodizationLabel(week: WeekInBlock): string {
  return {
    1: "Adaptation",
    2: "Build 1",
    3: "Build 2 / Peak",
    4: "Deload",
  }[week];
}

/**
 * Compute the (1-indexed) position of `weekNumber` within its phase, given the
 * phase's `durationWeeks`. Caps at the upper bound for blocks longer than 4.
 */
export function weekInBlockOf(
  weekNumber: number,
  phaseDurationWeeks: number,
): WeekInBlock {
  const dur = Math.max(1, phaseDurationWeeks);
  const raw = ((weekNumber - 1) % dur) + 1;
  const clamped = Math.max(1, Math.min(4, raw));
  return clamped as WeekInBlock;
}
