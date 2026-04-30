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
import { computeHrZones } from "@/lib/coach-engine/hr-zones";

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
      workoutPushEnabled: settings.garminWorkoutPushEnabled,
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
    hrZones: (() => {
      if (settings.hrMax == null || settings.hrRest == null) {
        return {
          configured: false as const,
          hrMax: null,
          hrRest: null,
          source: settings.hrZonesSource,
          updatedAt: settings.hrZonesUpdatedAt?.toISOString() ?? null,
        };
      }
      try {
        const zones = computeHrZones({
          hrMax: settings.hrMax,
          hrRest: settings.hrRest,
        });
        return {
          configured: true as const,
          hrMax: settings.hrMax,
          hrRest: settings.hrRest,
          source: settings.hrZonesSource,
          updatedAt: settings.hrZonesUpdatedAt?.toISOString() ?? null,
          z1Max: zones.z1Max,
          z2Max: zones.z2Max,
        };
      } catch {
        return {
          configured: false as const,
          hrMax: settings.hrMax,
          hrRest: settings.hrRest,
          source: settings.hrZonesSource,
          updatedAt: settings.hrZonesUpdatedAt?.toISOString() ?? null,
        };
      }
    })(),
    notifications: settings.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS,
    // Sprint v0.10: schedule constraints (ISO 1=Mon..7=Sun).
    schedule: {
      forcedRestDays: settings.forcedRestDays ?? [3, 7],
      preferredLongRunDay: settings.preferredLongRunDay ?? 6,
    },
    // Sprint v0.12: manual therapy-phase override. null = auto (engine
    // derives daily from DailySensorData.therapyPhase via limitations).
    therapyPhaseOverride: settings.therapyPhaseOverride ?? null,
  });
}

const PatchSchema = z.object({
  garminUsernameOverride: z.string().min(3).max(200).nullable().optional(),
  garminPasswordOverride: z.string().min(1).max(200).nullable().optional(),
  aiCoachEnabled: z.boolean().optional(),
  aiModelPrimaryOverride: z.string().min(3).max(60).nullable().optional(),
  hrMax: z.number().int().min(120).max(220).nullable().optional(),
  hrRest: z.number().int().min(30).max(90).nullable().optional(),
  hrZonesSource: z.enum(["manual", "garmin_lthr", "field_test"]).nullable().optional(),
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
  const existing = await getOrCreateUserSettings(userId);

  // If both hrMax & hrRest end up set together, validate Karvonen spread + stamp updatedAt.
  const data: Record<string, unknown> = { ...parsed.data };
  const hrTouched =
    "hrMax" in parsed.data || "hrRest" in parsed.data;
  if (hrTouched) {
    const nextHrMax =
      "hrMax" in parsed.data ? (parsed.data.hrMax ?? null) : existing.hrMax;
    const nextHrRest =
      "hrRest" in parsed.data ? (parsed.data.hrRest ?? null) : existing.hrRest;
    if (nextHrMax !== null && nextHrRest !== null) {
      try {
        computeHrZones({ hrMax: nextHrMax, hrRest: nextHrRest });
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : "Invalid HR thresholds (spread too small).",
          },
          { status: 400 },
        );
      }
    }
    data.hrZonesUpdatedAt = new Date();
    if (!("hrZonesSource" in parsed.data)) {
      data.hrZonesSource = "manual";
    }
  }

  const updated = await db.userSettings.update({
    where: { userId },
    data,
  });

  return NextResponse.json({ status: "ok", settings: updated });
}
