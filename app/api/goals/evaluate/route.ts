// POST /api/goals/evaluate → evaluate a macrocycle against annual goal targets.
//
// Computes multi-dimensional gap analysis and suggests focus mode for next cycle.
// Uses evaluateMacrocycle() pure function — no AI involvement.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { evaluateMacrocycle } from "@/lib/coach-engine/goal-hierarchy/gap-analysis";
import type { GoalDimensions } from "@/lib/coach-engine/types";

const EvaluateBodySchema = z.object({
  macrocycleId: z.string().optional(), // defaults to active macrocycle
  // Manual overrides for dimensions that aren't auto-derivable yet
  endValues: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  const body = await req.json();
  const parsed = EvaluateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 1. Find the macrocycle
  let macrocycle;
  if (parsed.data.macrocycleId) {
    macrocycle = await db.macrocycle.findFirst({
      where: { id: parsed.data.macrocycleId, userId },
      include: { goal: true },
    });
  } else {
    macrocycle = await db.macrocycle.findFirst({
      where: { userId, status: "active" },
      include: { goal: true },
      orderBy: { startDate: "desc" },
    });
  }

  if (!macrocycle) {
    return NextResponse.json({ error: "No macrocycle found" }, { status: 404 });
  }

  // 2. Find the annual goal
  const annualGoal = macrocycle.annualGoalId
    ? await db.annualGoal.findUnique({ where: { id: macrocycle.annualGoalId } })
    : await db.annualGoal.findFirst({
        where: { userId, status: "active" },
        orderBy: { createdAt: "desc" },
      });

  if (!annualGoal) {
    return NextResponse.json(
      { error: "No annual goal found. Create one first via /goals." },
      { status: 404 },
    );
  }

  const annualTargets = annualGoal.targets as GoalDimensions;

  // 3. Derive start values from goal + macrocycle start
  const startValues = deriveStartValues(macrocycle.goal);

  // 4. Derive end values from ExerciseLog + manual overrides
  const autoEndValues = await deriveEndValues(userId);
  const endValues: GoalDimensions = {
    ...autoEndValues,
    ...(parsed.data.endValues as GoalDimensions | undefined),
  };

  // 5. Estimate remaining cycles
  const annualEndDate = new Date(annualGoal.targetDate);
  const now = new Date();
  const remainingMs = annualEndDate.getTime() - now.getTime();
  const CYCLE_DURATION_MS = 20 * 7 * 86400000; // 20 weeks
  const remainingCycles = Math.max(1, Math.round(remainingMs / CYCLE_DURATION_MS));

  // 6. Run pure evaluation
  const evaluation = evaluateMacrocycle(startValues, endValues, annualTargets, remainingCycles);

  // 7. Persist evaluation on macrocycle
  await db.macrocycle.update({
    where: { id: macrocycle.id },
    data: {
      evaluation: JSON.parse(JSON.stringify(evaluation)),
      evaluatedAt: new Date(),
    },
  });

  return NextResponse.json({
    status: "ok",
    macrocycleId: macrocycle.id,
    evaluation,
    startValues,
    endValues,
    remainingCycles,
  });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Derive start values from the original Goal record. */
function deriveStartValues(goal: { currentValue: unknown; primaryType: string }): GoalDimensions {
  const dims: GoalDimensions = {};
  const current = goal.currentValue as { time?: string } | null;

  if (current?.time) {
    // Map primaryType to dimension
    const typeMap: Record<string, keyof GoalDimensions> = {
      "5k_time": "5k",
      "10k_time": "10k",
      "21k_time": "hm",
    };
    const dim = typeMap[goal.primaryType];
    if (dim) {
      (dims as Record<string, unknown>)[dim] = current.time;
    }
  }

  return dims;
}

/** Derive end values from ExerciseLog (latest 1RM per exercise). */
async function deriveEndValues(userId: string): Promise<GoalDimensions> {
  const dims: GoalDimensions = {};

  // Strength: latest estimated 1RM per key exercise
  const exerciseMap: Record<string, keyof GoalDimensions> = {
    "Hex Bar Deadlift": "hexBarDl",
    "Romanian Deadlift": "convDl",
    "Bench Press": "bench",
    "Incline DB Press": "bench", // fallback
    "Squat": "squat",
  };

  for (const [exerciseName, dimKey] of Object.entries(exerciseMap)) {
    const latest = await db.exerciseLog.findFirst({
      where: { userId, exerciseName },
      orderBy: { date: "desc" },
    });
    if (latest) {
      // Only update if we don't already have a value, or this is a better one
      const current = dims[dimKey];
      if (current === undefined || latest.estimatedOneRM > (current as number)) {
        (dims as Record<string, unknown>)[dimKey] = Math.round(latest.estimatedOneRM);
      }
    }
  }

  return dims;
}
