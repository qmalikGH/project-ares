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
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";

async function resolveUserId(req: NextRequest): Promise<string | NextResponse> {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth === `Bearer ${secret}`) {
    let body: { userId?: unknown } = {};
    try {
      body = (await req.json()) as { userId?: unknown };
    } catch {
      // empty body
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

export async function GET(req: NextRequest) {
  const resolved = await resolveUserId(req);
  if (resolved instanceof NextResponse) return resolved;
  const userId = resolved;

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
