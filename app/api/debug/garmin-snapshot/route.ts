// GET /api/debug/garmin-snapshot
//
// Returns a 7-day snapshot of every Garmin-sourced datapoint Ares persists:
//   - DailySensorData.garmin per day (sleep / RHR / HRV / body battery)
//   - GarminSyncLog rows (sync health + per-datatype flags)
//   - Workout rows with garminActivityId or garminWorkoutId in the window
//     (executed activity payloads + push-to-watch state)
//
// Read-only, single-user. Auth: session OR Bearer CRON_SECRET (matches
// the other /api/debug/* endpoints).
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { resolveRouteUserId } from "@/lib/auth/route-user";
import { userTodayDynamic } from "@/lib/date";

export async function GET(req: NextRequest) {
  // Sprint 2.5: shared resolver. A GET has no body, so the bearer path resolves
  // the athlete directly.
  const userId = await resolveRouteUserId(req);

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = Math.max(1, Math.min(30, Number.parseInt(daysParam ?? "7", 10) || 7));

  const today = await userTodayDynamic();
  const start = new Date(today.getTime() - (days - 1) * 86400000);
  const end = new Date(today.getTime() + 86400000); // exclusive upper bound

  const [sensors, syncLogs, workouts] = await Promise.all([
    db.dailySensorData.findMany({
      where: { userId, date: { gte: start, lt: end } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        garmin: true,
        garminLastSyncAt: true,
        // Sprint 2.8: the five v0.16 energy columns were missing from this
        // select, which is why two months of NULL calories were invisible in
        // the one endpoint built to make Garmin state visible.
        totalKilocalories: true,
        activeKilocalories: true,
        bmrKilocalories: true,
        bodyBatteryEnd: true,
        averageStress: true,
        readinessScore: true,
        readinessBand: true,
        therapyPhase: true,
      },
    }),
    db.garminSyncLog.findMany({
      where: { userId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        status: true,
        hrvSyncOk: true,
        sleepSyncOk: true,
        bodyBatterySyncOk: true,
        rhrSyncOk: true,
        activitiesSyncOk: true,
        energySyncOk: true,
        errorType: true,
        errorMessage: true,
      },
    }),
    db.workout.findMany({
      where: {
        userId,
        date: { gte: start, lt: end },
        OR: [
          { garminActivityId: { not: null } },
          { garminWorkoutId: { not: null } },
        ],
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        type: true,
        status: true,
        garminActivityId: true,
        garminWorkoutId: true,
        garminScheduledWorkoutId: true,
        garminScheduledAt: true,
        garminPushStatus: true,
        garminPushError: true,
        executedSession: true,
      },
    }),
  ]);

  return NextResponse.json({
    status: "ok",
    window: {
      start: start.toISOString().slice(0, 10),
      end: today.toISOString().slice(0, 10),
      days,
    },
    sensors,
    syncLogs,
    workouts,
  });
}
