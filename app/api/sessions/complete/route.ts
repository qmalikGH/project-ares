// POST /api/sessions/complete
// Log post-session feedback. Body now supports two execution payloads:
//   - garminActivityId  → run with Garmin auto-import (fetches detail server-side)
//   - strengthExecution → strength with set-by-set logger payload
//   - neither           → manual completion (just RPE + duration)
//
// `executedSession` JSON conforms to ExecutedSessionSchema (run|strength
// discriminated union) when import succeeds; falls back to a minimal manual
// shape when no execution data is provided.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { getActivityDetail } from "@/lib/garmin/activities";
import {
  RunExecutedSessionSchema,
  StrengthExecutedSessionSchema,
} from "@/lib/coach-engine/types";

const Schema = z.object({
  rpe: z.number().int().min(0).max(10),
  durationActualMin: z.number().int().min(1).max(600).optional(),
  notes: z.string().max(2000).optional(),
  trainingScore: z.number().int().min(1).max(10).optional(),

  garminActivityId: z.number().int().nullable().optional(),
  strengthExecution: StrengthExecutedSessionSchema.optional(),
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
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  const today = dayKey(new Date());
  const { rpe, notes, trainingScore } = parsed.data;
  let durationActualMin = parsed.data.durationActualMin ?? null;
  let garminActivityIdStr: string | null = null;

  const workout = await db.workout.findFirst({
    where: { userId, date: today },
    orderBy: { createdAt: "desc" },
  });
  if (!workout) {
    return NextResponse.json({ status: "NO_WORKOUT_FOUND" }, { status: 404 });
  }

  // Build executedSession payload by branch
  let executedSession: unknown;

  if (parsed.data.garminActivityId) {
    try {
      const detail = await getActivityDetail(parsed.data.garminActivityId);
      const runExec = RunExecutedSessionSchema.parse({
        type: "run",
        source: "garmin_import",
        garminActivityId: parsed.data.garminActivityId,
        startTimeLocal: detail.startTimeLocal,
        durationSec: detail.durationSec,
        distanceM: detail.distanceM,
        averagePaceSecPerKm: detail.averagePaceSecPerKm,
        averageHr: detail.averageHr,
        maxHr: detail.maxHr,
        elevationGainM: detail.elevationGainM,
        calories: detail.calories,
        splits: detail.splits.map((s) => ({
          splitNumber: s.splitNumber,
          distanceM: s.distanceM,
          durationSec: s.durationSec,
          paceSecPerKm: s.paceSecPerKm,
          averageHr: s.averageHr,
          maxHr: s.maxHr,
        })),
      });
      executedSession = runExec;
      durationActualMin = Math.max(1, Math.round(detail.durationSec / 60));
      garminActivityIdStr = String(parsed.data.garminActivityId);
    } catch (e) {
      console.error("[complete] garmin import failed:", e);
      // Fall through to manual completion below.
      executedSession = {
        type: "run",
        source: "manual",
        garminActivityId: null,
        startTimeLocal: new Date().toISOString(),
        durationSec: (durationActualMin ?? 0) * 60,
        distanceM: null,
        averagePaceSecPerKm: null,
        averageHr: null,
        maxHr: null,
        elevationGainM: null,
        calories: null,
        splits: [],
      };
    }
  } else if (parsed.data.strengthExecution) {
    executedSession = parsed.data.strengthExecution;
    durationActualMin = parsed.data.strengthExecution.durationActualMin;
  } else {
    // Plain manual completion — minimal payload.
    if (durationActualMin == null) {
      return NextResponse.json(
        { error: "durationActualMin required when no garminActivityId or strengthExecution" },
        { status: 400 },
      );
    }
    executedSession = {
      rpe,
      durationActualMin,
      notes: notes ?? null,
      completedAt: new Date().toISOString(),
    };
  }

  const updated = await db.workout.update({
    where: { id: workout.id },
    data: {
      status: "completed",
      rpe,
      durationActualMin,
      notes: notes ?? null,
      executedSession: executedSession as object,
      garminActivityId: garminActivityIdStr,
      updatedAt: new Date(),
    },
  });

  // Persist post-session knee score to today's sensor row.
  if (trainingScore !== undefined) {
    const sensor = await db.dailySensorData.findFirst({ where: { userId, date: today } });
    if (sensor) {
      const existing = (sensor.userMorning as Record<string, unknown> | null) ?? {};
      await db.dailySensorData.update({
        where: { id: sensor.id },
        data: {
          userMorning: { ...existing, postSessionScore: trainingScore },
          updatedAt: new Date(),
        },
      });
    }
  }

  return NextResponse.json({
    status: "ok",
    workoutId: updated.id,
    dailyLoadAu: rpe * (durationActualMin ?? 0),
    hasGarminImport: !!parsed.data.garminActivityId,
    hasStrengthLog: !!parsed.data.strengthExecution,
  });
}
