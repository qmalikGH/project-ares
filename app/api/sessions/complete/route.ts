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
import { userToday } from "@/lib/date";
import { getActivityDetail, getActivityHrZones } from "@/lib/garmin/activities";
import { mapGarminZonesToPolarizedTID } from "@/lib/coach-engine/hr-zones";
import {
  RunExecutedSessionSchema,
  StrengthExecutedSessionSchema,
  type SessionPlan,
  type W1CalibrationRunData,
} from "@/lib/coach-engine/types";
import { calibrateVDOTFromW1 } from "@/lib/coach-engine/run-coach";
import {
  getEffectiveVdot,
  getOrCreateUserSettings,
} from "@/lib/db/queries/settings";
import { regenerateFutureSessionPaces } from "@/lib/db/queries/regenerate";
import { createNotification } from "@/lib/notifications/create";
import { getRecentRunSummaries } from "@/lib/garmin/profile";
import { calibrateVdotFromRuns } from "@/lib/coach-engine/vdot-calculator";

const Schema = z.object({
  rpe: z.number().int().min(0).max(10),
  durationActualMin: z.number().int().min(1).max(600).optional(),
  notes: z.string().max(2000).optional(),
  trainingScore: z.number().int().min(1).max(10).optional(),

  garminActivityId: z.number().int().nullable().optional(),
  strengthExecution: StrengthExecutedSessionSchema.optional(),
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
  const today = userToday();
  const { rpe, notes, trainingScore } = parsed.data;
  let durationActualMin = parsed.data.durationActualMin ?? null;
  let garminActivityIdStr: string | null = null;

  const workout = await db.workout.findFirst({
    where: { userId, date: today },
    orderBy: { createdAt: "desc" },
  });
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
        const last7 = recentRuns.slice(-7);
        if (last7.length >= 3) {
          const recal = calibrateVdotFromRuns(
            last7,
            settings.hrMax,
            settings.hrRest,
          );
          const currentVdot = await getEffectiveVdot(userId);
          if (
            !recal.insufficient_data &&
            Math.abs(recal.finalVdot - currentVdot) >= 1
          ) {
            const prefs = settings.notificationPrefs as
              | { vdotCalibrated?: boolean }
              | null;
            if (prefs?.vdotCalibrated !== false) {
              const methodSummary = recal.estimates
                .map((e) => `${e.method}=${e.vdot}`)
                .join(", ");
              await createNotification({
                userId,
                type: "VDOT_CALIBRATED",
                title: `VDOT-Update vorgeschlagen: ${currentVdot} → ${recal.finalVdot}`,
                message: `Aus den letzten ${last7.length} Runs (rolling window): ${methodSummary}. Konfidenz: ${recal.confidence}, Range ${recal.range.min}-${recal.range.max}. Übernimm in Settings.`,
                severity: "INFO",
                actionUrl: `/settings?vdotPrefill=${recal.finalVdot}`,
              });
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
