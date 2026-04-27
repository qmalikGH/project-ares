// GET /api/day/[date] — aggregated day view for /day/[YYYY-MM-DD].
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import type { SessionPlan } from "@/lib/coach-engine/types";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const { date } = await ctx.params;
  const userId = await getCurrentUserId();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date format" }, { status: 400 });
  }

  const targetDate = new Date(`${date}T00:00:00.000Z`);
  const targetEnd = new Date(targetDate.getTime() + 86400000);
  const today0 = dayKey(new Date());

  let position: "past" | "today" | "future";
  if (targetDate.getTime() < today0.getTime()) position = "past";
  else if (targetDate.getTime() === today0.getTime()) position = "today";
  else position = "future";

  // Workouts that day
  const workouts = await db.workout.findMany({
    where: { userId, date: { gte: targetDate, lt: targetEnd } },
    orderBy: { date: "asc" },
  });

  // Sensor data for that day
  const sensor = await db.dailySensorData.findFirst({
    where: { userId, date: targetDate },
  });

  // Block / phase position
  const phase = await db.phase.findFirst({
    where: {
      macrocycle: { userId, status: "active" },
      startDate: { lte: targetDate },
      plannedEndDate: { gt: targetDate },
    },
    include: { weeklyPlans: true },
  });

  // For future days, planned sessions live in the WeeklyPlan JSON, not in Workout
  let plannedFromWeeklyPlan: SessionPlan[] = [];
  if (position === "future" && phase) {
    const weekPlan = phase.weeklyPlans.find(
      (w) =>
        dayKey(w.startDate).getTime() <= targetDate.getTime() &&
        targetDate.getTime() < dayKey(w.endDate).getTime(),
    );
    if (weekPlan) {
      const sessions = weekPlan.plannedSessions as unknown as SessionPlan[];
      if (Array.isArray(sessions)) {
        plannedFromWeeklyPlan = sessions.filter((s) => {
          const sDate = s.date instanceof Date ? s.date : new Date(s.date);
          return sDate.toISOString().slice(0, 10) === date;
        });
      }
    }
  }

  return NextResponse.json({
    status: "ok",
    date,
    position,
    workouts: workouts.map((w) => ({
      id: w.id,
      type: w.type,
      status: w.status,
      plannedSession: w.plannedSession,
      executedSession: w.executedSession,
      modulationApplied: w.modulationApplied,
      modulations: w.modulations,
      modulationReason: w.modulationReason,
      rpe: w.rpe,
      durationActualMin: w.durationActualMin,
      notes: w.notes,
      garminActivityId: w.garminActivityId,
    })),
    plannedFromWeeklyPlan,
    sensor: sensor
      ? {
          garmin: sensor.garmin,
          userMorning: sensor.userMorning,
          readinessScore: sensor.readinessScore,
          readinessBand: sensor.readinessBand,
          readinessComponents: sensor.readinessComponents,
          kneeScore: sensor.kneeScore,
          therapyPhase: sensor.therapyPhase,
          loadMetrics: sensor.loadMetrics,
        }
      : null,
    blockPosition: phase
      ? {
          blockNumber: phase.blockNumber,
          phaseName: phase.name,
          phaseId: phase.id,
        }
      : null,
  });
}
