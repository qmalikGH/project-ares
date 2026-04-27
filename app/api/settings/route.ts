// GET /api/settings    → current settings + computed effective values
// PATCH /api/settings  → update toggles (AI coach, model override, garmin override, notifications)
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId, getCurrentUser } from "@/lib/auth/current-user";
import {
  DEFAULT_NOTIFICATION_PREFS,
  getEffectiveVdot,
  getOrCreateUserSettings,
} from "@/lib/db/queries/settings";

export async function GET() {
  const userId = await getCurrentUserId();
  const user = await getCurrentUser();
  const settings = await getOrCreateUserSettings(userId);
  const effectiveVdot = await getEffectiveVdot(userId);

  return NextResponse.json({
    status: "ok",
    account: {
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    },
    garmin: {
      hasOverride: !!settings.garminUsernameOverride,
      usernameDisplay: settings.garminUsernameOverride ?? null,
      // password never echoed back
    },
    aiCoach: {
      enabled: settings.aiCoachEnabled,
      modelOverride: settings.aiModelPrimaryOverride,
      effectiveModel: settings.aiModelPrimaryOverride ?? process.env.AI_MODEL_PRIMARY ?? "claude-opus-4-7",
    },
    vdot: {
      effective: effectiveVdot,
      override: settings.vdotOverride,
      overrideAt: settings.vdotOverrideAt?.toISOString() ?? null,
      overrideRationale: settings.vdotOverrideRationale,
    },
    notifications: settings.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS,
  });
}

const PatchSchema = z.object({
  garminUsernameOverride: z.string().min(3).max(200).nullable().optional(),
  garminPasswordOverride: z.string().min(1).max(200).nullable().optional(),
  aiCoachEnabled: z.boolean().optional(),
  aiModelPrimaryOverride: z.string().min(3).max(60).nullable().optional(),
  notificationPrefs: z
    .object({
      garminFailure: z.boolean(),
      blockReviewDue: z.boolean(),
      timeTrialToday: z.boolean(),
      vdotCalibrated: z.boolean(),
    })
    .optional(),
});

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  await getOrCreateUserSettings(userId); // ensure row exists

  const updated = await db.userSettings.update({
    where: { userId },
    data: parsed.data,
  });

  return NextResponse.json({ status: "ok", settings: updated });
}
