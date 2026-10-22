// Sprint v1.6 — Workout-Row Materialisierung.
//
// Reads WeeklyPlan.plannedSessions (SessionPlan[]) and upserts Workout rows
// so the Garmin-Push cron and session-start flow always find them.
//
// Called by:
//   - POST /api/debug/regenerate-from-now  (after plan regeneration)
//   - resetBlock in coaching-update         (after creating fresh WeeklyPlan rows)
//   - GET /api/cron/garmin-workout-push     (fallback when 0 rows found)
//
// Critical invariant: NEVER overwrite status on completed/skipped workouts.
// Only planned-status rows are updated.

import { db } from "@/lib/db/client";
import type { SessionPlan } from "@/lib/coach-engine/types";

export interface MaterializeResult {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Materialize Workout rows from WeeklyPlan.plannedSessions for the given
 * date window. Sessions of type "rest" are skipped.
 *
 * @param userId  — the user
 * @param fromDate — start of window (inclusive). Default: now.
 * @param toDate   — end of window (exclusive). Default: +60 days.
 */
export interface MaterializeOptions {
  /**
   * Sprint 3.3: called for every orphaned row that was pushed to Garmin, BEFORE
   * the row is deleted. Without it the watch keeps a workout no row points to —
   * the Karteileiche mechanism behind the 09.08. and 04.10. clean-ups. Callers
   * that push pass removeWorkoutFromGarmin; best-effort, failures are ignored.
   */
  removeFromGarmin?: (workoutId: string) => Promise<unknown>;
}

export async function materializeWorkouts(
  userId: string,
  fromDate?: Date,
  toDate?: Date,
  opts: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const from = fromDate ?? new Date();
  const to = toDate ?? new Date(Date.now() + 60 * 86400000);

  // 1. Load WeeklyPlan rows that overlap the window.
  const weeklyPlans = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      AND: [
        { startDate: { lt: to } },
        { endDate: { gt: from } },
      ],
    },
    orderBy: { startDate: "asc" },
  });

  // 2. Flatten all SessionPlan entries, skip rest + out-of-window.
  const planned: Array<{ date: Date; type: string; session: SessionPlan }> = [];
  for (const wp of weeklyPlans) {
    const sessions = (wp.plannedSessions as unknown as SessionPlan[]) ?? [];
    for (const raw of sessions) {
      const sDate =
        raw.date instanceof Date
          ? raw.date
          : new Date(raw.date as unknown as string);
      if (raw.type === "rest") continue;
      if (sDate < from || sDate >= to) continue;
      planned.push({
        date: sDate,
        type: raw.type,
        session: { ...raw, date: sDate },
      });
    }
  }

  // 3. Upsert each session → Workout row.
  //    Uses the @@unique([userId, date, type]) constraint from Sprint v1.6.
  let created = 0;
  let updated = 0;

  for (const pw of planned) {
    const existing = await db.workout.findUnique({
      where: {
        userId_date_type: {
          userId,
          date: pw.date,
          type: pw.type,
        },
      },
    });

    if (!existing) {
      await db.workout.create({
        data: {
          userId,
          date: pw.date,
          type: pw.type,
          plannedSession: pw.session as unknown as object,
          status: "planned",
        },
      });
      created++;
    } else if (existing.status === "planned") {
      await db.workout.update({
        where: { id: existing.id },
        data: { plannedSession: pw.session as unknown as object },
      });
      updated++;
    }
    // completed / skipped / in_progress → do NOT touch
  }

  // 4. Delete orphaned planned-only Workout rows that are no longer in any
  //    WeeklyPlan (e.g. schedule change removed a session).
  const plannedKeys = new Set(
    planned.map((p) => `${p.date.toISOString()}_${p.type}`),
  );
  const existingPlanned = await db.workout.findMany({
    where: {
      userId,
      status: "planned",
      date: { gte: from, lt: to },
    },
  });
  const orphans = existingPlanned.filter(
    (w) => !plannedKeys.has(`${w.date.toISOString()}_${w.type}`),
  );
  let deleted = 0;
  if (orphans.length > 0) {
    if (opts.removeFromGarmin) {
      for (const o of orphans) {
        if (!o.garminWorkoutId) continue;
        try {
          await opts.removeFromGarmin(o.id);
        } catch (e) {
          console.warn("[materialize] Garmin cleanup of orphan failed:", e);
        }
      }
    }
    await db.workout.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
    deleted = orphans.length;
  }

  return { created, updated, deleted };
}
