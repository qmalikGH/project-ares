// POST /api/settings/training-days
// Body: { forcedRestDays: number[], preferredLongRunDay: number }  (ISO 1=Mon..7=Sun)
//
// Sprint v0.10. Updates UserSettings.{forcedRestDays, preferredLongRunDay},
// regenerates EVERY future WeeklyPlan.plannedSessions with the new schedule
// constraints (and the v0.10 periodization + volume progression engine), then
// re-syncs Garmin so any pushed workouts that no longer match the new plan
// are removed/replaced.
//
// Best-effort: Garmin failures captured into resync result but never block
// the response. v0.9 daily push remains compatible (idempotent).
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { generateWeekRunPlan } from "@/lib/coach-engine/run-coach";
import { generateWeekStrengthPlan } from "@/lib/coach-engine/strength-coach";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { resyncFutureWorkoutsToGarmin } from "@/lib/garmin/workout-sync";
import {
  getEffectiveVdot,
  getOrCreateUserSettings,
} from "@/lib/db/queries/settings";
import type {
  PhaseConfig,
  SessionPlan,
  WeekStrengthData,
  WeekStrengthPlan,
} from "@/lib/coach-engine/types";

const Schema = z.object({
  // ISO 1=Mon..7=Sun. 1-4 forced rest days allowed.
  forcedRestDays: z.array(z.number().int().min(1).max(7)).min(1).max(4),
  // ISO 1=Mon..7=Sun
  preferredLongRunDay: z.number().int().min(1).max(7),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { forcedRestDays, preferredLongRunDay } = parsed.data;
  if (forcedRestDays.includes(preferredLongRunDay)) {
    return NextResponse.json(
      { error: "preferredLongRunDay cannot also be a forced rest day" },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  await getOrCreateUserSettings(userId);

  // 1. Persist new schedule preferences.
  await db.userSettings.update({
    where: { userId },
    data: { forcedRestDays, preferredLongRunDay },
  });

  // 2. Regenerate every future WeeklyPlan in the active macrocycle with the
  // new constraints + the v0.10 periodization engine.
  const today0 = dayKey(new Date());
  const futurePlans = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      startDate: { gte: today0 },
    },
    include: { phase: true },
    orderBy: { startDate: "asc" },
  });

  const userSettings = await db.userSettings.findUnique({ where: { userId } });
  const effectiveVdot = await getEffectiveVdot(userId);
  const hrCtx =
    userSettings?.hrMax && userSettings?.hrRest
      ? { hrMax: userSettings.hrMax, hrRest: userSettings.hrRest }
      : undefined;

  const constraints = constraintsFromUserSettings({
    forcedRestDaysIso: forcedRestDays,
    preferredLongRunDayIso: preferredLongRunDay,
  });

  let regenerated = 0;
  let prevWeekData: WeekStrengthData | null = null;

  for (const plan of futurePlans) {
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
      null, // therapyPhase: not threaded here; LimitationsLogic re-evaluates daily
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

    // Carry strength sessions forward as prevWeekData so periodization
    // chains (W2 references W1's RPE etc.). For now we don't have
    // executedSession data here — rpeReported stays undefined and the
    // engine falls back to pure week-pattern progression.
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

  // 3. Re-sync Garmin (Sprint v0.9 compat). Best-effort; never fails the request.
  const garminResync =
    userSettings?.garminWorkoutPushEnabled
      ? await resyncFutureWorkoutsToGarmin(userId, today0)
      : { considered: 0, removed: 0, repushed: 0, errors: [] };

  return NextResponse.json({
    status: "ok",
    regenerated,
    garminResync,
  });
}
