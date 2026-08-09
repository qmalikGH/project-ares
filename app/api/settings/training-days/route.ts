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
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import { getOrCreateUserSettings } from "@/lib/db/queries/settings";

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

  // 2. Regenerate the current week + every future WeeklyPlan with the new
  // constraints, then re-sync Garmin (schedule changes move what is on the
  // watch, so the re-sync is not optional here).
  //
  // Sprint 2.4: this used to inline its own regeneration loop without the
  // shin/RHR gate or the comeback ramp — changing a rest day would quietly
  // rewrite the braked week back to full volume. Delegating to the shared
  // helper keeps every regeneration path braked by construction.
  //
  // Note the widened window: the helper regenerates `endDate > today` (the
  // current week included), where this route previously used
  // `startDate >= today`. That is the correct behaviour — a schedule change
  // should move the rest of the current week too, not just next Monday.
  const { regenerated, garminResync } = await regeneratePlansFromNow(userId, {
    runGarminResync: true,
  });

  return NextResponse.json({
    status: "ok",
    regenerated,
    garminResync: garminResync ?? { considered: 0, removed: 0, repushed: 0, errors: [] },
  });
}
