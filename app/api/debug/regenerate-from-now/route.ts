// POST /api/debug/regenerate-from-now
//
// Regenerates the CURRENT week's plan + all future weeks using the current
// schedule-strategy. Originally a one-time data fix (v0.10 layout drift), now
// also the required follow-up step after a Block reset, which creates
// WeeklyPlan rows with empty plannedSessions.
//
// Uses `endDate > today` (not `startDate >= today`) so the week in progress is
// included. The work itself lives in lib/coach-engine/regenerate.ts so offline
// scripts run the identical path without going through HTTP.
//
// Auth:
//   - Browser/session: cookie-based, runs against the logged-in user.
//   - Service: `Authorization: Bearer <CRON_SECRET>` + JSON body `{ userId }`.
//     Lets out-of-band callers (cron, ops, agent) trigger regen without a session.
//
// Best-effort: Garmin re-sync runs after but never fails the request.
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import { regenerateFuturePlans } from "@/lib/coach-engine/regenerate";

async function resolveUserId(req: NextRequest): Promise<string | NextResponse> {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth === `Bearer ${secret}`) {
    let body: { userId?: unknown } = {};
    try {
      body = (await req.json()) as { userId?: unknown };
    } catch {
      // empty / non-JSON body — fall through to validation below
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

export async function POST(req: NextRequest) {
  const resolved = await resolveUserId(req);
  if (resolved instanceof NextResponse) return resolved;
  const userId = resolved;
  const today0 = await userTodayDynamic();

  const summary = await regenerateFuturePlans(userId, today0);

  if (summary.before.length === 0) {
    return NextResponse.json({
      status: "ok",
      regenerated: 0,
      message: "No active future plans found",
    });
  }

  return NextResponse.json({ status: "ok", ...summary });
}
