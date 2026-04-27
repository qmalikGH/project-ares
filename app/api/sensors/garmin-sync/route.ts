// POST /api/sensors/garmin-sync
// Manual or pre-workout Garmin sync. Always logs to GarminSyncLog (success or failure).
// Body: { date?: ISOString }  (defaults to today)
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { syncGarminForDate, classifyError, type SyncResult } from "@/lib/garmin/sync";
import { createNotificationIfNew } from "@/lib/notifications/create";

async function maybeNotifyOnFailures(userId: string) {
  const recent = await db.garminSyncLog.findMany({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    take: 5,
    select: { status: true },
  });
  let consecutive = 0;
  for (const r of recent) {
    if (r.status === "FAILURE") consecutive++;
    else break;
  }
  if (consecutive === 2) {
    await createNotificationIfNew({
      userId,
      type: "GARMIN_SYNC_FAILURE",
      title: "Garmin Sync hat 2x in Folge fehlgeschlagen",
      message: "Du kannst Sensoren manuell eingeben. Wenn das Problem bleibt, prüfe deine Garmin Credentials.",
      severity: "WARNING",
      actionUrl: "/settings",
    });
  } else if (consecutive >= 5) {
    await createNotificationIfNew({
      userId,
      type: "GARMIN_SYNC_FAILURE",
      title: "Garmin Sync seit 5+ Tagen ausgefallen",
      message: "Auto-Sync wurde temporär deaktiviert. Manuell weiterarbeiten oder Credentials prüfen.",
      severity: "CRITICAL",
      actionUrl: "/settings",
    });
  }
}

const Schema = z.object({ date: z.string().optional() });

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body OK */
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  const date = dayKey(parsed.data.date ? new Date(parsed.data.date) : new Date());

  let result: SyncResult;
  try {
    result = await syncGarminForDate(date);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.garminSyncLog.create({
      data: {
        userId,
        status: "FAILURE",
        hrvSyncOk: false,
        sleepSyncOk: false,
        bodyBatterySyncOk: false,
        rhrSyncOk: false,
        activitiesSyncOk: false,
        errorType: classifyError(message),
        errorMessage: message,
      },
    });
    await maybeNotifyOnFailures(userId);
    return NextResponse.json({ status: "FAILURE", error: message }, { status: 502 });
  }

  // Persist sync log
  await db.garminSyncLog.create({
    data: {
      userId,
      status: result.status,
      hrvSyncOk: result.flags.hrvSyncOk,
      sleepSyncOk: result.flags.sleepSyncOk,
      bodyBatterySyncOk: result.flags.bodyBatterySyncOk,
      rhrSyncOk: result.flags.rhrSyncOk,
      activitiesSyncOk: result.flags.activitiesSyncOk,
      errorType: result.errors[0] ? classifyError(result.errors[0].message) : null,
      errorMessage: result.errors.length > 0 ? result.errors.map((e) => `${e.datatype}: ${e.message}`).join(" | ") : null,
    },
  });

  // Persist sensor snapshot — merge with existing user-morning data if present
  const existing = await db.dailySensorData.findFirst({ where: { userId, date } });
  const garminPayload = {
    hrvStatus: result.snapshot.hrvStatus,
    hrvRmssd: result.snapshot.hrvRmssd,
    sleepScore: result.snapshot.sleepScore,
    sleepDurationMin: result.snapshot.sleepDurationMin,
    bodyBatteryMorning: result.snapshot.bodyBatteryMorning,
    rhr: result.snapshot.rhr,
  };

  if (existing) {
    await db.dailySensorData.update({
      where: { id: existing.id },
      data: { garmin: garminPayload, garminLastSyncAt: new Date(), updatedAt: new Date() },
    });
  } else {
    await db.dailySensorData.create({
      data: { userId, date, garmin: garminPayload, garminLastSyncAt: new Date() },
    });
  }

  if (result.status === "FAILURE") await maybeNotifyOnFailures(userId);

  return NextResponse.json({
    status: result.status,
    snapshot: result.snapshot,
    flags: result.flags,
    activitiesCount: result.activitiesCount,
    errors: result.errors,
  });
}
