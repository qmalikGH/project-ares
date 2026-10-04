// GET /api/sessions/open/candidates?days=7 — Sprint 3.2a
//
// Garmin activities that could be the real recording of an open, unlinked
// session on /confirm. Separate from /api/sessions/open on purpose: that route
// is DB-only and renders the screen at once; this one needs a Garmin login and
// may be slow or fail. The screen loads it afterwards and works without it.
//
// Suggestions only. Nothing is linked until the athlete taps a candidate and
// POST /api/sessions/confirm imports it.
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import { listActivitiesInRange } from "@/lib/garmin/activities";
import { disciplineOf, matchConfirmCandidates } from "@/lib/garmin/confirm-candidates";
import type { SessionPlan } from "@/lib/coach-engine/types";

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();

  const url = new URL(req.url);
  const raw = Number.parseInt(url.searchParams.get("days") ?? "7", 10);
  const days = Math.max(1, Math.min(30, Number.isFinite(raw) ? raw : 7));

  const today0 = await userTodayDynamic();
  const from = new Date(today0.getTime() - days * 86400000);

  // Only "planned" rows need a recording — garmin_auto rows already have one.
  const open = await db.workout.findMany({
    where: { userId, status: "planned", date: { gte: from, lt: today0 }, type: { not: "rest" } },
    select: { id: true, date: true, type: true, plannedSession: true },
  });
  const sessions = open
    .map((w) => ({
      id: w.id,
      date: w.date.toISOString().slice(0, 10),
      discipline: disciplineOf(w.type),
      plannedDurationMin: (w.plannedSession as SessionPlan | null)?.durationMin ?? null,
    }))
    .filter((s) => s.discipline !== "other");

  if (sessions.length === 0) {
    return NextResponse.json({ status: "ok", candidates: {} });
  }

  // An activity already behind any workout (auto-imported, or picked earlier)
  // is never offered again.
  const linked = await db.workout.findMany({
    where: {
      userId,
      garminActivityId: { not: null },
      date: { gte: new Date(from.getTime() - 2 * 86400000) },
    },
    select: { garminActivityId: true },
  });
  const linkedIds = new Set(linked.map((w) => w.garminActivityId as string));

  try {
    // ±1 day around the window: the day before the oldest session up to today.
    const activities = await listActivitiesInRange(
      new Date(from.getTime() - 86400000),
      today0,
    );
    return NextResponse.json({
      status: "ok",
      candidates: matchConfirmCandidates(sessions, activities, linkedIds),
    });
  } catch (e) {
    // 200, not 5xx: the screen must keep working without suggestions.
    return NextResponse.json({
      status: "garmin_unavailable",
      candidates: {},
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
