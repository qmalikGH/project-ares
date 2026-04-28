// PATCH /api/settings/garmin-push
// Body: { enabled: boolean }
//
// Toggles garminWorkoutPushEnabled on UserSettings. Separate endpoint (rather
// than rolling into /api/settings PATCH) so the toggle UI doesn't need to
// know the entire settings shape.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getOrCreateUserSettings } from "@/lib/db/queries/settings";

const Schema = z.object({ enabled: z.boolean() });

export async function PATCH(req: Request) {
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
  await getOrCreateUserSettings(userId);

  const updated = await db.userSettings.update({
    where: { userId },
    data: { garminWorkoutPushEnabled: parsed.data.enabled },
    select: { garminWorkoutPushEnabled: true },
  });

  return NextResponse.json({ status: "ok", ...updated });
}
