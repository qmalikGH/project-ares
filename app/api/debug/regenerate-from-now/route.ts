// POST /api/debug/regenerate-from-now
//
// One-time data fix: regenerates the CURRENT week's plan + all future weeks
// using the v0.10 schedule-strategy. Needed because /api/settings/training-days
// only regenerates plans with `startDate >= today` — leaving the current week
// stuck with legacy v0.9 layout (Strength B on Wed instead of Thu, etc.).
//
// Same regeneration code-path as training-days, but with `endDate > today`
// filter so the current week is included.
//
// Auth:
//   - Browser/session: cookie-based, runs against the logged-in user.
//   - Service: `Authorization: Bearer <CRON_SECRET>` + JSON body `{ userId }`.
//     Lets out-of-band callers (cron, ops, agent) trigger regen without a session.
//
// Best-effort: Garmin re-sync runs after but never fails the request.
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userToday } from "@/lib/date";
import { generateWeekRunPlan } from "@/lib/coach-engine/run-coach";
import { generateWeekStrengthPlan } from "@/lib/coach-engine/strength-coach";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import type {
  PhaseConfig,
  SessionPlan,
  WeekStrengthData,
  WeekStrengthPlan,
} from "@/lib/coach-engine/types";

async function resolveUserId(req: NextRequest): Promise<string | NextResponse> {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth === `Bearer ${secret}`) {
    let body: { userId?: unknown } = {};
    try {
      body = (await req.json()) as { userId?: unknown };
    } catch {
      // empty / non-JSON body — fall through to validation below
    }
    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return NextResponse.json(
        { status: "error", message: "Missing userId in body" },
        { status: 400 },
      );
    }
    return body.userId;
  }
  return getCurrentUserId();
}

export async function POST(req: NextRequest) {
  const resolved = await resolveUserId(req);
  if (resolved instanceof NextResponse) return resolved;
  const userId = resolved;
  const today0 = userToday();

  // KEY DIFFERENCE vs /api/settings/training-days: endDate > today (not
  // startDate >= today). This includes the current week.
  const plansToRegen = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      endDate: { gt: today0 },
    },
    include: { phase: true },
    orderBy: { startDate: "asc" },
  });

  if (plansToRegen.length === 0) {
    return NextResponse.json({
      status: "ok",
      regenerated: 0,
      message: "No active future plans found",
    });
  }

  const userSettings = await db.userSettings.findUnique({
    where: { userId },
  });
  const effectiveVdot = await getEffectiveVdot(userId);
  const hrCtx =
    userSettings?.hrMax && userSettings?.hrRest
      ? { hrMax: userSettings.hrMax, hrRest: userSettings.hrRest }
      : undefined;
  const userMaxEstimates =
    (userSettings?.exerciseMaxEstimates as Record<string, number> | null) ?? null;

  const constraints = constraintsFromUserSettings({
    forcedRestDaysIso: userSettings?.forcedRestDays ?? null,
    preferredLongRunDayIso: userSettings?.preferredLongRunDay ?? null,
  });

  const beforeSummary = plansToRegen.map((p) => ({
    weekNumber: p.weekNumber,
    startDate: p.startDate.toISOString().slice(0, 10),
    sessionCount: Array.isArray(p.plannedSessions)
      ? (p.plannedSessions as unknown[]).length
      : 0,
  }));

  let regenerated = 0;
  let prevWeekData: WeekStrengthData | null = null;

  for (const plan of plansToRegen) {
    const phaseConfig = plan.phase.config as unknown as PhaseConfig;
    if (!phaseConfig) continue;

    const runPlan = generateWeekRunPlan(
      phaseConfig,
      plan.weekNumber,
      effectiveVdot,
      plan.startDate,
      hrCtx,
    );
    const strengthPlan: WeekStrengthPlan = generateWeekStrengthPlan(
      phaseConfig,
      plan.weekNumber,
      plan.startDate,
      prevWeekData,
      // Sprint v0.12: respect manual therapy-phase override.
      (userSettings?.therapyPhaseOverride as
        | "REACTIVE"
        | "DISREPAIR"
        | "REMODELING"
        | "SPORT_SPECIFIC"
        | null) ?? null,
      userMaxEstimates,
    );

    const mergedSessions: SessionPlan[] = planWeekSchedule(
      runPlan.sessions,
      strengthPlan.sessions,
      plan.startDate,
      constraints,
    );

    await db.weeklyPlan.update({
      where: { id: plan.id },
      data: { plannedSessions: mergedSessions as unknown as object },
    });
    regenerated += 1;

    prevWeekData = {
      weekNumber: plan.weekNumber,
      sessions: strengthPlan.sessions
        .filter((s) =>
          ["strength_a", "strength_b", "strength_c"].includes(s.type),
        )
        .map(
          (s) =>
            ({
              type: s.type,
            }) as WeekStrengthData["sessions"][number],
        ),
    };
  }

  // Best-effort Garmin re-sync.
  const garminResync =
    userSettings?.garminWorkoutPushEnabled
      ? await resyncFutureWorkoutsToGarmin(userId, today0)
      : { considered: 0, removed: 0, repushed: 0, errors: [] };

  return NextResponse.json({
    status: "ok",
    regenerated,
    constraints: {
      forcedRestDaysIso: userSettings?.forcedRestDays ?? "default",
      preferredLongRunDayIso: userSettings?.preferredLongRunDay ?? "default",
    },
    before: beforeSummary,
    garminResync,
  });
}
