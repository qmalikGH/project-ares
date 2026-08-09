// POST /api/settings/vdot-override
// Body: { newVdot: number, rationale: string, confirmed?: boolean }
// - Validates 30-80 range, requires rationale ≥ 10 chars
// - If |newVdot - effective| > 3 and !confirmed → 409 with confirmRequired:true
// - Persists override, regenerates pace targets in all FUTURE Run-Sessions
//   (status="planned" AND date > today). Past + in_progress sessions untouched.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  getEffectiveVdot,
  getOrCreateUserSettings,
} from "@/lib/db/queries/settings";
import { regenerateFutureSessionPaces } from "@/lib/db/queries/regenerate";
import { createNotification } from "@/lib/notifications/create";
import {
  VDOT_SOURCE_MANUAL,
  VDOT_TABLE_MIN,
  VDOT_TABLE_MAX,
} from "@/lib/coach-engine/vdot-autocalibration";

// Sprint 2.6 (A6): bounds were 30-80. `vdotToPaces` THROWS above 65, so 66-80
// was accepted here and then blew up in every downstream pace lookup — and
// anything outside the contiguous 35-50 band snaps silently to a neighbouring
// row. Accept only what the pace table can actually represent.
const Schema = z.object({
  newVdot: z.number().int().min(VDOT_TABLE_MIN).max(VDOT_TABLE_MAX),
  rationale: z.string().min(10).max(2000),
  confirmed: z.boolean().optional(),
});

const LARGE_DIFF_THRESHOLD = 3;

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
  const { newVdot, rationale, confirmed } = parsed.data;
  const currentVdot = await getEffectiveVdot(userId);

  if (Math.abs(newVdot - currentVdot) > LARGE_DIFF_THRESHOLD && !confirmed) {
    return NextResponse.json(
      {
        status: "CONFIRM_REQUIRED",
        message: `Differenz ${Math.abs(newVdot - currentVdot)} VDOT-Punkte ist groß. Bitte bestätigen.`,
        currentVdot,
        newVdot,
      },
      { status: 409 },
    );
  }

  await getOrCreateUserSettings(userId);
  await db.userSettings.update({
    where: { userId },
    data: {
      vdotOverride: newVdot,
      vdotOverrideAt: new Date(),
      vdotOverrideRationale: rationale,
      // Sprint 2.6 (A6): this is the one path that marks a value as deliberate.
      // Auto-calibration will not overwrite it for MANUAL_PIN_TTL_DAYS.
      vdotSource: VDOT_SOURCE_MANUAL,
    },
  });

  // Regenerate paces on all future planned run sessions
  const { updatedSessions, updatedPlans, newPaces } =
    await regenerateFutureSessionPaces(userId, newVdot);

  // Skip notification when user has muted this type
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const prefs = settings?.notificationPrefs as
    | { vdotCalibrated?: boolean }
    | null;
  if (prefs?.vdotCalibrated !== false) {
    await createNotification({
      userId,
      type: "VDOT_CALIBRATED",
      title: "VDOT manuell überschrieben",
      message: `${currentVdot} → ${newVdot}. ${updatedSessions} zukünftige Run-Sessions mit neuen Pace-Targets.`,
      severity: "INFO",
      actionUrl: "/settings",
    });
  }

  return NextResponse.json({
    status: "ok",
    previousVdot: currentVdot,
    newVdot,
    updatedSessions,
    updatedPlans,
    newPaces,
  });
}
