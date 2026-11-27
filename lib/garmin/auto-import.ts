// Unattended session import from Garmin — Sprint 2.9, rebuilt in Sprint 3.4.
//
// WHY THIS EXISTS
//
// The athlete trains but rarely opens the app. Sprint 3.4 (#28) makes starting
// the watch the only thing he has to do: everything the watch records lands in
// the database and counts.
//
// SOURCE
//
// GarminActivity — the raw store the cron fills first (activity-store.ts).
// Only activities that are not linked yet, inside the window. No Garmin call
// happens here: the executedSession is built from the stored row.
//
// THREE PASSES, strictest first
//
//   1. identity — the activity carries the workoutId we pushed to the watch
//      (activity.workoutId === Workout.garminWorkoutId), same local day.
//      Any session type, strength included.
//   2. same day — a run of ≥ 10 min on the day of an OPEN easy_run or
//      long_run completes it, even without a pushed workout; the longest run
//      of the day wins. NEVER for threshold, VO2max or a time trial: quality
//      only counts through identity or a human — who can claim the free run
//      the cron made of it (/confirm, autoMatch "claimed"). (That is
//      also why the threshold ladder needs no extra guard: it only credits
//      completed threshold_run rows, and passes 2 and 3 never create one.)
//   3. free run — any other run of ≥ 15 min becomes its own completed
//      easy_run (`plannedSession.unplanned: true`), like the "Freier Lauf"
//      form. Shorter runs stay raw data.
//
// RULES (from #28)
//
//   - No ±1-day matching. A run on the wrong day is a free run; the planned
//     session stays open. Honest, and no mis-assignments.
//   - A second run on a day that already has an easy run collides with
//     @@unique([userId, date, type]) and stays raw data — not an error.
//   - Idempotent: a parallel /confirm that linked the same activity first
//     makes ours fail with P2002 on @@unique([userId, garminActivityId]);
//     that is skipped, not reported.
//   - Unmatched strength activities stay raw data.
//   - No RPE, no shin score: nobody rated these sessions. `source` stays
//     "garmin_auto", so deriveVolumeGate keeps treating them as "trained,
//     wellbeing unknown".
import type { GarminActivity } from "@prisma/client";

import { db } from "@/lib/db/client";
import type { AutoMatch } from "@/lib/coach-engine/types";
import { createFreeRunWorkout } from "@/lib/sessions/free-run";
import { runImportFromStored, strengthImportFromStored } from "./run-import";

/** Pass 3: a run shorter than this stays raw data (coach decision, #28). */
export const FREE_RUN_MIN_SEC = 15 * 60;
/**
 * Pass 2: a run shorter than this does not complete a planned session, so an
 * accidentally started recording cannot (coach, 27.11.). Identity has no
 * minimum — that run was started from the pushed workout on purpose.
 */
export const SAME_DAY_RUN_MIN_SEC = 10 * 60;
/** Pass 2 may complete only these session types. */
export const SAME_DAY_TYPES: readonly string[] = ["long_run", "easy_run"];
/**
 * Review fix (#28): a run whose splits and HR zones have not been fetched yet
 * waits this many days before it is linked anyway. Linking writes the
 * executedSession once; details that arrive later would never reach it (no
 * zone load for ACWR, no TID). After the grace period a run without details
 * is still better than no session at all.
 */
export const DETAILS_GRACE_DAYS = 3;

export interface AutoImportEntry {
  workoutId: string;
  date: string;
  type: string;
  activityId: string;
  durationActualMin: number;
  match: AutoMatch;
}

export interface AutoImportResult {
  imported: AutoImportEntry[];
  /** Activities that stay raw data, with the reason (counts only in logs). */
  rawOnly: { activityId: string; date: string; reason: string }[];
  /** Workouts linked before the raw store existed, now reconciled. */
  reconciled: number;
  errors: string[];
}

type Planned = { id: string; date: Date; type: string; garminWorkoutId: string | null };

