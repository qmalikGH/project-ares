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
import { userTodayDynamic } from "@/lib/date";
import { resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";

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
  const today0 = await userTodayDynamic();

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

  const beforeSummary = plansToRegen.map((p) => ({
    weekNumber: p.weekNumber,
    startDate: p.startDate.toISOString().slice(0, 10),
    sessionCount: Array.isArray(p.plannedSessions)
      ? (p.plannedSessions as unknown[]).length
      : 0,
  }));

  // Sprint 2.4: this route used to carry its OWN copy of the regeneration loop,
  // which never passed `greenForProgression`, the shin volume gate, or the
  // comeback ramp. It is the endpoint the ops scripts call — so the one path
  // used to roll a plan out to the watch was the one path with no brakes.
  // Delegate to the shared helper; the route keeps only the extras that make
  // it useful for ops (before-summary, materialize, Garmin re-sync).
  const { regenerated, gate, layoff } = await regeneratePlansFromNow(userId);

  // Sprint v1.6: Materialize Workout rows so the Garmin-push cron and
  // session-start flow always find them. Must run BEFORE Garmin re-sync.
  const materialized = await materializeWorkouts(userId, today0);

  // Best-effort Garmin re-sync.
  const garminResync =
    userSettings?.garminWorkoutPushEnabled
      ? await resyncFutureWorkoutsToGarmin(userId, today0)
      : { considered: 0, removed: 0, repushed: 0, errors: [] };

  return NextResponse.json({
    status: "ok",
    regenerated,
    materialized,
    gate,
    layoff,
    constraints: {
      forcedRestDaysIso: userSettings?.forcedRestDays ?? "default",
      preferredLongRunDayIso: userSettings?.preferredLongRunDay ?? "default",
    },
    before: beforeSummary,
    garminResync,
  });
}
