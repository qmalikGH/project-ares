// ExerciseLog read-layer (Sprint 2.1). The per-set training log
// (written by /api/sessions/complete) was previously write-only; these
// helpers finally read it for (a) the "last week" today-dashboard display and
// (b) the TM-increment proposal at the W4 cycle review.
//
// Both rely on the denormalized snapshot fields added in Sprint 2.1 #0:
//   - slot (strength_a/b/c): so we never mix Hex-in-A (4×5) with Hex-in-C (3×6)
//   - isDeload: deload sets are excluded as references AND progression anchors
import { db } from "@/lib/db/client";

export interface LastLoggedSet {
  weightKg: number;
  repsCompleted: number;
  rpe: number | null;
  date: Date;
}

/**
 * The most recent NON-DELOAD logged top set for an exercise in a given slot.
 * Returns the heaviest set of that most-recent qualifying session (the working
 * weight the athlete actually hit), or null when there's no usable history
 * (new exercise, only deload data, or pre-Sprint-2.1 rows without a slot).
 *
 * `slot` filters to the same session type so "last week" matches like-for-like.
 */
export async function getLastNonDeloadLog(
  userId: string,
  exerciseName: string,
  slot: string,
): Promise<LastLoggedSet | null> {
  // Find the date of the most recent non-deload session for this exercise+slot.
  const latest = await db.exerciseLog.findFirst({
    where: { userId, exerciseName, slot, isDeload: false },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return null;

  // Of that session, return the heaviest set (the working weight).
  const dayStart = new Date(latest.date.getTime() - 12 * 3600000);
  const dayEnd = new Date(latest.date.getTime() + 12 * 3600000);
  const top = await db.exerciseLog.findFirst({
    where: {
      userId,
      exerciseName,
      slot,
      isDeload: false,
      date: { gte: dayStart, lte: dayEnd },
    },
    orderBy: [{ weightKg: "desc" }, { repsCompleted: "desc" }],
    select: { weightKg: true, repsCompleted: true, rpe: true, date: true },
  });
  return top ?? null;
}

export interface CycleSet {
  weightKg: number;
  repsCompleted: number;
  rpe: number | null;
  date: Date;
  weekInBlock: number | null;
}

/**
 * All NON-DELOAD working sets for an exercise+slot since `since` (the start of
 * the cycle under review). Feeds the TM-increment evaluation: did the athlete
 * hit the prescribed reps at/under the target RPE?
 *
 * Ordered oldest→newest so callers can walk the cycle chronologically.
 */
export async function getCycleTopSets(
  userId: string,
  exerciseName: string,
  slot: string,
  since: Date,
): Promise<CycleSet[]> {
  return db.exerciseLog.findMany({
    where: {
      userId,
      exerciseName,
      slot,
      isDeload: false,
      date: { gte: since },
    },
    orderBy: { date: "asc" },
    select: {
      weightKg: true,
      repsCompleted: true,
      rpe: true,
      date: true,
      weekInBlock: true,
    },
  });
}
