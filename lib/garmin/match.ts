// Pure: match a planned SessionType to candidate Garmin activities.
// No I/O. Easy to unit-test.
import type { SessionType } from "@/lib/coach-engine/types";
import type { ActivityCategory, ActivitySummary } from "./activities";

const RUN_SESSION_TYPES: ReadonlySet<SessionType> = new Set([
  "easy_run",
  "threshold_run",
  "tempo_run",
  "vo2max_intervals",
  "long_run",
  "calibration_run",
  "time_trial_5k",
]);

const STRENGTH_SESSION_TYPES: ReadonlySet<SessionType> = new Set([
  "strength_a",
  "strength_b",
  "strength_c",
]);

export function sessionTypeToCategory(
  sessionType: SessionType,
): ActivityCategory | null {
  if (RUN_SESSION_TYPES.has(sessionType)) return "run";
  if (STRENGTH_SESSION_TYPES.has(sessionType)) return "strength";
  return null;
}

export type MatchStatus = "AUTO_MATCH" | "PICKER_NEEDED" | "NO_CANDIDATES";

export interface MatchResult {
  status: MatchStatus;
  bestMatch: ActivitySummary | null;
  candidates: ActivitySummary[];
}

/**
 * - 0 candidates of correct category → NO_CANDIDATES
 * - 1 candidate → AUTO_MATCH
 * - 2+ candidates → PICKER_NEEDED, sorted ASC by start time so the morning run
 *   is presented first.
 */
export function matchSessionToActivity(
  sessionType: SessionType,
  candidates: ActivitySummary[],
): MatchResult {
  const expectedCategory = sessionTypeToCategory(sessionType);
  if (!expectedCategory) {
    return { status: "NO_CANDIDATES", bestMatch: null, candidates: [] };
  }

  const matching = candidates.filter((c) => c.category === expectedCategory);
  if (matching.length === 0) {
    return { status: "NO_CANDIDATES", bestMatch: null, candidates: [] };
  }
  if (matching.length === 1) {
    return { status: "AUTO_MATCH", bestMatch: matching[0], candidates: matching };
  }

  const sorted = [...matching].sort(
    (a, b) =>
      new Date(a.startTimeLocal).getTime() - new Date(b.startTimeLocal).getTime(),
  );
  return { status: "PICKER_NEEDED", bestMatch: sorted[0], candidates: sorted };
}
