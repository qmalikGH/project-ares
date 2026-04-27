// POST /api/sessions/complete
// Log post-session feedback: sRPE + actual duration + optional notes + post-session knee score.
// Body: { rpe, durationActualMin, notes?, trainingScore? }
//
// On completion: writes execution data, recomputes readiness/knee scores tomorrow morning will see.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";

const Schema = z.object({
  rpe: z.number().int().min(0).max(10),
  durationActualMin: z.number().int().min(1).max(600),
  notes: z.string().max(2000).optional(),
  trainingScore: z.number().int().min(1).max(10).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  const today = dayKey(new Date());
  const { rpe, durationActualMin, notes, trainingScore } = parsed.data;

  const workout = await db.workout.findFirst({
    where: { userId, date: today },
    orderBy: { createdAt: "desc" },
  });
  if (!workout) {
    return NextResponse.json({ status: "NO_WORKOUT_FOUND" }, { status: 404 });
  }

  const updated = await db.workout.update({
    where: { id: workout.id },
    data: {
      status: "completed",
      rpe,
      durationActualMin,
      notes: notes ?? null,
      executedSession: {
        rpe,
        durationActualMin,
        notes: notes ?? null,
        completedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    },
  });

  // Append post-session knee score to today's sensor row (used by tomorrow's readiness/knee computation)
  if (trainingScore !== undefined) {
    const sensor = await db.dailySensorData.findFirst({ where: { userId, date: today } });
    if (sensor) {
      const existingPostSession =
        (sensor.userMorning as Record<string, unknown> | null) ?? {};
      await db.dailySensorData.update({
        where: { id: sensor.id },
        data: {
          userMorning: { ...existingPostSession, postSessionScore: trainingScore },
          updatedAt: new Date(),
        },
      });
    }
  }

  return NextResponse.json({
    status: "ok",
    workoutId: updated.id,
    dailyLoadAu: rpe * durationActualMin,
  });
}
