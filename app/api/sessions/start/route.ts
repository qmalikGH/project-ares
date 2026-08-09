// POST /api/sessions/start
//
// Marks a planned session as in_progress and creates the matching Workout
// row if it doesn't exist yet.
//
// Body: { type?: SessionType } — which of today's sessions to start.
// Omitted → falls back to the first non-rest session (legacy behavior).
//
// Two-a-day support (Sprint v0.11+): on days with multiple sessions
// (e.g. Easy Run AM + Strength A PM) the caller MUST pass `type` so the
// right Workout row is created/updated. Without it the API would only ever
// touch one row and the other session would never get its own status.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  getCurrentPhaseRow,
  findWeekPlanForDate,
  findAllTodaySessionsInPlan,
} from "@/lib/db/queries/plans";
import { dayKey } from "@/lib/db/queries/sensors";
import { userTodayDynamic } from "@/lib/date";
import { modulateSession } from "@/lib/coach-engine/session-modulator";
import { buildModulationContext } from "@/lib/db/queries/modulation-context";
import type { SessionPlan } from "@/lib/coach-engine/types";

const Schema = z.object({
  type: z.string().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  // Body is optional — old clients post empty body, new clients post {type}.
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // ignore — empty body is allowed for the legacy single-session case
  }
  const parsed = Schema.safeParse(body);
  const requestedType = parsed.success ? parsed.data.type : undefined;

  const userId = await getCurrentUserId();
  const today = await userTodayDynamic();
  const todayDay = dayKey(today);

  const phaseRow = await getCurrentPhaseRow(userId, today);
  if (!phaseRow) return NextResponse.json({ status: "NO_ACTIVE_PLAN" }, { status: 400 });
  const weekPlan = findWeekPlanForDate(phaseRow.weeklyPlans, today);
  if (!weekPlan) return NextResponse.json({ status: "NO_WEEK_PLAN" }, { status: 400 });

  // Pull every session for today; pick the one matching `type`, otherwise
  // fall back to the first non-rest entry.
  const todaySessions = findAllTodaySessionsInPlan(weekPlan.plannedSessions, today);
  if (todaySessions.length === 0) {
    return NextResponse.json({ status: "NO_SESSION_TODAY" }, { status: 400 });
  }
  const plannedSession =
    (requestedType && todaySessions.find((s) => s.type === requestedType)) ||
    todaySessions.find((s) => s.type !== "rest") ||
    todaySessions[0];
  if (requestedType && plannedSession.type !== requestedType) {
    return NextResponse.json(
      { status: "SESSION_TYPE_NOT_FOUND", requestedType },
      { status: 404 },
    );
  }

  // Sprint 2.5: this route used to assemble the modulation inputs itself and
  // called computeKneeStatus WITHOUT the workout history + today, so
  // illnessRecoveryDays was always null here — /today displayed a reduced
  // session and /start then persisted the full one. One shared builder now.
  const ctx = await buildModulationContext(userId, today);
  if (!ctx) {
    return NextResponse.json({ status: "AWAITING_MORNING_INPUT" }, { status: 400 });
  }
  const { readiness, load, limitations, paces } = ctx;
  const finalSession = modulateSession(
    plannedSession as SessionPlan,
    readiness,
    load,
    limitations,
    paces,
  );

  // Find/create the Workout row keyed by (userId, date, type) — critical for
  // two-a-days so the Easy Run row and the Strength row stay separate.
  const existing = await db.workout.findFirst({
    where: { userId, date: todayDay, type: finalSession.type },
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

  return NextResponse.json({
    status: "ok",
    workoutId: workout.id,
    type: finalSession.type,
    finalSession,
  });
}
