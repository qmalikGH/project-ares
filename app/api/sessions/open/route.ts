// GET /api/sessions/open?days=7
//
// Sessions from the recent past that still need a human. Two cohorts:
//
//   "planned"     — Garmin could not prove it happened (today: every strength
//                   session, plus runs started outside a pushed workout)
//   "garmin_auto" — the nightly import completed it from the watch, but nobody
//                   rated it: no RPE, no shin score
//
// Deliberately NOT an extension of /api/workouts: that route's narrow select
// sits on the /today hot path, and this screen needs the full plannedSession
// and executedSession blobs per row.
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import { willLogExercise } from "@/lib/coach-engine/attest";
import { TM_COMPOUNDS } from "@/lib/coach-engine/strength-coach/progression-mode";
import { disciplineOf } from "@/lib/garmin/confirm-candidates";
import type { Exercise, SessionPlan, SessionType } from "@/lib/coach-engine/types";

export type OpenCohort = "planned" | "garmin_auto";

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();

  const url = new URL(req.url);
  const raw = Number.parseInt(url.searchParams.get("days") ?? "7", 10);
  const days = Math.max(1, Math.min(30, Number.isFinite(raw) ? raw : 7));

  const today0 = await userTodayDynamic();
  const from = new Date(today0.getTime() - days * 86400000);

  // Strictly the past. Today's session goes through the normal flow on /today;
  // offering it here would race the in_progress state.
  const rows = await db.workout.findMany({
    where: {
      userId,
      date: { gte: from, lt: today0 },
      type: { not: "rest" },
      OR: [{ status: "planned" }, { status: "completed", rpe: null }],
    },
    orderBy: { date: "desc" },
    select: {
      id: true, date: true, type: true, status: true, rpe: true,
      durationActualMin: true, garminActivityId: true,
      plannedSession: true, executedSession: true,
    },
  });

  const sessions = [];
  for (const w of rows) {
    const exec = w.executedSession as Record<string, unknown> | null;

    // Cohort is derived here, never trusted from the client on the way back in.
    let cohort: OpenCohort | null = null;
    if (w.status === "planned") cohort = "planned";
    else if (w.status === "completed" && w.rpe == null && exec?.source === "garmin_auto") {
      cohort = "garmin_auto";
    }
    // A hand-logged session that somehow lost its RPE is not this screen's
    // business — re-writing it would risk clobbering real logged sets.
    if (!cohort) continue;

    const planned = (w.plannedSession ?? null) as SessionPlan | null;
    const discipline = disciplineOf(w.type);

    const prescribed =
      discipline === "strength" && planned?.exercises?.length
        ? {
            exercises: (planned.exercises as Exercise[])
              .filter((ex) => !ex.isWarmup)
              .map((ex) => ({
                name: ex.name,
                sets: ex.sets,
                reps: ex.reps,
                loadAbs: ex.loadAbs ?? null,
                // The honesty contract: the screen shows exactly which
                // exercises the "as prescribed" tap will actually record.
                willLog: willLogExercise(ex),
                // Sprint 3.2a: training-max lifts get a top-set field. Only a
                // typed-in top set can move a TM (see buildConfirmedExercises).
                isTm: TM_COMPOUNDS.has(ex.name),
              })),
          }
        : null;

    sessions.push({
      id: w.id,
      date: w.date.toISOString().slice(0, 10),
      type: w.type as SessionType,
      cohort,
      discipline,
      plannedDurationMin: planned?.durationMin ?? null,
      plannedNotes: planned?.notes ?? null,
      garmin:
        cohort === "garmin_auto" && exec
          ? {
              activityId: w.garminActivityId,
              durationSec: (exec.durationSec as number | null) ?? null,
              distanceM: (exec.distanceM as number | null) ?? null,
              averageHr: (exec.averageHr as number | null) ?? null,
              averagePaceSecPerKm: (exec.averagePaceSecPerKm as number | null) ?? null,
            }
          : null,
      prescribed,
      existing: {
        rpe: w.rpe,
        shinPainNrs: (exec?.shinPainNrs as number | undefined) ?? null,
        durationActualMin: w.durationActualMin,
      },
    });
  }

  return NextResponse.json({ status: "ok", days, count: sessions.length, sessions });
}
