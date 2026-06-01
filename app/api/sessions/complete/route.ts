// POST /api/sessions/complete
// Log post-session feedback. Body now supports two execution payloads:
//   - garminActivityId  → run with Garmin auto-import (fetches detail server-side)
//   - strengthExecution → strength with set-by-set logger payload
//   - neither           → manual completion (just RPE + duration)
//
// `executedSession` JSON conforms to ExecutedSessionSchema (run|strength
// discriminated union) when import succeeds; falls back to a minimal manual
// shape when no execution data is provided.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { userTodayDynamic } from "@/lib/date";
import { getActivityDetail, getActivityHrZones } from "@/lib/garmin/activities";
import { mapGarminZonesToPolarizedTID } from "@/lib/coach-engine/hr-zones";
import {
  RunExecutedSessionSchema,
  StrengthExecutedSessionSchema,
  type SessionPlan,
  type W1CalibrationRunData,
} from "@/lib/coach-engine/types";
import { calibrateVDOTFromW1 } from "@/lib/coach-engine/run-coach";
import { estimateOneRM } from "@/lib/coach-engine/strength-coach/one-rm";
import { weekInBlockOf } from "@/lib/coach-engine/strength-coach/periodization";
import type { PhaseConfig } from "@/lib/coach-engine/types";
import {
  getEffectiveVdot,
  getOrCreateUserSettings,
} from "@/lib/db/queries/settings";
import { regenerateFutureSessionPaces } from "@/lib/db/queries/regenerate";
import { createNotification, createNotificationIfNew } from "@/lib/notifications/create";
import { getRecentRunSummaries } from "@/lib/garmin/profile";
import { calibrateVdotFromRuns } from "@/lib/coach-engine/vdot-calculator";

