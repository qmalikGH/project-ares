// GET /api/sessions/open/candidates?days=14 — Sprint 3.2a (3.3b: default 14)
//
// Garmin activities that could be the real recording of an open, unlinked
// session on /confirm. Separate from /api/sessions/open on purpose: that route
// renders the screen at once; this one may touch Garmin. The screen loads it
// afterwards and works without it.
//
// Suggestions only. Nothing is linked until the athlete taps a candidate and
// POST /api/sessions/confirm imports it.
//
// Sprint 3.3b (#25 · 9): also `freeRuns` — run activities with no session to
// belong to, offered on the "Freier Lauf" form (POST /api/sessions/free-run).
//
// Sprint 3.4 (#28, B3): the activities come from the raw store
// (GarminActivity), which the nightly cron fills for the last 14 days. One
// live page is fetched first so a run from this morning shows up too; if
// Garmin is down, the stored activities still make suggestions.
//
// Coach, 27.11. (#28 a): a run card also offers the activity behind an
// unrated free run the cron created on the same day (`fromAutoRun`) — the
// threshold run that was not started from the pushed workout. Picking it
// moves the activity to the card (POST /api/sessions/confirm).
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import type { ActivitySummary } from "@/lib/garmin/activities";
import { fetchActivitiesSince, upsertGarminActivities } from "@/lib/garmin/activity-store";
import {
  CONFIRM_WINDOW_DAYS,
  disciplineOf,
  matchConfirmCandidates,
  unplannedRunActivities,
} from "@/lib/garmin/confirm-candidates";
import type { SessionPlan } from "@/lib/coach-engine/types";
import { isClaimableAutoRun } from "@/lib/sessions/free-run";

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();

  const url = new URL(req.url);
  const raw = Number.parseInt(url.searchParams.get("days") ?? String(CONFIRM_WINDOW_DAYS), 10);
  const days = Math.max(1, Math.min(30, Number.isFinite(raw) ? raw : CONFIRM_WINDOW_DAYS));

  const today0 = await userTodayDynamic();
  const from = new Date(today0.getTime() - days * 86400000);
  // ±1 day around the window for the cards: the day before the oldest session.
  const activitiesFrom = new Date(from.getTime() - 86400000);

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

  // Days the free-run route would refuse (one easy run per day).
  const easyRuns = await db.workout.findMany({
    where: { userId, type: "easy_run", date: { gte: from, lte: today0 } },
    select: { date: true },
  });

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

  // Free runs the cron created that nobody rated yet: their activity stays on
  // offer for a run card of the same day.
  const autoRuns = await db.workout.findMany({
    where: { userId, type: "easy_run", status: "completed", rpe: null, date: { gte: from, lt: today0 } },
    select: {
      id: true, type: true, status: true, rpe: true, plannedSession: true, executedSession: true,
      garminActivityId: true,
    },
  });
  const claimable = new Set(
    autoRuns.filter((w) => isClaimableAutoRun(w) && w.garminActivityId).map((w) => w.garminActivityId as string),
  );
  const claimableWorkoutIds = autoRuns
    .filter((w) => w.garminActivityId && claimable.has(w.garminActivityId))
    .map((w) => w.id);

  // Freshen the store with the newest page; best-effort.
  let garminError: string | null = null;
  try {
    const page = await fetchActivitiesSince(activitiesFrom.toISOString().slice(0, 10), { maxPages: 1 });
    await upsertGarminActivities(userId, page.activities);
  } catch (e) {
    garminError = e instanceof Error ? e.message : String(e);
  }

  const stored = await db.garminActivity.findMany({
    where: {
      userId,
      OR: [{ workoutRefId: null }, { workoutRefId: { in: claimableWorkoutIds } }],
      localDate: { gte: activitiesFrom, lte: today0 },
    },
    orderBy: [{ localDate: "asc" }, { startTimeLocal: "asc" }],
  });
  const activities: ActivitySummary[] = stored.map((a) => ({
    activityId: Number(a.activityId),
    activityName: a.activityName ?? "Activity",
    startTimeLocal: a.startTimeLocal,
    startTimeGMT: a.startTimeGMT?.toISOString() ?? "",
    category: a.category as ActivitySummary["category"],
    durationSec: a.durationSec,
    distanceM: a.distanceM,
    averageHr: a.averageHr,
    maxHr: a.maxHr,
    averagePaceSecPerKm: a.averagePaceSecPerKm,
    elevationGainM: a.elevationGainM,
    calories: a.calories,
    workoutId: a.workoutId != null ? Number(a.workoutId) : null,
  }));

  // 200, not 5xx. The stored activities are valid suggestions even when the
  // live page failed, so the status stays "ok"; `liveRefresh` says whether
  // this morning's activities could be fetched.
  return NextResponse.json({
    status: "ok",
    liveRefresh: garminError == null,
    candidates: matchConfirmCandidates(sessions, activities, linkedIds, claimable),
    freeRuns: unplannedRunActivities(
      easyRuns.map((w) => w.date.toISOString().slice(0, 10)),
      activities,
      linkedIds,
      from.toISOString().slice(0, 10),
    ),
    ...(garminError ? { error: garminError } : {}),
  });
}
