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
