// Unattended session import from Garmin — Sprint 2.9.
//
// WHY THIS EXISTS
//
// The athlete trains but never opens the completion wizard. Between 2026-08-13
// and 2026-08-29 exactly 2 of 24 sessions were recorded, while Garmin held full
// data for every one of them. Four feedback loops sat idle waiting for a tap:
// the volume gate, the TDEE calibration, the layoff detector and the VDOT
// recalibration.
//
// WHAT IT WILL AND WILL NOT DO
//
// It writes a session ONLY on an identity match: the activity carries the very
// `workoutId` we pushed to the watch. "One run of the right category that day"
// is a fine suggestion for a human looking at a picker and far too weak to
// write unattended — the athlete regularly records an extra ad-hoc run on the
// same day, and those carry no workoutId at all.
//
// It cannot produce an RPE or a shin score. That is not a gap to paper over:
// `deriveVolumeGate` must keep treating these sessions as "trained, wellbeing
// unknown", which is why the payload is stamped source "garmin_auto".

import { db } from "@/lib/db/client";
import { listActivitiesForDate } from "./activities";
import { matchSessionToActivity } from "./match";
import { buildRunImport, buildStrengthImport } from "./run-import";
import type { SessionType } from "@/lib/coach-engine/types";

export interface AutoImportEntry {
  workoutId: string;
  date: string;
  type: string;
  activityId: number;
  durationActualMin: number;
}

export interface AutoImportResult {
  imported: AutoImportEntry[];
  /** Sessions with a plausible candidate that was NOT an identity match. */
  needsConfirmation: { workoutId: string; date: string; type: string; reason: string }[];
  errors: string[];
}

/**
 * Import every planned session for `date` that Garmin can prove happened.
 *
 * Only `status: "planned"` rows are considered — a completed or skipped session
 * is a decision already made, and `materializeWorkouts` treats completed rows as
 * immutable anyway.
 */
export async function autoImportSessionsForDate(
  userId: string,
  date: Date,
): Promise<AutoImportResult> {
  const result: AutoImportResult = { imported: [], needsConfirmation: [], errors: [] };

  const workouts = await db.workout.findMany({
    where: { userId, date, status: "planned" },
    select: { id: true, date: true, type: true, garminWorkoutId: true },
  });
  if (workouts.length === 0) return result;

  let activities;
  try {
    activities = await listActivitiesForDate(date);
  } catch (e) {
    result.errors.push(`listActivities: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  if (activities.length === 0) return result;

  for (const workout of workouts) {
    const match = matchSessionToActivity(
      workout.type as SessionType,
      activities,
      workout.garminWorkoutId,
    );

    if (match.status !== "EXACT_MATCH" || !match.bestMatch) {
      // Surfaced, not acted on. A human decides these in the confirmation screen.
      if (match.status === "AUTO_MATCH" || match.status === "PICKER_NEEDED") {
        result.needsConfirmation.push({
          workoutId: workout.id,
          date: workout.date.toISOString().slice(0, 10),
          type: workout.type,
          reason: match.status === "AUTO_MATCH"
            ? "candidate found, but no workout-id link (ad-hoc activity or unpushed session)"
            : "several candidates that day",
        });
      }
      continue;
    }

    const activity = match.bestMatch;
    try {
      // Sprint 3.1: strength is pushed too now, so an EXACT_MATCH is no longer
      // necessarily a run. A strength activity gets a strength payload with no
      // sets — the watch cannot report a usable load, and inventing one would
      // feed the training-max evaluation.
      const isStrength = workout.type.startsWith("strength");
      const run = isStrength
        ? await buildStrengthImport(activity.activityId)
        : await buildRunImport(activity.activityId, "garmin_auto");
      await db.workout.update({
        where: { id: workout.id },
        data: {
          status: "completed",
          executedSession: run.executedSession as object,
          garminActivityId: run.activityId,
          durationActualMin: run.durationActualMin,
          // rpe stays null on purpose — nobody rated this session, and a
          // fabricated value would feed ACWR and the training-max evaluation.
          updatedAt: new Date(),
        },
      });
      result.imported.push({
        workoutId: workout.id,
        date: workout.date.toISOString().slice(0, 10),
        type: workout.type,
        activityId: activity.activityId,
        durationActualMin: run.durationActualMin,
      });
    } catch (e) {
      result.errors.push(
        `${workout.type} ${workout.date.toISOString().slice(0, 10)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return result;
}

/**
 * Sweep a window of recent days. The nightly cron runs this over the days it
 * may have missed; a one-off backfill runs it over a longer window.
 */
export async function autoImportRecent(
  userId: string,
  endDate: Date,
  days: number,
): Promise<AutoImportResult> {
  const merged: AutoImportResult = { imported: [], needsConfirmation: [], errors: [] };
  for (let i = 0; i < days; i++) {
    const day = new Date(endDate.getTime() - i * 86400000);
    const r = await autoImportSessionsForDate(userId, day);
    merged.imported.push(...r.imported);
    merged.needsConfirmation.push(...r.needsConfirmation);
    merged.errors.push(...r.errors);
  }
  return merged;
}
