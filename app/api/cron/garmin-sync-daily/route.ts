// GET /api/cron/garmin-sync-daily
// Vercel Cron: 0 5 * * * (daily at 05:00 UTC).
// Pulls Garmin data for the prior day for every active user.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";
import { syncGarminForDate, classifyError } from "@/lib/garmin/sync";

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return process.env.CRON_SECRET ? auth === expected : false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // For v0.1 single-user mode this is just Q. Once multi-user lands, iterate.
  const users = await db.user.findMany({
    where: { goals: { some: { status: "active" } } },
    select: { id: true },
  });

  const today = userToday();
  const yesterday = new Date(today.getTime() - 86400000);

  const results: Array<{ userId: string; status: string; errors: number }> = [];

  for (const user of users) {
    try {
      const result = await syncGarminForDate(yesterday);
      await db.garminSyncLog.create({
        data: {
          userId: user.id,
          status: result.status,
          hrvSyncOk: result.flags.hrvSyncOk,
          sleepSyncOk: result.flags.sleepSyncOk,
          bodyBatterySyncOk: result.flags.bodyBatterySyncOk,
          rhrSyncOk: result.flags.rhrSyncOk,
          activitiesSyncOk: result.flags.activitiesSyncOk,
          errorType: result.errors[0] ? classifyError(result.errors[0].message) : null,
          errorMessage: result.errors.length > 0
            ? result.errors.map((e) => `${e.datatype}: ${e.message}`).join(" | ")
            : null,
        },
      });

      const garminPayload = {
        hrvStatus: result.snapshot.hrvStatus,
        hrvRmssd: result.snapshot.hrvRmssd,
        sleepScore: result.snapshot.sleepScore,
        sleepDurationMin: result.snapshot.sleepDurationMin,
        bodyBatteryMorning: result.snapshot.bodyBatteryMorning,
        rhr: result.snapshot.rhr,
      };
      const existing = await db.dailySensorData.findFirst({ where: { userId: user.id, date: yesterday } });
      if (existing) {
        await db.dailySensorData.update({
          where: { id: existing.id },
          data: { garmin: garminPayload, garminLastSyncAt: new Date(), updatedAt: new Date() },
        });
      } else {
        await db.dailySensorData.create({
          data: { userId: user.id, date: yesterday, garmin: garminPayload, garminLastSyncAt: new Date() },
        });
      }

      results.push({ userId: user.id, status: result.status, errors: result.errors.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.garminSyncLog.create({
        data: {
          userId: user.id,
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
      results.push({ userId: user.id, status: "FAILURE", errors: 1 });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), syncedFor: yesterday.toISOString(), results });
}
