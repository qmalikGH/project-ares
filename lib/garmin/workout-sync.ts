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
  // We use the UTC slice — close enough for vorabend pushes (cron at 21:00 Berlin).
  return date.toISOString().slice(0, 10);
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
