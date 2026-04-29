// GET /api/debug/test-schedule
// In-memory dry run of planWeekSchedule with Q's settings — NO DB writes.
// Tells us what the v0.10 code actually produces vs what's stored.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { generateWeekRunPlan } from "@/lib/coach-engine/run-coach";
import { generateWeekStrengthPlan } from "@/lib/coach-engine/strength-coach";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import type { PhaseConfig, SessionPlan } from "@/lib/coach-engine/types";

export async function GET() {
  const userId = await getCurrentUserId();
  const userSettings = await db.userSettings.findUnique({ where: { userId } });
  const effectiveVdot = await getEffectiveVdot(userId);

  const plan = await db.weeklyPlan.findFirst({
    where: { phase: { macrocycle: { userId, status: "active" } } },
    include: { phase: true },
    orderBy: { startDate: "asc" },
  });
  if (!plan) return NextResponse.json({ error: "no plan" });

  const phaseConfig = plan.phase.config as unknown as PhaseConfig;

  const constraints = constraintsFromUserSettings({
    forcedRestDaysIso: userSettings?.forcedRestDays ?? null,
    preferredLongRunDayIso: userSettings?.preferredLongRunDay ?? null,
  });

  const runPlan = generateWeekRunPlan(
    phaseConfig,
    plan.weekNumber,
    effectiveVdot,
    plan.startDate,
    userSettings?.hrMax && userSettings?.hrRest
      ? { hrMax: userSettings.hrMax, hrRest: userSettings.hrRest }
      : undefined,
  );
  const strengthPlan = generateWeekStrengthPlan(
    phaseConfig,
    plan.weekNumber,
    plan.startDate,
    null,
    null,
  );

  const merged: SessionPlan[] = planWeekSchedule(
    runPlan.sessions,
    strengthPlan.sessions,
    plan.startDate,
    constraints,
  );

  return NextResponse.json({
    weekStartDate: plan.startDate.toISOString(),
    settings: {
      forcedRestDaysRaw: userSettings?.forcedRestDays ?? null,
      preferredLongRunDayRaw: userSettings?.preferredLongRunDay ?? null,
    },
    constraintsResolved: {
      forcedRestDays: Array.from(constraints.forcedRestDays).sort(),
      preferredLongRunDay: constraints.preferredLongRunDay,
    },
    rawRunSessions: runPlan.sessions.map((s) => ({
      type: s.type,
      date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date),
    })),
    rawStrengthSessions: strengthPlan.sessions.map((s) => ({
      type: s.type,
      date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date),
    })),
    afterPlanWeekSchedule: merged.map((s) => ({
      type: s.type,
      date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date),
    })),
  });
}
