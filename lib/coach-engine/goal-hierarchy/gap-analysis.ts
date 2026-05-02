// Gap-Analyse Engine (Sprint v0.14) — pure module.
//
// Evaluates a completed macrocycle against the annual goal targets
// and suggests focus mode + targets for the next macrocycle.
//
// Priorisierungs-Logik basiert auf Petré 2021 (MA, 27 Studien):
// Concurrent Training Interferenz wird signifikant ab ~Trained Level.
// Bei großem Gap in einer Dimension: nächster Zyklus priorisiert
// diese Dimension, andere gehen in Maintenance.
//
// Gewichts-Logik basiert auf Garthe 2011 (RCT, n=24):
// 0.7% BW/Woche ist optimal für LBM-Erhalt bei Fettabbau.
// Protein-Empfehlung: 2.0–2.5 g/kg/Tag im Defizit (Chappell 2021).
//
// VO2max-Kalibrierung basiert auf Lee 2021:
// Allometrische Skalierung (BW^0.82) — schwerere Athleten haben
// systematisch niedrigere relative VO2max. Targets müssen
// gewichtsangepasst sein.

import type {
  GoalDimensions,
  MacrocycleFocus,
  MacrocycleEvaluation,
  DimensionEvaluation,
} from "../types";

// ============================================
// Time parsing helpers
// ============================================

