// Build a run executedSession from a Garmin activity — Sprint 2.9.
//
// Extracted verbatim from POST /api/sessions/complete, which was the only place
// that knew how to turn a Garmin activity into a persisted session. The
// unattended auto-import needs the exact same payload; two copies of this would
// drift the moment one of them learned a new field.

import { getActivityDetail, getActivityHrZones } from "./activities";
import { mapGarminZonesToPolarizedTID } from "@/lib/coach-engine/hr-zones";
import {
  RunExecutedSessionSchema,
  StrengthExecutedSessionSchema,
} from "@/lib/coach-engine/types";

export interface ImportedRun {
  executedSession: unknown;
  durationActualMin: number;
  activityId: string;
}

/**
 * Fetch an activity and shape it into a validated run executedSession.
 *
 * `source` distinguishes who decided this session happened:
 *   "garmin_import" — a human picked this activity in the completion flow
 *   "garmin_auto"   — the nightly import matched it by workout id, unattended
 *
 * The distinction matters downstream: an auto-imported session carries no RPE
 * and no shin score, so it must not be counted as evidence that the athlete is
 * fine (see deriveVolumeGate).
 *
 * Throws on any Garmin failure — callers decide whether to fall back or skip.
 */
export async function buildRunImport(
  activityId: number,
  source: "garmin_import" | "garmin_auto" = "garmin_import",
): Promise<ImportedRun> {
  const detail = await getActivityDetail(activityId);
  // Best-effort: HR-time-in-zones lets /progress build TID from Garmin's own
  // buckets instead of approximating from splits.
  const garminHrZones = await getActivityHrZones(activityId);
  const polarizedTID = garminHrZones ? mapGarminZonesToPolarizedTID(garminHrZones) : null;

  const executedSession = RunExecutedSessionSchema.parse({
    type: "run",
    source,
    garminActivityId: activityId,
    startTimeLocal: detail.startTimeLocal,
    durationSec: detail.durationSec,
    distanceM: detail.distanceM,
    averagePaceSecPerKm: detail.averagePaceSecPerKm,
    averageHr: detail.averageHr,
    maxHr: detail.maxHr,
    elevationGainM: detail.elevationGainM,
    calories: detail.calories,
    splits: detail.splits.map((s) => ({
      splitNumber: s.splitNumber,
      distanceM: s.distanceM,
      durationSec: s.durationSec,
      paceSecPerKm: s.paceSecPerKm,
      averageHr: s.averageHr,
      maxHr: s.maxHr,
    })),
    garminHrZones,
    polarizedTID,
  });

  return {
    executedSession,
    durationActualMin: Math.max(1, Math.round(detail.durationSec / 60)),
    activityId: String(activityId),
  };
}

/**
 * Build a strength executedSession from a Garmin activity — Sprint 3.1.
 *
 * `exercises` is deliberately empty. Garmin does return per-set data for a
 * strength activity, but the athlete's own recordings show what it is worth: a
 * 110-minute session yielded nine "sets", four of them categorised UNKNOWN, and
 * not one carrying a weight. Writing that into ExerciseLog would put noise into
 * the training-max evaluation, which is the one place a wrong number does real
 * damage. Duration, HR and calories are trustworthy and are all we take.
 *
 * The sets come later, from the athlete, via /confirm.
 */
export async function buildStrengthImport(
  activityId: number,
  // Sprint 3.2a: "garmin_import" when the athlete picked the activity in /confirm.
  source: "garmin_auto" | "garmin_import" = "garmin_auto",
): Promise<ImportedRun> {
  const detail = await getActivityDetail(activityId);
  const durationActualMin = Math.max(1, Math.round(detail.durationSec / 60));

  const executedSession = StrengthExecutedSessionSchema.parse({
    type: "strength",
    source,
    garminActivityId: activityId,
    startTimeLocal: detail.startTimeLocal,
    durationActualMin,
    exercises: [],
    averageHr: detail.averageHr,
    maxHr: detail.maxHr,
    calories: detail.calories,
  });

  return { executedSession, durationActualMin, activityId: String(activityId) };
}
