// Sprint 3.4 (#28, Phase B1): one way to store a run nobody planned.
//
// Extracted from POST /api/sessions/free-run (Sprint 3.3b) so the nightly
// auto-import writes the exact same row as the form: an `easy_run`,
// `completed`, whose "planned" side mirrors what was run and is flagged
// `unplanned: true` — so the export can tell planned from free runs.
//
// One easy run per day (Workout @@unique([userId, date, type])); the caller
// handles the collision (409 in the route, "raw data only" in the import).
import type { Prisma, PrismaClient } from "@prisma/client";

type WorkoutWriter = Pick<PrismaClient, "workout"> | Pick<Prisma.TransactionClient, "workout">;

export const FREE_RUN_NOTE = "Freier Lauf (nicht geplant)";

export function freeRunPlannedSession(date: Date, durationMin: number) {
  return {
    date: date.toISOString(),
    type: "easy_run",
    durationMin,
    unplanned: true,
    notes: FREE_RUN_NOTE,
  };
}

/**
 * Coach, 27.11. (#28 a): a free run the cron made of a recording stays
 * claimable for a planned run card of the same day until somebody rates it —
 * typically a threshold run not started from the pushed workout. Only a row
 * the auto-import created and nobody touched qualifies.
 */
export function isClaimableAutoRun(w: {
  type: string;
  status: string;
  rpe: number | null;
  plannedSession: unknown;
  executedSession: unknown;
}): boolean {
  return (
    w.type === "easy_run" &&
    w.status === "completed" &&
    w.rpe == null &&
    (w.plannedSession as { unplanned?: unknown } | null)?.unplanned === true &&
    (w.executedSession as { autoMatch?: unknown } | null)?.autoMatch === "free_run"
  );
}

export async function createFreeRunWorkout(
  client: WorkoutWriter,
  input: {
    userId: string;
    date: Date;
    durationActualMin: number;
    executedSession: unknown;
    rpe: number | null;
    garminActivityId: string | null;
  },
): Promise<{ id: string }> {
  return (client.workout as PrismaClient["workout"]).create({
    data: {
      userId: input.userId,
      date: input.date,
      type: "easy_run",
      status: "completed",
      plannedSession: freeRunPlannedSession(input.date, input.durationActualMin),
      executedSession: input.executedSession as object,
      durationActualMin: input.durationActualMin,
      rpe: input.rpe,
      garminActivityId: input.garminActivityId,
    },
    select: { id: true },
  });
}