/** Parse "mm:ss" or "h:mm:ss" to seconds. Returns 0 for invalid input. */
function timeToSeconds(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** Convert total seconds back to "mm:ss" or "h:mm:ss". */
function secondsToTime(totalSec: number): string {
  if (totalSec <= 0) return "0:00";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** For time-based dimensions, lower is better. For all others, context-dependent. */
const TIME_DIMENSIONS = new Set<keyof GoalDimensions>(["5k", "10k", "hm", "marathon"]);
const LOWER_IS_BETTER = new Set<keyof GoalDimensions>(["5k", "10k", "hm", "marathon", "weight", "bodyFatPct"]);

// ============================================
// Dimension labels + units
// ============================================

const DIMENSION_META: Record<keyof GoalDimensions, { label: string; unit: string }> = {
  "5k": { label: "5k-Zeit", unit: "min:sec" },
  "10k": { label: "10k-Zeit", unit: "min:sec" },
  hm: { label: "Halbmarathon", unit: "h:mm:ss" },
  marathon: { label: "Marathon", unit: "h:mm:ss" },
  ironman: { label: "Ironman", unit: "text" },
  vo2max: { label: "VO2max", unit: "ml/kg/min" },
  hexBarDl: { label: "Hex Bar Deadlift", unit: "kg" },
  convDl: { label: "Conv. Deadlift", unit: "kg" },
  bench: { label: "Bench Press", unit: "kg" },
  squat: { label: "Squat", unit: "kg" },
  weight: { label: "Körpergewicht", unit: "kg" },
  bodyFatPct: { label: "Körperfettanteil", unit: "%" },
};

// ============================================
// Gap calculation
// ============================================

/**
 * Calculate gap percentage for a single dimension.
 * Returns 0 when target is achieved, 100 when no progress from start.
 * For time dimensions: compares in seconds (lower = better).
 * For strength/VO2max: compares numerically (higher = better).
 * For weight/BF%: compares numerically (lower = better).
 */
function calculateGap(
  dimension: keyof GoalDimensions,
  startValue: number | string | null,
  endValue: number | string | null,
  target: number | string | null,
): { gap: number | null; verdict: DimensionEvaluation["verdict"] } {
  if (target === null || target === undefined || endValue === null || endValue === undefined) {
    return { gap: null, verdict: "no_data" };
  }

  let startNum: number;
  let endNum: number;
  let targetNum: number;

  if (TIME_DIMENSIONS.has(dimension)) {
    // For time dimensions: parse "mm:ss" or "h:mm:ss" to seconds.
    // If startValue missing, assume 20% worse than target as baseline.
    startNum = startValue ? timeToSeconds(String(startValue)) : timeToSeconds(String(target)) * 1.2;
    endNum = timeToSeconds(String(endValue));
    targetNum = timeToSeconds(String(target));
  } else {
    startNum = typeof startValue === "number" ? startValue : 0;
    endNum = typeof endValue === "number" ? endValue : 0;
    targetNum = typeof target === "number" ? target : 0;
  }

  const lowerBetter = LOWER_IS_BETTER.has(dimension);

  // Normalize: how much of the start→target gap has been closed?
  const totalGap = lowerBetter ? startNum - targetNum : targetNum - startNum;
  if (totalGap <= 0) {
    // Already at or past target from the start
    return { gap: 0, verdict: "achieved" };
  }

  const progress = lowerBetter ? startNum - endNum : endNum - startNum;
  const progressPct = (progress / totalGap) * 100;
  const remainingPct = Math.max(0, 100 - progressPct);

  // Check if target is achieved
  const achieved = lowerBetter ? endNum <= targetNum : endNum >= targetNum;
  if (achieved) return { gap: 0, verdict: "achieved" };

  // On track if ≥60% of expected progress for this cycle
  // (assumes ~3 cycles per annual goal)
  const EXPECTED_PROGRESS_PCT = 33; // ~1/3 of annual goal per cycle
  const verdict = progressPct >= EXPECTED_PROGRESS_PCT * 0.6 ? "on_track" : "behind";

  return { gap: Math.round(remainingPct), verdict };
}

// ============================================
// Focus suggestion
// ============================================

/**
 * Suggest focus mode for next macrocycle based on gap analysis.
 *
 * Logic (priority order):
 * 1. If weight gap > 30%: "recomp" — weight loss is the highest-leverage
 *    intervention (improves BOTH running and relative strength).
 * 2. If strength dimensions are significantly behind AND endurance on track:
 *    "strength_focus" — Petré 2021: trained athletes need dedicated blocks.
 * 3. If endurance behind AND strength on track:
 *    "endurance_focus" — volume-intensive running block with strength maintenance.
 * 4. Otherwise: "balanced".
 */
function suggestFocus(
  evaluations: DimensionEvaluation[],
): { focus: MacrocycleFocus; rationale: string } {
  const weightEval = evaluations.find((e) => e.name === "weight");
  const strengthDims = evaluations.filter((e) =>
    (["hexBarDl", "convDl", "bench", "squat"] as (keyof GoalDimensions)[]).includes(e.name),
  );
  const enduranceDims = evaluations.filter((e) =>
    (["5k", "10k", "hm", "marathon", "vo2max"] as (keyof GoalDimensions)[]).includes(e.name),
  );

  // Weight priority check (Garthe 2011: 0.7% BW/wk optimal for LBM retention)
  if (weightEval && weightEval.gap !== null && weightEval.gap > 30) {
    return {
      focus: "recomp",
      rationale:
        "Gewichtsreduktion hat höchsten Hebel: verbessert gleichzeitig Laufzeiten (weniger Masse) und relative Kraftwerte. " +
        "Empfehlung: 0.7% BW/Woche Defizit, Protein 2.0–2.5 g/kg/Tag (Garthe 2011, Chappell 2021).",
    };
  }

  const strengthBehind = strengthDims.filter((e) => e.verdict === "behind").length;
  const enduranceBehind = enduranceDims.filter((e) => e.verdict === "behind").length;
  const strengthOnTrack = strengthDims.filter(
    (e) => e.verdict === "on_track" || e.verdict === "achieved",
  ).length;
  const enduranceOnTrack = enduranceDims.filter(
    (e) => e.verdict === "on_track" || e.verdict === "achieved",
  ).length;

  // Petré 2021: concurrent training interference significant in trained athletes (ES=-0.35)
  if (strengthBehind >= 2 && enduranceOnTrack >= 2) {
    return {
      focus: "strength_focus",
      rationale:
        "Kraft-Dimensionen liegen hinter dem Jahresplan. Nächster Zyklus priorisiert Kraft " +
        "(höheres Volumen/Intensität), Ausdauer geht in Maintenance (~80% Volumen). " +
        "Petré 2021: bei trainierten Athleten ist Concurrent-Interferenz signifikant (ES=-0.35) — dedizierte Kraft-Blöcke sind effektiver.",
    };
  }

  if (enduranceBehind >= 2 && strengthOnTrack >= 2) {
    return {
      focus: "endurance_focus",
      rationale:
        "Ausdauer-Dimensionen liegen hinter dem Jahresplan. Nächster Zyklus priorisiert Laufvolumen " +
        "und VO2max-Entwicklung. Kraft geht in Maintenance (2×/Woche, reduziertes Volumen).",
    };
  }

  return {
    focus: "balanced",
    rationale:
      "Beide Dimensionen entwickeln sich gleichmäßig oder benötigen parallele Aufmerksamkeit. " +
      "Standard-Hybrid-Periodisierung mit 3×Strength + 5×Run pro Woche wird beibehalten.",
  };
}

// ============================================
// Next cycle target generation
// ============================================

/**
 * Generate targets for the next macrocycle based on the gap to annual goal.
 * Distributes remaining gap across estimated remaining cycles.
 */
function generateNextCycleTargets(
  annualTargets: GoalDimensions,
  currentValues: GoalDimensions,
  remainingCycles: number,
): GoalDimensions {
  const nextTargets: GoalDimensions = {};

  for (const [key, annualTarget] of Object.entries(annualTargets)) {
    const dim = key as keyof GoalDimensions;
    const current = currentValues[dim];
    if (annualTarget === undefined || current === undefined) continue;

    if (TIME_DIMENSIONS.has(dim)) {
      const currentSec = timeToSeconds(String(current));
      const targetSec = timeToSeconds(String(annualTarget));
      const stepSec = Math.round((currentSec - targetSec) / Math.max(1, remainingCycles));
      const nextSec = currentSec - stepSec;
      (nextTargets as Record<string, unknown>)[dim] = secondsToTime(Math.max(0, nextSec));
    } else if (typeof annualTarget === "number" && typeof current === "number") {
      const lowerBetter = LOWER_IS_BETTER.has(dim);
      const step = Math.abs(annualTarget - current) / Math.max(1, remainingCycles);
      const next = lowerBetter ? current - step : current + step;
      (nextTargets as Record<string, unknown>)[dim] = Math.round(next);
    }
  }

  return nextTargets;
}

// ============================================
// Main evaluation function
// ============================================

/**
 * Evaluate a completed macrocycle against annual goal targets.
 *
 * Pure function — does not access DB or mutate state.
 *
 * @param startValues - dimension values at the START of this macrocycle
 * @param endValues - dimension values at the END of this macrocycle (now)
 * @param annualTargets - the annual goal targets
 * @param remainingCycles - estimated number of macrocycles remaining in the annual plan
 */
export function evaluateMacrocycle(
  startValues: GoalDimensions,
  endValues: GoalDimensions,
  annualTargets: GoalDimensions,
  remainingCycles: number = 2,
): MacrocycleEvaluation {
  const dimensions: DimensionEvaluation[] = [];

  for (const [key, target] of Object.entries(annualTargets)) {
    const dim = key as keyof GoalDimensions;
    if (target === undefined) continue;

    const meta = DIMENSION_META[dim];
    if (!meta) continue;

    const start = startValues[dim] ?? null;
    const end = endValues[dim] ?? null;
    const { gap, verdict } = calculateGap(dim, start, end, target);

    dimensions.push({
      name: dim,
      label: meta.label,
      unit: meta.unit,
      startValue: start,
      endValue: end,
      annualTarget: target,
      gap,
      verdict,
    });
  }

  const { focus, rationale } = suggestFocus(dimensions);
  const nextTargets = generateNextCycleTargets(annualTargets, endValues, remainingCycles);

  const achievedOrOnTrack = dimensions.filter(
    (d) => d.verdict === "achieved" || d.verdict === "on_track",
  ).length;
  const behindCount = dimensions.filter((d) => d.verdict === "behind").length;
  const overallVerdict =
    behindCount === 0
      ? "all_on_track"
      : achievedOrOnTrack >= behindCount
        ? "mixed"
        : "behind";

  return {
    dimensions,
    overallVerdict,
    suggestedFocus: focus,
    suggestedFocusRationale: rationale,
    nextCycleTargets: nextTargets,
  };
}
