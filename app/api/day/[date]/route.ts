// GET /api/day/[date] — aggregated day view for /day/[YYYY-MM-DD].
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { userTodayDynamic } from "@/lib/date";
import type { SessionPlan } from "@/lib/coach-engine/types";

// Higher = preferred when deduping siblings of the same type on the same day.
function workoutPriority(w: {
  status: string;
  garminActivityId: string | null;
  executedSession: unknown;
}): number {
  let score = 0;
  if (w.status === "completed") score += 4;
  else if (w.status === "in_progress") score += 2;
  if (w.garminActivityId) score += 2;
  if (w.executedSession !== null && w.executedSession !== undefined) score += 1;
  return score;
}

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
  const today0 = await userTodayDynamic();

  let position: "past" | "today" | "future";
  if (targetDate.getTime() < today0.getTime()) position = "past";
  else if (targetDate.getTime() === today0.getTime()) position = "today";
  else position = "future";

  // Workouts that day. Dedup by `type`: if both a planned/orphan row and a
  // completed row exist for the same type (e.g. timezone-drift left a
  // stale planned row when /complete created a completed row dated one day
  // off), prefer the one with executedSession / garminActivityId / completed
  // status. Belt-and-suspenders for historical data; forward prevention is
  // in /api/sessions/complete (window lookup) and resync's status filter.
  const allWorkouts = await db.workout.findMany({
    where: { userId, date: { gte: targetDate, lt: targetEnd } },
    orderBy: { date: "asc" },
  });

  const byType = new Map<string, typeof allWorkouts[number]>();
  for (const w of allWorkouts) {
    const existing = byType.get(w.type);
    if (!existing) {
      byType.set(w.type, w);
      continue;
    }
    const existingScore = workoutPriority(existing);
    const candScore = workoutPriority(w);
    if (candScore > existingScore) byType.set(w.type, w);
  }
  const workouts = Array.from(byType.values());

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
