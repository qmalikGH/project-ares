// POST /api/sessions/free-run — Sprint 3.3b (#25 · 9)
//
// A run on a day with nothing planned. In the four-day week that is a real
// case (a Friday run), and /confirm had no way to record it: it only knows
// sessions the plan created. Without it the run counts for nothing — not for
// the single-session cap, not for the layoff detector, not for compliance.
//
// Stored like any confirmed run: an `easy_run`, `completed`, with RPE on the
// column and the shin score in the executedSession. Two sources:
//   - typed minutes  → source "attested" (no watch data)
//   - a Garmin activity the athlete picked from `freeRuns` → "garmin_import",
//     minutes and everything else from the recording
//
// One easy run per day (Workout @@unique([userId, date, type])). If the day
// already has a planned easy run, that one is the session to confirm.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import { buildAttestedRunSession, mergeShinIntoExecuted } from "@/lib/coach-engine/attest";
import { buildRunImport } from "@/lib/garmin/run-import";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import { CONFIRM_WINDOW_DAYS } from "@/lib/garmin/confirm-candidates";

const Schema = z
  .object({
    /** Local calendar day, YYYY-MM-DD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    durationActualMin: z.number().int().min(1).max(600).optional(),
    rpe: z.number().int().min(1).max(10),
    shinPainNrs: z.number().int().min(0).max(10),
    shinPainNote: z.string().max(500).optional(),
    garminActivityId: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    // Real minutes or a real recording — nothing else counts for the cap.
    if (v.durationActualMin === undefined && v.garminActivityId === undefined) {
      ctx.addIssue({ code: "custom", path: ["durationActualMin"], message: "minutes or a Garmin activity required" });
    }
  });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const userId = await getCurrentUserId();

  const today0 = await userTodayDynamic();
  const date = new Date(`${input.date}T00:00:00.000Z`);
  if (date > today0 || date < new Date(today0.getTime() - CONFIRM_WINDOW_DAYS * 86400000)) {
    return NextResponse.json({ error: "date_out_of_window" }, { status: 400 });
  }

  const existing = await db.workout.findFirst({
    where: { userId, date, type: "easy_run" },
    select: { id: true, status: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: existing.status === "planned" ? "planned_session_exists" : "run_already_recorded",
        workoutId: existing.id,
      },
      { status: 409 },
    );
  }

  let executedSession: Record<string, unknown> | null;
  let durationActualMin: number;
  let garminActivityId: string | null = null;
  if (input.garminActivityId !== undefined) {
    const activityId = String(input.garminActivityId);
    const taken = await db.workout.findFirst({ where: { userId, garminActivityId: activityId }, select: { id: true } });
    if (taken) return NextResponse.json({ error: "activity_taken" }, { status: 409 });
    try {
      const imported = await buildRunImport(input.garminActivityId, "garmin_import");
      executedSession = mergeShinIntoExecuted(imported.executedSession, input.shinPainNrs, input.shinPainNote);
      durationActualMin = imported.durationActualMin;
      garminActivityId = imported.activityId;
    } catch (e) {
      return NextResponse.json(
        { error: "garmin_import_failed", details: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  } else {
    durationActualMin = input.durationActualMin as number;
    executedSession = buildAttestedRunSession({
      workoutDate: date,
      durationActualMin,
      shinPainNrs: input.shinPainNrs,
      shinPainNote: input.shinPainNote,
    });
  }

  const workout = await db.workout.create({
    data: {
      userId,
      date,
      type: "easy_run",
      status: "completed",
      // Not from the plan: the "planned" side mirrors what was run, flagged.
      plannedSession: {
        date: date.toISOString(),
        type: "easy_run",
        durationMin: durationActualMin,
        unplanned: true,
        notes: "Freier Lauf (nicht geplant)",
      },
      executedSession: executedSession as object,
      durationActualMin,
      rpe: input.rpe,
      garminActivityId,
    },
    select: { id: true },
  });

  // Like /confirm: a new run can lift the cap, close a layoff gap and move
  // the gate — the athlete sees the effect at once.
  let regenerate: Record<string, unknown> | null = null;
  try {
    const r = await regeneratePlansFromNow(userId);
    regenerate = { regenerated: r.regenerated, gate: r.gate, gateReason: r.gateReason, layoffActive: r.layoff.active };
  } catch (e) {
    regenerate = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ status: "ok", workoutId: workout.id, durationActualMin, regenerate });
}
