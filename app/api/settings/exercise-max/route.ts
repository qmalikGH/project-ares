// /api/settings/exercise-max — Sprint v0.11 1RM management.
//
// GET: returns the user's stored 1RM estimates plus the engine's rolling
// estimate per exercise (from the last 28 days of ExerciseLog), AND the list
// of exercises that need a 1RM right now — which is the union of current-
// block + next-block templates filtered to entries that have a `loadPct`.
//
// POST: persists user-supplied 1RM estimates and regenerates every future
// WeeklyPlan in the active macrocycle so `loadAbs` reflects the new values.
// No Garmin re-sync — 1RM updates only affect strength display, not the
// run-workouts pushed to the watch.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userToday } from "@/lib/date";
import { BLOCK_TEMPLATES } from "@/lib/coach-engine/strength-coach";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import { rollingOneRMEstimate } from "@/lib/coach-engine/strength-coach/one-rm";
import { getCurrentPhaseRow } from "@/lib/db/queries/plans";
import type {
  BlockNumber,
  Exercise,
} from "@/lib/coach-engine/types";

interface RelevantExercise {
  name: string;
  loadPctSample: number; // a representative %1RM for UI hint
  blocks: BlockNumber[]; // which blocks reference this exercise
}

/**
 * Walk current + next block's templates and collect distinct exercises
 * that have a `loadPct` (only those need a 1RM). Bodyweight and isometric
 * exercises (Pull-ups, Wall Sit, Pallof Press, etc.) are skipped.
 */
function collectRelevantExercises(
  currentBlock: BlockNumber,
): RelevantExercise[] {
  const blocks: BlockNumber[] = [
    currentBlock,
    Math.min(5, currentBlock + 1) as BlockNumber,
  ];
  const seen = new Map<string, RelevantExercise>();
  for (const b of blocks) {
    const tpl = BLOCK_TEMPLATES[b] ?? BLOCK_TEMPLATES[1];
    if (!tpl) continue;
    for (const slot of ["strength_a", "strength_b", "strength_c"] as const) {
      for (const ex of tpl[slot] as Exercise[]) {
        if (typeof ex.loadPct !== "number") continue;
        const existing = seen.get(ex.name);
        if (existing) {
          if (!existing.blocks.includes(b)) existing.blocks.push(b);
        } else {
          seen.set(ex.name, {
            name: ex.name,
            loadPctSample: ex.loadPct,
            blocks: [b],
          });
        }
      }
    }
  }
  return Array.from(seen.values());
}

export async function GET() {
  const userId = await getCurrentUserId();
  const today = userToday();

  const userSettings = await db.userSettings.findUnique({ where: { userId } });
  const stored =
    (userSettings?.exerciseMaxEstimates as Record<string, number> | null) ??
    {};

  const phaseRow = await getCurrentPhaseRow(userId, today);
  const currentBlock = (phaseRow?.blockNumber ?? 1) as BlockNumber;
  const exercises = collectRelevantExercises(currentBlock);

  // Engine-side rolling estimate per exercise (last 28 days). Independent
  // of stored manual value — the user sees both side-by-side.
  const cutoff = new Date(today.getTime() - 28 * 86400000);
  const enriched = await Promise.all(
    exercises.map(async (ex) => {
      const logs = await db.exerciseLog.findMany({
        where: {
          userId,
          exerciseName: ex.name,
          date: { gte: cutoff },
        },
        select: { weightKg: true, repsCompleted: true, rpe: true },
      });
      const engineRM =
        logs.length >= 2
          ? rollingOneRMEstimate(
              logs.map((l) => ({
                weightKg: l.weightKg,
                reps: l.repsCompleted,
                rpe: l.rpe ?? undefined,
              })),
            )
          : null;
      return {
        ...ex,
        currentRM: typeof stored[ex.name] === "number" ? stored[ex.name] : null,
        engineRM,
        engineDataPoints: logs.length,
      };
    }),
  );

  return NextResponse.json({
    status: "ok",
    currentBlock,
    source: userSettings?.exerciseMaxSource ?? null,
    updatedAt:
      userSettings?.exerciseMaxUpdatedAt?.toISOString() ?? null,
    exercises: enriched,
    // Sprint v0.15: pass through for ×BW display
    currentWeightKg: userSettings?.currentWeightKg ?? null,
  });
}

const PostSchema = z.object({
  exerciseMaxEstimates: z.record(
    z.string(),
    z.number().min(0).max(500),
  ),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();

  // 1. Persist new estimates.
  await db.userSettings.upsert({
    where: { userId },
    update: {
      exerciseMaxEstimates: parsed.data.exerciseMaxEstimates,
      exerciseMaxSource: "manual",
      exerciseMaxUpdatedAt: new Date(),
    },
    create: {
      userId,
      exerciseMaxEstimates: parsed.data.exerciseMaxEstimates,
      exerciseMaxSource: "manual",
      exerciseMaxUpdatedAt: new Date(),
    },
  });

  // 2. Regenerate the current week + every future WeeklyPlan so `loadAbs`
  // reflects the new 1RMs.
  //
  // Sprint 2.4: this used to inline its own copy of the regeneration loop and
  // called generateWeekRunPlan WITHOUT the shin/RHR gate or the comeback ramp —
  // so saving a 1RM silently rewrote the imminent week back to full volume and
  // a full threshold session, releasing the injury brake. Delegating to the
  // shared helper keeps every regeneration path braked by construction.
  //
  // No Garmin re-sync — 1RM updates only affect strength display, not the
  // run workouts pushed to the watch.
  const { regenerated } = await regeneratePlansFromNow(userId);

  return NextResponse.json({ status: "ok", regenerated });
}
