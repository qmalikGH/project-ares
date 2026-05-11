// GET /api/history?page=1&pageSize=20&type=run|strength|all&status=completed|skipped|modified|all
// Paginated workout history with quick-stats for the current week.
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userToday } from "@/lib/date";
import {
  RUN_SESSION_TYPES,
  STRENGTH_SESSION_TYPES,
} from "@/lib/db/queries/progress-helpers";

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);

  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10)),
  );
  const typeFilter = url.searchParams.get("type") ?? "all";
  const statusFilter = url.searchParams.get("status") ?? "all";

  const where: Prisma.WorkoutWhereInput = { userId };

  if (typeFilter === "run") {
    where.type = { in: [...RUN_SESSION_TYPES] };
  } else if (typeFilter === "strength") {
    where.type = { in: [...STRENGTH_SESSION_TYPES] };
  }

  if (statusFilter === "completed") {
    where.status = "completed";
    where.modulationApplied = false;
  } else if (statusFilter === "modified") {
    where.status = "completed";
    where.modulationApplied = true;
  } else if (statusFilter === "skipped") {
    where.status = { in: ["skipped", "skipped_illness"] };
  }

  const [total, workouts] = await Promise.all([
    db.workout.count({ where }),
    db.workout.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Quick-stats for the current ISO week (Mon → Sun).
  const today = userToday();
  const dow = today.getUTCDay() || 7; // Sun = 7
  const weekStart = new Date(today.getTime() - (dow - 1) * 86400000);

  const weekWorkouts = await db.workout.findMany({
    where: { userId, date: { gte: weekStart }, status: "completed" },
  });

  const runMin = weekWorkouts
    .filter((w) => (RUN_SESSION_TYPES as readonly string[]).includes(w.type))
    .reduce((s, w) => s + (w.durationActualMin ?? 0), 0);

  const strengthCount = weekWorkouts.filter((w) =>
    (STRENGTH_SESSION_TYPES as readonly string[]).includes(w.type),
  ).length;

  // Pull morning sensor rows for the displayed dates so the UI can show pre-session knee
  const dateRange = workouts.map((w) => w.date);
  const sensorRows = dateRange.length
    ? await db.dailySensorData.findMany({
        where: { userId, date: { in: dateRange } },
      })
    : [];
  const sensorByDateMs = new Map(sensorRows.map((r) => [r.date.getTime(), r]));

  return NextResponse.json({
    status: "ok",
    workouts: workouts.map((w) => {
      const sensor = sensorByDateMs.get(w.date.getTime());
      const userMorning = sensor?.userMorning as
        | { morningStiffness?: number; stairsScore?: number }
        | null;
      return {
        id: w.id,
        date: w.date.toISOString(),
        type: w.type,
        status: w.status,
        modulationApplied: w.modulationApplied,
        modulations: w.modulations,
        modulationReason: w.modulationReason,
        rpe: w.rpe,
        durationActualMin: w.durationActualMin,
        notes: w.notes,
        plannedSession: w.plannedSession,
        executedSession: w.executedSession,
        garminActivityId: w.garminActivityId,
        sensorMorning: userMorning
          ? {
              stiffness: userMorning.morningStiffness ?? null,
              stairs: userMorning.stairsScore ?? null,
            }
          : null,
      };
    }),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    quickStats: {
      thisWeekSessions: weekWorkouts.length,
      thisWeekRunMin: runMin,
      thisWeekStrengthCount: strengthCount,
    },
  });
}