function key(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

class NotPlannedAnymore extends Error {}

/**
 * Link stored, unlinked activities in [from, to] (local dates, inclusive) to
 * sessions. The cron runs it over the last 14 days; the one-off
 * link-since-restart script over the time since the block restart.
 */
export async function autoImportFromStore(
  userId: string,
  window: { from: Date; to: Date },
  opts: {
    /**
     * Report what would be linked without writing (scripts/import-sessions.ts).
     * Collisions are predicted from the easy runs already stored.
     */
    dryRun?: boolean;
    /** The user's local today (UTC midnight); for the details grace period. */
    today?: Date;
  } = {},
): Promise<AutoImportResult> {
  const dryRun = opts.dryRun === true;
  const todayKey = opts.today ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const result: AutoImportResult = { imported: [], rawOnly: [], reconciled: 0, errors: [] };

  let pool: GarminActivity[] = await db.garminActivity.findMany({
    where: { userId, workoutRefId: null, localDate: { gte: window.from, lte: window.to } },
    orderBy: [{ localDate: "asc" }, { startTimeLocal: "asc" }],
  });
  if (pool.length === 0) return result;

  // Sessions linked before the raw store existed carry the activity id but the
  // activity has no workoutRefId yet. Reconcile instead of matching again.
  const legacy = await db.workout.findMany({
    where: { userId, garminActivityId: { in: pool.map((a) => a.activityId) } },
    select: { id: true, garminActivityId: true },
  });
  if (legacy.length > 0) {
    const byActivity = new Map(legacy.map((w) => [w.garminActivityId as string, w.id]));
    for (const a of pool) {
      const workoutId = byActivity.get(a.activityId);
      if (!workoutId) continue;
      if (!dryRun) await db.garminActivity.update({ where: { id: a.id }, data: { workoutRefId: workoutId } });
      result.reconciled++;
    }
    pool = pool.filter((a) => !byActivity.has(a.activityId));
  }

  const planned: Planned[] = await db.workout.findMany({
    where: { userId, status: "planned", date: { gte: window.from, lte: window.to } },
    select: { id: true, date: true, type: true, garminWorkoutId: true },
  });
  const usedWorkouts = new Set<string>();
  const usedActivities = new Set<string>();

  // Review fix (#28): runs without details wait (all three passes), unless
  // they are older than the grace period. Strength and "other" need none.
  for (const a of pool) {
    if (a.category !== "run" || a.detailFetchedAt != null) continue;
    const ageDays = Math.round((todayKey.getTime() - a.localDate.getTime()) / 86400000);
    if (ageDays > DETAILS_GRACE_DAYS) continue;
    usedActivities.add(a.id);
    result.rawOnly.push({ activityId: a.activityId, date: key(a.localDate), reason: "details_pending" });
  }

  const linkPlanned = async (w: Planned, a: GarminActivity, match: AutoMatch) => {
    const isStrength = w.type.startsWith("strength");
    if (dryRun) {
      usedWorkouts.add(w.id);
      usedActivities.add(a.id);
      result.imported.push({
        workoutId: w.id,
        date: key(w.date),
        type: w.type,
        activityId: a.activityId,
        durationActualMin: Math.max(1, Math.round(a.durationSec / 60)),
        match,
      });
      return;
    }
    try {
      const imp = isStrength
        ? strengthImportFromStored(a, "garmin_auto", match)
        : runImportFromStored(a, "garmin_auto", match);
      await db.$transaction(async (tx) => {
        // Only a still-open session: /confirm may have closed it meanwhile.
        const res = await tx.workout.updateMany({
          where: { id: w.id, status: "planned" },
          data: {
            status: "completed",
            executedSession: imp.executedSession as object,
            garminActivityId: imp.activityId,
            durationActualMin: imp.durationActualMin,
            // rpe stays null on purpose — nobody rated this session, and a
            // fabricated value would feed ACWR and the training-max evaluation.
            updatedAt: new Date(),
          },
        });
        if (res.count !== 1) throw new NotPlannedAnymore();
        await tx.garminActivity.update({ where: { id: a.id }, data: { workoutRefId: w.id } });
      });
      usedWorkouts.add(w.id);
      usedActivities.add(a.id);
      result.imported.push({
        workoutId: w.id,
        date: key(w.date),
        type: w.type,
        activityId: a.activityId,
        durationActualMin: imp.durationActualMin,
        match,
      });
    } catch (e) {
      if (e instanceof NotPlannedAnymore) {
        usedWorkouts.add(w.id);
        return;
      }
      if (isP2002(e)) {
        usedActivities.add(a.id);
        result.rawOnly.push({ activityId: a.activityId, date: key(a.localDate), reason: "already_linked" });
        return;
      }
      result.errors.push(`${w.type} ${key(w.date)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Pass 1: identity ────────────────────────────────────────────────────
  for (const w of planned) {
    if (!w.garminWorkoutId) continue;
    const exact = pool
      .filter((a) => !usedActivities.has(a.id))
      .filter((a) => a.workoutId === w.garminWorkoutId && key(a.localDate) === key(w.date))
      .sort((x, y) => y.durationSec - x.durationSec);
    if (exact.length > 0) await linkPlanned(w, exact[0], "identity");
  }

  // ── Pass 2: same day, easy and long runs only ──────────────────────────
  const openByDay = new Map<string, Planned[]>();
  for (const w of planned) {
    if (usedWorkouts.has(w.id) || !SAME_DAY_TYPES.includes(w.type)) continue;
    openByDay.set(key(w.date), [...(openByDay.get(key(w.date)) ?? []), w]);
  }
  for (const [day, sessions] of openByDay) {
    // The long run first, so it gets the longest run of the day.
    sessions.sort((x, y) => SAME_DAY_TYPES.indexOf(x.type) - SAME_DAY_TYPES.indexOf(y.type));
    for (const w of sessions) {
      // The longest run of the day wins (coach, 27.11.).
      const run = pool
        .filter((a) => !usedActivities.has(a.id) && a.category === "run" && key(a.localDate) === day)
        .filter((a) => a.durationSec >= SAME_DAY_RUN_MIN_SEC)
        .sort((x, y) => y.durationSec - x.durationSec)[0];
      if (!run) break;
      await linkPlanned(w, run, "same_day");
    }
  }

  // ── Pass 3: free runs ───────────────────────────────────────────────────
  // Only the dry run needs this: a real run learns about a collision from P2002.
  const easyRunDays = new Set<string>();
  if (dryRun) {
    const easy = await db.workout.findMany({
      where: { userId, type: "easy_run", date: { gte: window.from, lte: window.to } },
      select: { date: true },
    });
    for (const w of easy) easyRunDays.add(key(w.date));
  }
  for (const a of pool) {
    if (usedActivities.has(a.id)) continue;
    if (a.category !== "run") {
      result.rawOnly.push({ activityId: a.activityId, date: key(a.localDate), reason: `unmatched_${a.category}` });
      continue;
    }
    if (a.durationSec < FREE_RUN_MIN_SEC) {
      result.rawOnly.push({ activityId: a.activityId, date: key(a.localDate), reason: "under_15_min" });
      continue;
    }
    if (dryRun) {
      if (easyRunDays.has(key(a.localDate))) {
        result.rawOnly.push({ activityId: a.activityId, date: key(a.localDate), reason: "collision" });
      } else {
        easyRunDays.add(key(a.localDate));
        usedActivities.add(a.id);
        result.imported.push({
          workoutId: "(dry run)",
          date: key(a.localDate),
          type: "easy_run",
          activityId: a.activityId,
          durationActualMin: Math.max(1, Math.round(a.durationSec / 60)),
          match: "free_run",
        });
      }
      continue;
    }
    try {
      const imp = runImportFromStored(a, "garmin_auto", "free_run");
      const workout = await db.$transaction(async (tx) => {
        const w = await createFreeRunWorkout(tx, {
          userId,
          date: a.localDate,
          durationActualMin: imp.durationActualMin,
          executedSession: imp.executedSession,
          rpe: null,
          garminActivityId: imp.activityId,
        });
        await tx.garminActivity.update({ where: { id: a.id }, data: { workoutRefId: w.id } });
        return w;
      });
      usedActivities.add(a.id);
      result.imported.push({
        workoutId: workout.id,
        date: key(a.localDate),
        type: "easy_run",
        activityId: a.activityId,
        durationActualMin: imp.durationActualMin,
        match: "free_run",
      });
    } catch (e) {
      if (isP2002(e)) {
        // A second run on a day that already has an easy run, or an activity
        // a parallel /confirm linked first: raw data only, by design.
        result.rawOnly.push({ activityId: a.activityId, date: key(a.localDate), reason: "collision" });
        continue;
      }
      result.errors.push(`free run ${key(a.localDate)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
