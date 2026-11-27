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
      energySyncOk: true,
      errorType: true,
      targetDate: true,
    },
  });

  // Sprint 3.4 (#28): "last sync" is the row for the most recent DAY, not the
  // most recently written row — a gap-sweep row for D-4 is written after the
  // row for yesterday and used to show up as the latest sync. Rows from before
  // targetDate existed (null) sort last.
  const lastByDay = await db.garminSyncLog.findFirst({
    where: { userId },
    orderBy: [{ targetDate: { sort: "desc", nulls: "last" } }, { syncedAt: "desc" }],
    select: {
      id: true,
      syncedAt: true,
      status: true,
      hrvSyncOk: true,
      sleepSyncOk: true,
      bodyBatterySyncOk: true,
      rhrSyncOk: true,
      activitiesSyncOk: true,
      energySyncOk: true,
      errorType: true,
      targetDate: true,
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
    lastSync: lastByDay ?? recent[0] ?? null,
    history: recent,
    consecutiveFailures,
  });
}
