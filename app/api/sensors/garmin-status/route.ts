// GET /api/sensors/garmin-status
// Lightweight status: last sync timestamp, last status, recent failure count.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

export async function GET() {
  const userId = await getCurrentUserId();
  const recent = await db.garminSyncLog.findMany({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    take: 5,
    select: {
      id: true,
      syncedAt: true,
      status: true,
      hrvSyncOk: true,
      sleepSyncOk: true,
      bodyBatterySyncOk: true,
      rhrSyncOk: true,
      activitiesSyncOk: true,
      errorType: true,
    },
  });

  const consecutiveFailures = (() => {
    let n = 0;
    for (const r of recent) {
      if (r.status === "FAILURE") n++;
      else break;
    }
    return n;
  })();

  return NextResponse.json({
    lastSync: recent[0] ?? null,
    history: recent,
    consecutiveFailures,
  });
}