const Schema = z.object({
  rpe: z.number().int().min(0).max(10),
  durationActualMin: z.number().int().min(1).max(600).optional(),
  notes: z.string().max(2000).optional(),
  trainingScore: z.number().int().min(1).max(10).optional(),
  // Sprint v1.9: post-session SHIN pain (NRS 0-10) — captured for runs AND
  // strength; feeds the HSR progression override (active injury = shin splints).
  shinPainNrs: z.number().int().min(0).max(10).optional(),
  shinPainNote: z.string().max(500).optional(),

  garminActivityId: z.number().int().nullable().optional(),
  strengthExecution: StrengthExecutedSessionSchema.optional(),

  // Sprint v0.11+: which Workout to complete. Required on two-a-days so
  // the Run row and the Strength row stay independent. Without it (legacy
  // clients) we fall back to "most recent in_progress for today" → "any for
  // today" so single-session days keep working.
  workoutId: z.string().min(1).max(64).optional(),
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
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  const today = await userTodayDynamic();
  const { rpe, notes, trainingScore, workoutId, shinPainNrs, shinPainNote } = parsed.data;
  let durationActualMin = parsed.data.durationActualMin ?? null;
  let garminActivityIdStr: string | null = null;

  // Resolution order: explicit workoutId → in_progress today → any today.
  // If nothing matches today exactly, widen to a ±1 day window to absorb
  // timezone drift (e.g. plan stored as Mon UTC midnight while user's
  // current "today" is Sun UTC midnight in their travel TZ). The window
  // hit gets updated in place — never create a duplicate sibling.
  const yesterday = new Date(today.getTime() - 86400000);
  const dayAfter = new Date(today.getTime() + 2 * 86400000);
  const workout = workoutId
    ? await db.workout.findFirst({ where: { id: workoutId, userId } })
    : (await db.workout.findFirst({
        where: { userId, date: today, status: "in_progress" },
        orderBy: { createdAt: "desc" },
      })) ??
      (await db.workout.findFirst({
        where: { userId, date: today },
        orderBy: { createdAt: "desc" },
      })) ??
      (await db.workout.findFirst({
        where: {
          userId,
          date: { gte: yesterday, lt: dayAfter },
          status: { in: ["in_progress", "planned"] },
        },
        orderBy: { createdAt: "desc" },
      }));
  if (!workout) {
    return NextResponse.json({ status: "NO_WORKOUT_FOUND" }, { status: 404 });
  }

  // Build executedSession payload by branch
  let executedSession: unknown;

  if (parsed.data.garminActivityId) {
    try {
      const detail = await getActivityDetail(parsed.data.garminActivityId);
      // Sprint v0.7: pull HR-time-in-zones for this activity so /progress
      // can build TID directly from Garmin's data instead of approximating
      // from splits. Best-effort — null on any failure.
      const garminHrZones = await getActivityHrZones(parsed.data.garminActivityId);
      const polarizedTID = garminHrZones
        ? mapGarminZonesToPolarizedTID(garminHrZones)
        : null;

      const runExec = RunExecutedSessionSchema.parse({
        type: "run",
        source: "garmin_import",
        garminActivityId: parsed.data.garminActivityId,
        startTimeLocal: detail.startTimeLocal,
        durationSec: detail.durationSec,
        distanceM: detail.distanceM,
        averagePaceSecPerKm: detail.averagePaceSecPerKm,
        averageHr: detail.averageHr,
        maxHr: detail.maxHr,
        elevationGainM: detail.elevationGainM,
        calories: detail.calories,
        splits: detail.splits.map((s) => ({
          splitNumber: s.splitNumber,
          distanceM: s.distanceM,
          durationSec: s.durationSec,
          paceSecPerKm: s.paceSecPerKm,
          averageHr: s.averageHr,
          maxHr: s.maxHr,
        })),
        garminHrZones,
        polarizedTID,
      });
      executedSession = runExec;
      durationActualMin = Math.max(1, Math.round(detail.durationSec / 60));
      garminActivityIdStr = String(parsed.data.garminActivityId);
    } catch (e) {
      console.error("[complete] garmin import failed:", e);
      // Fall through to manual completion below.
      executedSession = {
        type: "run",
        source: "manual",
        garminActivityId: null,
        startTimeLocal: new Date().toISOString(),
        durationSec: (durationActualMin ?? 0) * 60,
        distanceM: null,
        averagePaceSecPerKm: null,
        averageHr: null,
        maxHr: null,
        elevationGainM: null,
        calories: null,
        splits: [],
      };
    }
  } else if (parsed.data.strengthExecution) {
    executedSession = parsed.data.strengthExecution;
    durationActualMin = parsed.data.strengthExecution.durationActualMin;
  } else {
    // Plain manual completion — minimal payload.
    if (durationActualMin == null) {
      return NextResponse.json(
        { error: "durationActualMin required when no garminActivityId or strengthExecution" },
        { status: 400 },
      );
    }
    executedSession = {
      rpe,
      durationActualMin,
      notes: notes ?? null,
      completedAt: new Date().toISOString(),
    };
  }

  // Sprint v1.9 #3: attach post-session shin pain to whatever executedSession
  // shape we built (run / strength / manual) so it feeds the HSR override.
  if (shinPainNrs !== undefined && executedSession && typeof executedSession === "object") {
    (executedSession as Record<string, unknown>).shinPainNrs = shinPainNrs;
    if (shinPainNote !== undefined) {
      (executedSession as Record<string, unknown>).shinPainNote = shinPainNote;
    }
  }

  const updated = await db.workout.update({
    where: { id: workout.id },
    data: {
      status: "completed",
      rpe,
      durationActualMin,
      notes: notes ?? null,
      executedSession: executedSession as object,
      garminActivityId: garminActivityIdStr,
      updatedAt: new Date(),
    },
  });

  // Sprint v0.11: ExerciseLog write-through for strength sessions. Each set
  // with weight + reps becomes one log row with its Epley-estimated 1RM. The
  // rolling-median + block-transition modules then read this table during
  // W4 deload to propose 1RM updates. Best-effort — never fails the request.
  //
  // 1RM GUARD (Sprint v0.12): this route writes ONLY to db.exerciseLog. It
  // must NEVER touch db.userSettings.exerciseMaxEstimates — that field is
  // user-facing and only changes on:
  //   (a) explicit POST to /api/settings/exercise-max (manual entry), OR
  //   (b) confirmed acceptance of a block-transition proposal generated by
  //       proposeOneRMUpdates() during W4 deload review.
  // Auto-updating it after every set would make the displayed weight jitter
  // wildly with each session and undermine the user's mental anchor.
  if (parsed.data.strengthExecution) {
    try {
      const sessionStartLocal = parsed.data.strengthExecution.startTimeLocal;
      const sessionDate = sessionStartLocal
        ? new Date(sessionStartLocal)
        : new Date();

      // Sprint 2.1 #0: resolve the periodization snapshot (slot/weekInBlock/
      // isDeload) at WRITE time so it stays stable against later resetBlock
      // week-renumbering. slot = the Workout's session type (strength_a/b/c).
      // weekInBlock comes from the WeeklyPlan covering the workout date, using
      // config.durationWeeks (the SAME source the plan generator uses) — NOT
      // the Phase.durationWeeks column (which resetBlock extends).
      const slot = workout.type;
      let weekInBlock: number | null = null;
      let isDeload = false;
      try {
        const coveringPlan = await db.weeklyPlan.findFirst({
          where: {
            phase: { macrocycle: { userId, status: "active" } },
            startDate: { lte: workout.date },
            endDate: { gt: workout.date },
          },
          include: { phase: true },
        });
        if (coveringPlan) {
          const cfg = coveringPlan.phase.config as unknown as PhaseConfig;
          const dur = cfg?.durationWeeks ?? 4;
          weekInBlock = weekInBlockOf(coveringPlan.weekNumber, dur);
          isDeload = weekInBlock === 4;
        }
      } catch (e) {
        console.error("[complete] weekInBlock snapshot resolution failed:", e);
      }

      const rows: Array<{
        userId: string;
        exerciseName: string;
        weightKg: number;
        repsCompleted: number;
        rpe: number | null;
        estimatedOneRM: number;
        date: Date;
        workoutId: string;
        slot: string;
        isDeload: boolean;
        weekInBlock: number | null;
      }> = [];
      for (const ex of parsed.data.strengthExecution.exercises) {
        if (ex.skipped) continue;
        for (const set of ex.actualSets) {
          // Skip isometrics (Wall Sit) and any set without a real load+rep pair.
          if (!set.loadKg || set.loadKg <= 0) continue;
          if (!set.reps || set.reps <= 0) continue;
          const est = estimateOneRM(set.loadKg, set.reps, set.rpe ?? undefined);
          if (est <= 0) continue;
          rows.push({
            userId,
            exerciseName: ex.name,
            weightKg: set.loadKg,
            repsCompleted: set.reps,
            rpe: set.rpe ?? null,
            estimatedOneRM: est,
            date: sessionDate,
            workoutId: workout.id,
            slot,
            isDeload,
            weekInBlock,
          });
        }
      }
      if (rows.length > 0) {
        await db.exerciseLog.createMany({ data: rows });
      }
    } catch (e) {
      console.error("[complete] exerciseLog write failed:", e);
    }
  }

  // Persist post-session knee score to today's sensor row.
  if (trainingScore !== undefined) {
    const sensor = await db.dailySensorData.findFirst({ where: { userId, date: today } });
    if (sensor) {
      const existing = (sensor.userMorning as Record<string, unknown> | null) ?? {};
      await db.dailySensorData.update({
        where: { id: sensor.id },
        data: {
          userMorning: { ...existing, postSessionScore: trainingScore },
          updatedAt: new Date(),
        },
      });
    }
  }

  // Sprint v0.7: W1-Calibration auto-trigger.
  // When the just-completed workout was a `calibration_run` and we have a
  // valid Garmin-imported run payload, run calibrateVDOTFromW1. If it returns
  // a non-zero VDOT delta, persist as override + regenerate future paces +
  // notify. We do NOT auto-apply when source=manual: too noisy without
  // distance + duration + HR triangulation.
  let w1Calibration: {
    applied: boolean;
    previousVdot: number;
    calibratedVdot: number;
    notification: string;
    updatedSessions: number;
  } | null = null;
  try {
    const planned = (workout.plannedSession as unknown as SessionPlan | null) ?? null;
    if (
      planned?.type === "calibration_run" &&
      executedSession &&
      typeof executedSession === "object" &&
      (executedSession as { type?: string }).type === "run" &&
      (executedSession as { source?: string }).source === "garmin_import"
    ) {
      const exec = executedSession as {
        durationSec: number;
        distanceM: number | null;
        averageHr: number | null;
        maxHr: number | null;
      };
      const distanceKm = (exec.distanceM ?? 0) / 1000;
      if (distanceKm > 0 && exec.durationSec > 0) {
        const w1Data: W1CalibrationRunData = {
          distanceKm,
          durationMin: exec.durationSec / 60,
          avgHr: exec.averageHr ?? 0,
          maxHr: exec.maxHr ?? 0,
          rpe,
        };
        const previousVdot = await getEffectiveVdot(userId);
        const calibration = calibrateVDOTFromW1(previousVdot, w1Data);
        if (calibration.pacesUpdated) {
          await db.userSettings.upsert({
            where: { userId },
            update: {
              vdotOverride: calibration.calibratedVdot,
              vdotOverrideAt: new Date(),
              vdotOverrideRationale: calibration.notification,
            },
            create: {
              userId,
              vdotOverride: calibration.calibratedVdot,
              vdotOverrideAt: new Date(),
              vdotOverrideRationale: calibration.notification,
            },
          });
          const { updatedSessions } = await regenerateFutureSessionPaces(
            userId,
            calibration.calibratedVdot,
          );
          // Respect user notification prefs.
          const settings = await db.userSettings.findUnique({ where: { userId } });
          const prefs = settings?.notificationPrefs as
            | { vdotCalibrated?: boolean }
            | null;
          if (prefs?.vdotCalibrated !== false) {
            await createNotification({
              userId,
              type: "VDOT_CALIBRATED",
              title: "VDOT auto-kalibriert (W1 Calibration Run)",
              message: calibration.notification,
              severity: "INFO",
              actionUrl: "/settings",
            });
          }
          w1Calibration = {
            applied: true,
            previousVdot,
            calibratedVdot: calibration.calibratedVdot,
            notification: calibration.notification,
            updatedSessions,
          };
        }
      }
    }
  } catch (e) {
    // W1 calibration is best-effort — never fail the session-complete request.
    console.error("[complete] W1 calibration failed:", e);
  }

  // Sprint v0.7 (Garmin-driven): rolling auto-recalibration.
  // After ANY Garmin-imported run, re-run the multi-method calibrator on the
  // last ~7 runs and SUGGEST a VDOT update if it diverges by ≥1 from current.
  // Suggestion only — never auto-applied. Q decides via a notification action.
  // Skipped when W1 already updated VDOT (avoids double-notification).
  let recalibration: {
    suggested: boolean;
    currentVdot: number;
    suggestedVdot: number;
    confidence: "low" | "medium" | "high";
  } | null = null;
  if (
    !w1Calibration?.applied &&
    parsed.data.garminActivityId &&
    executedSession &&
    typeof executedSession === "object" &&
    (executedSession as { type?: string }).type === "run"
  ) {
    try {
      const settings = await getOrCreateUserSettings(userId);
      if (settings.hrMax && settings.hrRest) {
        const recentRuns = await getRecentRunSummaries(60);
        const lastN = recentRuns.slice(-14);
        if (lastN.length >= 5) {
          const recal = calibrateVdotFromRuns(
            lastN,
            settings.hrMax,
            settings.hrRest,
          );
          const currentVdot = await getEffectiveVdot(userId);
          if (
            !recal.insufficient_data &&
            Math.abs(recal.finalVdot - currentVdot) >= 2
          ) {
            const prefs = settings.notificationPrefs as
              | { vdotCalibrated?: boolean }
              | null;
            if (prefs?.vdotCalibrated !== false) {
              const methodSummary = recal.estimates
                .map((e) => `${e.method}=${e.vdot}`)
                .join(", ");
              await createNotificationIfNew(
                {
                  userId,
                  type: "VDOT_CALIBRATED",
                  title: `VDOT-Update vorgeschlagen: ${currentVdot} → ${recal.finalVdot}`,
                  message: `Aus den letzten ${lastN.length} Runs (rolling window): ${methodSummary}. Konfidenz: ${recal.confidence}, Range ${recal.range.min}-${recal.range.max}. Übernimm in Settings.`,
                  severity: "INFO",
                  actionUrl: `/settings?vdotPrefill=${recal.finalVdot}`,
                },
                10080,
              );
            }
            recalibration = {
              suggested: true,
              currentVdot,
              suggestedVdot: recal.finalVdot,
              confidence: recal.confidence,
            };
          }
        }
      }
    } catch (e) {
      console.error("[complete] rolling recalibration failed:", e);
    }
  }

  return NextResponse.json({
    status: "ok",
    workoutId: updated.id,
    dailyLoadAu: rpe * (durationActualMin ?? 0),
    hasGarminImport: !!parsed.data.garminActivityId,
    hasStrengthLog: !!parsed.data.strengthExecution,
    w1Calibration,
    recalibration,
  });
}
