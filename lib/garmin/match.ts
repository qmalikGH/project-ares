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

/**
 * Sprint 2.9: EXACT_MATCH is new and is the only status the unattended
 * auto-import acts on. It means the activity carries the very workout id we
 * pushed to the watch, so the link is an identity, not an inference.
 * AUTO_MATCH stays what it always was — "exactly one activity of the right
 * category that day" — which is a good enough suggestion for a human staring
 * at a picker, and far too weak to write to the database unattended.
 */
export type MatchStatus =
  | "EXACT_MATCH"
  | "AUTO_MATCH"
  | "PICKER_NEEDED"
  | "NO_CANDIDATES";

export interface MatchResult {
  status: MatchStatus;
  bestMatch: ActivitySummary | null;
  candidates: ActivitySummary[];
}

/**
 * - activity.workoutId === pushedWorkoutId → EXACT_MATCH (identity, not a guess)
 * - 0 candidates of correct category → NO_CANDIDATES
 * - 1 candidate → AUTO_MATCH
 * - 2+ candidates → PICKER_NEEDED, sorted ASC by start time so the morning run
 *   is presented first.
 *
 * `pushedWorkoutId` is Workout.garminWorkoutId. It is only set for sessions we
 * actually pushed (runs today; strength once the strength builder lands), and
 * only runs started FROM that pushed workout echo it back — so a spontaneous
 * run on the same day cannot be mistaken for the planned one.
 */
export function matchSessionToActivity(
  sessionType: SessionType,
  candidates: ActivitySummary[],
  pushedWorkoutId?: string | null,
): MatchResult {
  const expectedCategory = sessionTypeToCategory(sessionType);
  if (!expectedCategory) {
    return { status: "NO_CANDIDATES", bestMatch: null, candidates: [] };
  }

  // Identity first. Deliberately NOT restricted to the expected category: if the
  // watch says this activity came from that workout, believe it — a mismatch
  // there is a classification problem on our side, not evidence against the id.
  if (pushedWorkoutId) {
    const exact = candidates.filter(
      (c) => c.workoutId != null && String(c.workoutId) === String(pushedWorkoutId),
    );
    if (exact.length === 1) {
      return { status: "EXACT_MATCH", bestMatch: exact[0], candidates: exact };
    }
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
