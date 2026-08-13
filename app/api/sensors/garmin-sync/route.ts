// POST /api/sensors/garmin-sync
// Manual or pre-workout Garmin sync. Always logs to GarminSyncLog (success or failure).
// Body: { date?: ISOString }  (defaults to today)
//
// Sprint 2.8: this route no longer writes DailySensorData itself. It used to,
// and it wrote only the `garmin` JSON — the five v0.16 energy columns were
// added to the cron and never back-ported here, so a manual sync reported
// SUCCESS while leaving the calorie columns NULL. Persistence now lives in
// lib/garmin/persist.ts, shared with the cron, so the two cannot drift again.
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { userTodayDynamic } from "@/lib/date";
import { syncGarminForDate, type SyncResult } from "@/lib/garmin/sync";
import { persistGarminSync, writeGarminSyncFailureLog } from "@/lib/garmin/persist";

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
  // Sprint 2.8: the default used to be `dayKey(new Date())` — the UTC date, which
  // lib/date.ts:117-129 documents as the exact bug userToday() exists to avoid.
  // Between 00:00 and 02:00 Berlin a manual sync wrote into yesterday's row.
  const date = parsed.data.date
    ? dayKey(new Date(parsed.data.date))
    : await userTodayDynamic();

  let result: SyncResult;
  try {
    result = await syncGarminForDate(date);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeGarminSyncFailureLog(userId, message);
    return NextResponse.json({ status: "FAILURE", error: message }, { status: 502 });
  }

  const outcome = await persistGarminSync({ userId, date, result });

  // A FAILURE result (rather than a throw) used to return 200 here, and
  // GarminSyncIndicator treats any 200 as success — so a sync that wrote nothing
  // rendered as a green tick.
  const httpStatus = result.status === "FAILURE" ? 502 : 200;

  return NextResponse.json({
    status: result.status,
    wrote: outcome.wrote,
    preserved: outcome.preserved,
    withheldDayTotals: outcome.withheldDayTotals,
    snapshot: result.snapshot,
    flags: result.flags,
    activitiesCount: result.activitiesCount,
    errors: result.errors,
  }, { status: httpStatus });
}
