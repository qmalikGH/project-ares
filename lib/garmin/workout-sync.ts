// Garmin Workout Sync (Sprint v0.9) — I/O wrapper that pushes a built
// GarminStructuredWorkout to Garmin Connect, schedules it for a date, and
// stores the resulting IDs on the Workout DB row for future replace/remove.
//
// All calls are best-effort: a Garmin outage (or auth break — they re-do
// auth a couple times per year) writes garminPushStatus="failed" + error
// message and never throws. Cron/UI callers stay green even on full Garmin
// downtime — the in-app plan is unaffected.
//
// Idempotent: pushing the same workoutDbId twice deletes the previous
// Garmin workout + reschedule before creating a new one.
import { db } from "@/lib/db/client";
import { toUserDateString } from "@/lib/date";
import { getGarminClient } from "./client";
import {
  buildGarminWorkout,
  type GarminStructuredWorkout,
  type VdotPaceLookup,
} from "./workout-builder";
import type { SessionPlan } from "@/lib/coach-engine/types";

const GC_API = "https://connectapi.garmin.com";

interface RawHttpClient {
  get: <T>(url: string) => Promise<T>;
  post: <T>(url: string, data?: unknown) => Promise<T>;
  delete: <T>(url: string) => Promise<T>;
}

interface GarminLikeClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addWorkout: (workout: any) => Promise<{ workoutId?: number | string }>;
  deleteWorkout: (args: { workoutId: number | string }) => Promise<unknown>;
}

function rawClientFor(client: unknown): RawHttpClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  const raw: RawHttpClient = c.client ?? c._client ?? c.http;
  if (
    !raw ||
    typeof raw.get !== "function" ||
    typeof raw.post !== "function"
  ) {
    throw new Error(
      "GarminConnect raw HTTP client (post/delete) not accessible — lib version mismatch?",
    );
  }
  return raw;
}

export interface PushResult {
  pushed: boolean;
  garminWorkoutId?: string;
  garminScheduledWorkoutId?: string;
  scheduledAt?: string;
  error?: string;
  /** Why the push was skipped before any HTTP call. */
  skipReason?: "non_pushable_session" | "missing_hr_target";
}

function dayKeyForGarmin(date: Date): string {
  // Garmin's schedule endpoint accepts YYYY-MM-DD in user's local TZ.
  // Must use Berlin date, not UTC — at 22:00+ UTC the UTC date is one day
  // behind Berlin, which would schedule the workout for the wrong day.
  return toUserDateString(date);
}

/**
 * Push a SessionPlan to Garmin as a structured workout, scheduled for `scheduledDate`.
 *
 * Idempotent: if `workoutDbId` already has a `garminWorkoutId` / `garminScheduledWorkoutId`,
 * the previous push is unscheduled + deleted before creating the new one.
 *
 * Best-effort: every error is captured into garminPushStatus / garminPushError
 * on the Workout row; the function never throws.
 */
