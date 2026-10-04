// POST /api/sessions/confirm
//
// Bulk retroactive confirmation. The athlete rates a week of sessions in one
// submit: RPE, shin NRS, and for strength an "as prescribed" claim that
// materialises the planned sets into ExerciseLog.
//
// WHY NOT /api/sessions/complete
//
// That route is built for the wizard and is destructive here: it replaces
// `executedSession` wholesale (the imported Garmin splits, HR zones and
// polarizedTID would be lost), nulls `garminActivityId`, requires a duration in
// its manual branch, sets status unconditionally, and writes trainingScore onto
// TODAY's sensor row rather than the workout's own day.
//
// WHERE EACH VALUE GOES
//   rpe   -> the Workout.rpe column. RunExecutedSessionSchema has no rpe key and
//           zod strips unknowns on every re-parse, so it would vanish silently.
//   shin  -> inside executedSession, merged into the raw JSON without a parse
//           round-trip, so nothing the importer stores gets dropped.
//
// SPRINT 3.2a — ACTUAL, NOT PLAN
//   duration -> Workout.durationActualMin ONLY when it was measured (a Garmin
//           activity the athlete picked) or typed in. Otherwise the column stays
//           null and the executedSession carries the plan as `durationEstimated`;
//           getRecentDailyLoads is the one place that turns that into a load.
//           Until now the plan was stored as measured (31.08.: 30 min for a
//           13-minute run).
//   garminActivityId -> an ad-hoc recording the athlete recognised as this
//           session. Imported exactly like the completion wizard does it.
//   topSets -> one rated set per training-max lift. The only /confirm input
//           that can move a TM; "as prescribed" now only records volume.
//           Also for garmin_auto strength, which used to get no sets at all.

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  buildAttestedRunSession,
  buildAttestedStrengthSession,
  buildConfirmedExercises,
  mergeShinIntoExecuted,
} from "@/lib/coach-engine/attest";
import { buildRunImport, buildStrengthImport, type ImportedRun } from "@/lib/garmin/run-import";
import {
  buildExerciseLogRows,
  replaceExerciseLogsForWorkout,
  resolveWeekInBlockSnapshot,
} from "@/lib/db/queries/exercise-log-write";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import type { SessionPlan } from "@/lib/coach-engine/types";

const ItemSchema = z
  .object({
    workoutId: z.string().min(1).max(64),
    action: z.enum(["attest", "skip"]),
    // min(1), not min(0): an rpe of 0 still passes the `rpe != null` filter in
    // getRecentDailyLoads and would inject a zero-load day into the EWMA.
    rpe: z.number().int().min(1).max(10).optional(),
    shinPainNrs: z.number().int().min(0).max(10).optional(),
    shinPainNote: z.string().max(500).optional(),
    asPrescribed: z.boolean().optional(),
    durationActualMin: z.number().int().min(1).max(600).optional(),
    notes: z.string().max(2000).optional(),
    // Sprint 3.2a
    garminActivityId: z.number().int().positive().optional(),
    topSets: z
      .array(
        z.object({
          exercise: z.string().min(1).max(80),
          weightKg: z.number().min(0.5).max(500),
          reps: z.number().int().min(1).max(50),
        }),
      )
      .max(10)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action !== "attest") return;
    // A half-attestation is worse than none: it feeds ACWR without feeding the
    // shin gate, which is the signal the safety rules actually read.
    if (v.rpe === undefined) {
      ctx.addIssue({ code: "custom", path: ["rpe"], message: "rpe is required when attesting" });
    }
    if (v.shinPainNrs === undefined) {
      ctx.addIssue({ code: "custom", path: ["shinPainNrs"], message: "shinPainNrs is required when attesting" });
    }
  });

const Schema = z.object({
  items: z.array(ItemSchema).min(1).max(20),
  regenerate: z.boolean().optional(),
});

