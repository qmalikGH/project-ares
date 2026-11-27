// Pure decision helpers extracted from regenerate-plans.ts so they can be
// tested without a database (same split as progress-helpers.ts).
//
// Sprint 2.4 — this is where the single most consequential bug of the comeback
// lived: the gate read "no recent shin report" as "shin is calm". An athlete
// who stopped training BECAUSE of shin splints files no pain reports while he
// isn't running, so the absence of data was being counted as evidence of
// health and the plan progressed at full tilt on his first day back.

import { detectLayoff, type LayoffState } from "@/lib/coach-engine/comeback";
import { isRunType, isStrengthType } from "@/lib/db/queries/progress-helpers";

export type VolumeGate = "progress" | "hold" | "regress";

export interface VolumeGateInput {
  /** Worst shin NRS across completed sessions in the last 10 days; null if none reported. */
  recentShin: number | null;
  /** How many sessions were completed in that window at all. */
  completedInWindow: number;
  /**
   * Sprint 2.9: of those, how many carry a shin report — i.e. how many a human
   * actually attested to. The nightly Garmin import can complete a session
   * without anyone rating it, so "a session exists" stopped being the same
   * claim as "someone checked how it felt". Defaults to completedInWindow so
   * callers that predate the import keep their old behaviour.
   */
  attestedInWindow?: number;
  /** Most recent Garmin resting HR inside the freshness window; null if none. */
  latestRhr: number | null;
  /** The user's calibrated resting-HR baseline; null if never set. */
  baselineRhr: number | null;
}

export interface VolumeGateDecision {
  gate: VolumeGate;
  /** Why the gate landed where it did — surfaced in ops output and logs. */
  reason: string;
}

/**
 * Derive the graded run-volume gate:
 *   ≤2 → progress (full volume + threshold ladder)
 *   3  → hold     (threshold clamped to the 2×10 floor, volume normal)
 *   ≥4 → regress  (−20% run volume + quality day replaced by an easy run)
 *
 * Two things can only downgrade, never upgrade:
 *   - no completed session in the window at all → at best "hold". Unknown must
 *     never outrank confirmed-calm.
 *   - resting HR more than 5 bpm over baseline → progress downgrades to hold.
 *
 * Pure.
 */
export function deriveVolumeGate(input: VolumeGateInput): VolumeGateDecision {
  const { recentShin, completedInWindow, latestRhr, baselineRhr } = input;

  if (recentShin != null && recentShin >= 4) {
    return { gate: "regress", reason: `shin NRS ${recentShin} (≥4)` };
  }
  if (recentShin === 3) {
    return { gate: "hold", reason: "shin NRS 3" };
  }

  // The evidence test is about ATTESTED sessions, not rows. An auto-imported
  // session proves the athlete trained; it proves nothing about how the shin
  // felt. Counting it here would resurrect the exact Sprint 2.4 bug described
  // at the top of this file, just through a different door.
  const attested = input.attestedInWindow ?? completedInWindow;
  if (attested === 0) {
    return {
      gate: "hold",
      reason:
        completedInWindow === 0
          ? "no completed session in the last 10 days — readiness unknown"
          : `${completedInWindow} session(s) completed but none rated — wellbeing unknown`,
    };
  }

  const rhrElevated =
    latestRhr != null && baselineRhr != null && latestRhr > baselineRhr + 5;
  if (rhrElevated) {
    return {
      gate: "hold",
      reason: `resting HR ${latestRhr} over baseline ${baselineRhr}+5`,
    };
  }

  return { gate: "progress", reason: "shin calm, resting HR at baseline" };
}

// ── Sprint 3.4 (#28, C4): a layoff per discipline ──────────────────────────

/**
 * The comeback ramp per discipline. Until now one gap across all completed
 * sessions decided both ramps, so a strength pause during ongoing running
 * never reduced the strength loads (and vice versa).
 *
 *   - run ramp      ← gap since the last completed run
 *   - strength ramp ← gap since the last completed strength session
 *
 * Threshold (21 days) and factors (RAMP_BY_WEEK) are unchanged. A discipline
 * without any completed session in the history falls back to the global
 * result — detectLayoff reads an empty history as "no comeback" (onboarding),
 * and a strength-only past must not turn the first runs into a full block.
 * The export's layoff gaps stay global (build-export.ts).
 *
 * `extraStrengthDates` (coach, 27.11., #28 b): days of strength activities
 * the watch recorded but no session took (≥ 20 min, unlinked). They count as
 * strength training days, so an ad-hoc gym session keeps the strength ramp
 * away; they still complete no session.
 *
 * Pure.
 */
export function detectLayoffByDiscipline(
  completed: readonly { date: Date; type: string }[],
  today: Date,
  fallbackRestartWeekStart: Date | null,
  extraStrengthDates: readonly Date[] = [],
): { run: LayoffState; strength: LayoffState; global: LayoffState } {
  const global = detectLayoff(completed.map((w) => w.date), today, fallbackRestartWeekStart);
  const runDates = completed.filter((w) => isRunType(w.type)).map((w) => w.date);
  const strengthDates = [
    ...completed.filter((w) => isStrengthType(w.type)).map((w) => w.date),
    ...extraStrengthDates,
  ];
  return {
    run: runDates.length > 0 ? detectLayoff(runDates, today, fallbackRestartWeekStart) : global,
    strength:
      strengthDates.length > 0 ? detectLayoff(strengthDates, today, fallbackRestartWeekStart) : global,
    global,
  };
}
