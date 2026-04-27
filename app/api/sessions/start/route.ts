// POST /api/sessions/start
// Mark today's planned session as in_progress. Creates the Workout row if missing.
// Body: {} — uses today's session.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getCurrentPhaseRow, findWeekPlanForDate, findTodaySessionInPlan } from "@/lib/db/queries/plans";
import { dayKey } from "@/lib/db/queries/sensors";
import { computeReadiness, computeBaselines } from "@/lib/coach-engine/readiness";
import { buildLoadOutput, computeDailyLoad } from "@/lib/coach-engine/load-monitoring";
import { computeKneeStatus } from "@/lib/coach-engine/limitations";
import { modulateSession } from "@/lib/coach-engine/session-modulator";
import {
  getRecentSensorData,
  rowsToSensorInputs,
  rowsToKneeLogs,
  getRecentDailyLoads,
  getSensorDataOnDate,
} from "@/lib/db/queries/sensors";
import type { DailySensorInputs, SessionPlan, TherapyPhase, UserMorningInputs } from "@/lib/coach-engine/types";

export async function POST() {
  const userId = await getCurrentUserId();
  const today = new Date();
  const todayDay = dayKey(today);

  const phaseRow = await getCurrentPhaseRow(userId, today);
  if (!phaseRow) return NextResponse.json({ status: "NO_ACTIVE_PLAN" }, { status: 400 });
  const weekPlan = findWeekPlanForDate(phaseRow.weeklyPlans, today);
  if (!weekPlan) return NextResponse.json({ status: "NO_WEEK_PLAN" }, { status: 400 });
  const plannedSession = findTodaySessionInPlan(weekPlan.plannedSessions, today);
  if (!plannedSession) return NextResponse.json({ status: "NO_SESSION_TODAY" }, { status: 400 });

  const todayRow = await getSensorDataOnDate(userId, today);
  if (!todayRow?.userMorning) {
    return NextResponse.json({ status: "AWAITING_MORNING_INPUT" }, { status: 400 });
  }

  // Run the modulation pipeline once so the persisted plannedSession reflects what the user actually starts.
  const recentRows = await getRecentSensorData(userId, 30);
  const baselines = computeBaselines(rowsToSensorInputs(recentRows));
  const todayInputs: DailySensorInputs = {
    date: todayDay,
    garmin: (todayRow.garmin as unknown as DailySensorInputs["garmin"]) ?? undefined,
    userMorning: todayRow.userMorning as unknown as UserMorningInputs,
  };
  const readiness = computeReadiness(todayInputs, baselines);
  const recentLoads = await getRecentDailyLoads(userId, 28);
  const load = buildLoadOutput(recentLoads, computeDailyLoad(0, 0), todayDay);
  const limitations = computeKneeStatus(
    { morning: todayInputs.userMorning, postSession: todayInputs.userPostSession?.trainingScore },
    rowsToKneeLogs(recentRows),
    (todayRow.therapyPhase as TherapyPhase | null) ?? "DISREPAIR",
    null,
  );
  const finalSession = modulateSession(plannedSession as SessionPlan, readiness, load, limitations);

  // Upsert a workout row for today
  const existing = await db.workout.findFirst({
    where: { userId, date: todayDay },
    orderBy: { createdAt: "desc" },
  });
  const workout = existing
    ? await db.workout.update({
        where: { id: existing.id },
        data: {
          status: "in_progress",
          plannedSession: plannedSession as unknown as object,
          modulationApplied: finalSession.wasModified,
          modulations: finalSession.modifications,
          modulationReason: finalSession.modifications.join("; ") || null,
          updatedAt: new Date(),
        },
      })
    : await db.workout.create({
        data: {
          userId,
          date: todayDay,
          type: finalSession.type,
          plannedSession: plannedSession as unknown as object,
          modulationApplied: finalSession.wasModified,
          modulations: finalSession.modifications,
          modulationReason: finalSession.modifications.join("; ") || null,
          status: "in_progress",
        },
      });

  return NextResponse.json({ status: "ok", workoutId: workout.id, finalSession });
}