type Outcome =
  | "attested"
  | "attested_no_load"
  | "skipped"
  | "not_eligible"
  | "not_skippable"
  | "not_found"
  | "activity_taken"
  | "error";

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

  const userId = await getCurrentUserId();
  const results: Array<{
    workoutId: string;
    outcome: Outcome;
    cohort?: "planned" | "garmin_auto";
    exerciseLogRows?: number;
    dailyLoadAu?: number | null;
    /** Sprint 3.2a: the load rests on the planned duration, not a measured one. */
    loadEstimated?: boolean;
    /** Sprint 3.2a: top sets refused (not a training-max lift of this session). */
    rejectedTopSets?: string[];
    error?: string;
  }> = [];

  let changed = 0;
  // Sprint 3.2a: a Garmin activity may back exactly one session — also within
  // one batch, where the same ad-hoc run is offered for Monday and Tuesday.
  const activitiesUsedInBatch = new Set<string>();

  for (const item of parsed.data.items) {
    try {
      const workout = await db.workout.findFirst({
        where: { id: item.workoutId, userId },
        select: {
          id: true, date: true, type: true, status: true, rpe: true,
          durationActualMin: true, notes: true,
          plannedSession: true, executedSession: true,
        },
      });
      if (!workout) {
        results.push({ workoutId: item.workoutId, outcome: "not_found" });
        continue;
      }

      const exec = workout.executedSession as Record<string, unknown> | null;
      const cohort =
        workout.status === "planned"
          ? ("planned" as const)
          : workout.status === "completed" && workout.rpe == null && exec?.source === "garmin_auto"
            ? ("garmin_auto" as const)
            : null;

      if (!cohort) {
        // A hand-logged session, or one already rated. Never overwrite it.
        results.push({ workoutId: item.workoutId, outcome: "not_eligible" });
        continue;
      }

      // -- skip -----------------------------------------------------------
      if (item.action === "skip") {
        if (cohort === "garmin_auto") {
          // A Garmin activity is proof the session happened; marking it skipped
          // would delete evidence.
          results.push({ workoutId: item.workoutId, outcome: "not_skippable", cohort });
          continue;
        }
        const note = `Ausgefallen (nachtraeglich bestaetigt)${item.notes ? ` - ${item.notes}` : ""}`;
        await db.workout.update({
          where: { id: workout.id },
          data: {
            status: "skipped",
            // Append, never overwrite: the existing note is the record of why
            // the session looked the way it did.
            notes: workout.notes ? `${workout.notes}\n${note}` : note,
            updatedAt: new Date(),
          },
        });
        changed++;
        results.push({ workoutId: item.workoutId, outcome: "skipped", cohort });
        continue;
      }

      // -- attest ---------------------------------------------------------
      const planned = (workout.plannedSession ?? null) as SessionPlan | null;
      const shin = item.shinPainNrs as number;
      const rpe = item.rpe as number;
      const isStrength = workout.type.startsWith("strength");

      // Sprint 3.2a — a Garmin activity the athlete recognised as this session.
      // Only for planned rows: a garmin_auto row already has its recording.
      let imported: ImportedRun | null = null;
      if (item.garminActivityId !== undefined) {
        if (cohort !== "planned") {
          results.push({ workoutId: item.workoutId, outcome: "not_eligible", cohort });
          continue;
        }
        const activityId = String(item.garminActivityId);
        const owner = activitiesUsedInBatch.has(activityId)
          ? { id: "batch" }
          : await db.workout.findFirst({
              where: { userId, garminActivityId: activityId, NOT: { id: workout.id } },
              select: { id: true },
            });
        if (owner) {
          results.push({ workoutId: item.workoutId, outcome: "activity_taken", cohort });
          continue;
        }
        // Throws on any Garmin failure → outcome "error". Deliberately no
        // fallback to the plan: the athlete asked for the recording.
        imported = isStrength
          ? await buildStrengthImport(item.garminActivityId, "garmin_import")
          : await buildRunImport(item.garminActivityId, "garmin_import");
        activitiesUsedInBatch.add(activityId);
      }

      // Measured or typed in — nothing else is an actual duration.
      const realDuration =
        imported?.durationActualMin ?? item.durationActualMin ?? workout.durationActualMin ?? null;
      // What the load estimate in getRecentDailyLoads will fall back to.
      const loadMinutes = realDuration ?? planned?.durationMin ?? null;

      // Strength: rated top sets + the optional as-prescribed rest (both cohorts).
      const confirmed = isStrength
        ? buildConfirmedExercises({
            plannedSession: planned,
            topSets: item.topSets ?? [],
            asPrescribed: item.asPrescribed === true,
            sessionRpe: rpe,
          })
        : { exercises: [], rejected: [] as string[] };

      let exerciseLogRows = 0;
      const data: Record<string, unknown> = { rpe, updatedAt: new Date() };
      if (item.notes !== undefined) data.notes = item.notes;

      if (cohort === "garmin_auto") {
        // Merge only. `status` and `garminActivityId` are deliberately absent
        // from the update payload so the imported session cannot be disturbed.
        const merged = mergeShinIntoExecuted(exec, shin, item.shinPainNote);
        if (merged && isStrength && confirmed.exercises.length > 0) {
          merged.exercises = confirmed.exercises;
        }
        if (merged) data.executedSession = merged;
        if (realDuration != null && workout.durationActualMin == null) {
          data.durationActualMin = realDuration;
        }
      } else if (imported) {
        const merged = mergeShinIntoExecuted(imported.executedSession, shin, item.shinPainNote);
        if (merged && isStrength) merged.exercises = confirmed.exercises;
        data.status = "completed";
        data.executedSession = merged;
        data.durationActualMin = imported.durationActualMin;
        data.garminActivityId = imported.activityId;
      } else if (isStrength) {
        data.status = "completed";
        if (realDuration != null) data.durationActualMin = realDuration;
        data.executedSession = buildAttestedStrengthSession({
          workoutDate: workout.date,
          durationActualMin: realDuration,
          plannedDurationMin: planned?.durationMin ?? null,
          exercises: confirmed.exercises,
          shinPainNrs: shin,
          shinPainNote: item.shinPainNote,
        });
      } else {
        data.status = "completed";
        if (realDuration != null) data.durationActualMin = realDuration;
        data.executedSession = buildAttestedRunSession({
          workoutDate: workout.date,
          durationActualMin: realDuration,
          plannedDurationMin: planned?.durationMin ?? null,
          shinPainNrs: shin,
          shinPainNote: item.shinPainNote,
        });
      }

      await db.workout.update({ where: { id: workout.id }, data });

      // ExerciseLog is rewritten, not appended, so a second confirmation — or a
      // correction that un-claims the session — leaves the right rows behind.
      // Sprint 3.2a: for garmin_auto strength too — it used to get no rows.
      if (isStrength) {
        const { weekInBlock, isDeload } = await resolveWeekInBlockSnapshot(userId, workout.date);
        const rows = buildExerciseLogRows({
          userId,
          workoutId: workout.id,
          slot: workout.type,
          date: workout.date,
          weekInBlock,
          isDeload,
          exercises: confirmed.exercises,
        });
        await replaceExerciseLogsForWorkout(userId, workout.id, rows);
        exerciseLogRows = rows.length;
      }

      changed++;
      results.push({
        workoutId: item.workoutId,
        outcome: loadMinutes == null ? "attested_no_load" : "attested",
        cohort,
        exerciseLogRows,
        dailyLoadAu: loadMinutes != null ? rpe * loadMinutes : null,
        loadEstimated: realDuration == null && loadMinutes != null,
        ...(confirmed.rejected.length > 0 ? { rejectedTopSets: confirmed.rejected } : {}),
      });
    } catch (e) {
      results.push({
        workoutId: item.workoutId,
        outcome: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // One regeneration for the whole batch (precedent: coach/tm-confirm).
  // A bulk confirmation can move the volume gate in BOTH directions — clearing
  // the "completed but none rated" hold, or dropping to regress on a single
  // shin >= 4 — so the caller gets the gate and its reason back verbatim to
  // show the athlete. Silently rewriting next week would not be acceptable.
  let regenerate: Record<string, unknown> | null = null;
  if (parsed.data.regenerate !== false && changed > 0) {
    try {
      const r = await regeneratePlansFromNow(userId);
      regenerate = {
        regenerated: r.regenerated,
        gate: r.gate,
        gateReason: r.gateReason,
        // Surfaced because a bulk confirmation can retroactively close a gap the
        // layoff detector had found, removing a comeback ramp that was braking
        // the plan — and that happens inside this very request.
        layoffActive: r.layoff.active,
      };
    } catch (e) {
      regenerate = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({
    status: "ok",
    attested: results.filter((r) => r.outcome === "attested" || r.outcome === "attested_no_load").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) =>
      ["not_found", "not_eligible", "not_skippable", "activity_taken", "error"].includes(r.outcome),
    ).length,
    results,
    regenerate,
  });
}
