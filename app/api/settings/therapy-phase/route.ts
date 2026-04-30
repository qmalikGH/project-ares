// POST /api/settings/therapy-phase
//
// Sprint v0.12. Persists a manual therapy-phase override on UserSettings and
// regenerates the current + future WeeklyPlans so Wall Sit insertion
// reflects the new state immediately. Pass null to clear the override
// (engine falls back to the daily-derived DailySensorData.therapyPhase).
//
// Body: { therapyPhase: "REACTIVE" | "DISREPAIR" | "REMODELING" | "SPORT_SPECIFIC" | null }
//
// Triggers a Garmin re-sync because Wall Sit / strength session structure
// can change — the watch's pushed Strength workouts reflect the new shape.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";

const Schema = z.object({
  therapyPhase: z
    .enum(["REACTIVE", "DISREPAIR", "REMODELING", "SPORT_SPECIFIC"])
    .nullable(),
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

  const userId = await getCurrentUserId();

  await db.userSettings.upsert({
    where: { userId },
    update: { therapyPhaseOverride: parsed.data.therapyPhase },
    create: {
      userId,
      therapyPhaseOverride: parsed.data.therapyPhase,
    },
  });

  const result = await regeneratePlansFromNow(userId, { runGarminResync: true });

  return NextResponse.json({ status: "ok", ...result });
}