export async function pushWorkoutToGarmin(
  workoutDbId: string,
  session: SessionPlan,
  paces: VdotPaceLookup,
  scheduledDate: Date,
): Promise<PushResult> {
  const garminWorkout = buildGarminWorkout(session, paces);
  if (!garminWorkout) {
    if (!session.hrTarget) {
      return { pushed: false, skipReason: "missing_hr_target" };
    }
    return { pushed: false, skipReason: "non_pushable_session" };
  }

  // Capture existing references before mutating
  const existing = await db.workout.findUnique({
    where: { id: workoutDbId },
    select: {
      garminWorkoutId: true,
      garminScheduledWorkoutId: true,
    },
  });

  try {
    const client = (await getGarminClient()) as unknown as GarminLikeClient;
    const raw = rawClientFor(client);

    // Replace path: best-effort cleanup of prior push.
    if (existing?.garminScheduledWorkoutId) {
      try {
        await raw.delete(
          `${GC_API}/workout-service/schedule/${existing.garminScheduledWorkoutId}`,
        );
      } catch (e) {
        console.warn("[garmin-sync] unschedule prior failed:", e);
      }
    }
    if (existing?.garminWorkoutId) {
      try {
        await client.deleteWorkout({ workoutId: existing.garminWorkoutId });
      } catch (e) {
        console.warn("[garmin-sync] delete prior failed:", e);
      }
    }

    // Create the workout. The lib's addWorkout accepts our IWorkoutDetail-shaped
    // JSON via the non-Running branch (it strips workoutId/createdDate/etc).
    const created = await client.addWorkout(
      garminWorkout as unknown as Record<string, unknown>,
    );
    const newWorkoutId = String(created.workoutId ?? "");
    if (!newWorkoutId) {
      throw new Error("addWorkout response missing workoutId");
    }

    // Schedule via raw HTTP — `garmin-connect` lib doesn't expose schedule.
    const dayKey = dayKeyForGarmin(scheduledDate);
    const scheduled = await raw.post<{ id?: number; scheduledWorkoutId?: number }>(
      `${GC_API}/workout-service/schedule/${newWorkoutId}`,
      { date: dayKey },
    );
    const scheduledWorkoutId = String(
      scheduled.scheduledWorkoutId ?? scheduled.id ?? "",
    );

    await db.workout.update({
      where: { id: workoutDbId },
      data: {
        garminWorkoutId: newWorkoutId,
        garminScheduledWorkoutId: scheduledWorkoutId || null,
        garminScheduledAt: new Date(),
        garminPushStatus: "synced",
        garminPushError: null,
      },
    });

    return {
      pushed: true,
      garminWorkoutId: newWorkoutId,
      garminScheduledWorkoutId: scheduledWorkoutId || undefined,
      scheduledAt: dayKey,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[garmin-sync] push failed:", e);

    try {
      await db.workout.update({
        where: { id: workoutDbId },
        data: {
          garminPushStatus: "failed",
          garminPushError: msg.slice(0, 500),
        },
      });
    } catch {
      /* DB update best-effort too */
    }

    return { pushed: false, error: msg };
  }
}

/**
 * Remove a previously pushed workout from Garmin (used when /today auto-adjusts
 * to a non-pushable session, or when Q manually skips the workout).
 * Best-effort. Never throws.
 */
export async function removeWorkoutFromGarmin(
  workoutDbId: string,
): Promise<{ removed: boolean; error?: string }> {
  const w = await db.workout.findUnique({
    where: { id: workoutDbId },
    select: { garminWorkoutId: true, garminScheduledWorkoutId: true },
  });
  if (!w?.garminWorkoutId) {
    return { removed: false };
  }

  try {
    const client = (await getGarminClient()) as unknown as GarminLikeClient;
    const raw = rawClientFor(client);

    if (w.garminScheduledWorkoutId) {
      try {
        await raw.delete(
          `${GC_API}/workout-service/schedule/${w.garminScheduledWorkoutId}`,
        );
      } catch (e) {
        console.warn("[garmin-sync] unschedule failed:", e);
      }
    }
    try {
      await client.deleteWorkout({ workoutId: w.garminWorkoutId });
    } catch (e) {
      console.warn("[garmin-sync] delete failed:", e);
    }

    await db.workout.update({
      where: { id: workoutDbId },
      data: {
        garminWorkoutId: null,
        garminScheduledWorkoutId: null,
        garminScheduledAt: null,
        garminPushStatus: "removed",
        garminPushError: null,
      },
    });

    return { removed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[garmin-sync] remove failed:", e);
    return { removed: false, error: msg };
  }
}

// ============================================
// Garmin Re-Sync (Sprint v0.10)
// ============================================

import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import { getEffectiveVdot } from "@/lib/db/queries/settings";

export interface ResyncResult {
  /** Total future workouts considered. */
  considered: number;
  /** Number that were unscheduled+deleted from Garmin (orphaned by plan change). */
  removed: number;
  /** Number that were (re-)pushed with the new plan. */
  repushed: number;
  /** Per-workout error messages for failures. */
  errors: string[];
}

// Internal deps interface — exposed for tests so we can inject fakes
// without intercepting intra-module calls (which vi.spyOn can't reach in ESM).
export interface ResyncDeps {
  push: typeof pushWorkoutToGarmin;
  remove: typeof removeWorkoutFromGarmin;
}

const DEFAULT_RESYNC_DEPS: ResyncDeps = {
  push: pushWorkoutToGarmin,
  remove: removeWorkoutFromGarmin,
};

/**
 * Re-sync all future workouts to Garmin after a plan regeneration (Sprint v0.10).
 *
 * For every Workout row with date >= cutoff (typically "today midnight"):
 *   - If new plannedSession.type is "rest" but a Garmin workout exists for it:
 *     remove from Garmin (the day was a workout, now it's rest).
 *   - Else: pushWorkoutToGarmin (idempotent — replaces prior push, or creates
 *     a fresh one if no garminWorkoutId yet).
 *
 * Best-effort: per-workout failures are captured into result.errors but the
 * loop continues. Skipped entirely when garminWorkoutPushEnabled is false.
 *
 * `deps` is for tests; production callers pass nothing and get the live
 * pushWorkoutToGarmin/removeWorkoutFromGarmin.
 */
export async function resyncFutureWorkoutsToGarmin(
  userId: string,
  cutoffDate: Date,
  deps: ResyncDeps = DEFAULT_RESYNC_DEPS,
): Promise<ResyncResult> {
  const result: ResyncResult = {
    considered: 0,
    removed: 0,
    repushed: 0,
    errors: [],
  };

  const userSettings = await db.userSettings.findUnique({ where: { userId } });
  if (!userSettings?.garminWorkoutPushEnabled) return result;

  // Skip already-completed rows: re-pushing a finished workout would replace
  // the Garmin schedule entry the user has already executed against, and the
  // resulting orphaned planned/completed split is what users see as duplicates.
  const futureWorkouts = await db.workout.findMany({
    where: {
      userId,
      date: { gte: cutoffDate },
      status: { not: "completed" },
    },
    orderBy: { date: "asc" },
  });

  result.considered = futureWorkouts.length;
  if (futureWorkouts.length === 0) return result;

  const effectiveVdot = await getEffectiveVdot(userId);
  let paces;
  try {
    paces = vdotToPaces(effectiveVdot);
  } catch (e) {
    result.errors.push(
      `vdotToPaces(${effectiveVdot}) failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return result;
  }

  for (const workout of futureWorkouts) {
    try {
      const session = workout.plannedSession as unknown as SessionPlan;
      const sessionType = session?.type;

      if (workout.garminWorkoutId && sessionType === "rest") {
        // Was pushed but is now a rest day → unschedule + delete.
        const r = await deps.remove(workout.id);
        if (r.removed) result.removed += 1;
        if (r.error) result.errors.push(`${workout.id}: ${r.error}`);
        continue;
      }

      if (sessionType === "rest") {
        // No prior push, still rest — nothing to do.
        continue;
      }

      // Push (idempotent: pushWorkoutToGarmin replaces existing if any).
      const pushResult = await deps.push(
        workout.id,
        session,
        paces,
        workout.date,
      );
      if (pushResult.pushed) {
        result.repushed += 1;
        // pushWorkoutToGarmin internally deletes the prior workout, count it.
        if (workout.garminWorkoutId) result.removed += 1;
      } else if (pushResult.error) {
        result.errors.push(`${workout.id}: ${pushResult.error}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      result.errors.push(
        `${workout.id} (${workout.date.toISOString().slice(0, 10)}): ${msg}`,
      );
      console.error("[garmin-resync] error:", e);
    }
  }

  return result;
}
