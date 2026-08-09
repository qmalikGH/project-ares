// POST /api/onboarding/complete
// Atomic: creates Goal + Macrocycle + 5 Phases + 20 WeeklyPlans (one per week).
//
// v0.1 deterministic onboarding — no AI conversation, simple form input.
// AI goal-extraction is deferred to a future phase.
//
// Re-Onboarding rule (Sprint v0.6 P3.1): NEVER hard-delete user history.
//   - Old Goal + Macrocycle → status = "abandoned" (kept for analytics)
//   - Workouts, DailySensorData, AIConversation, Notification, BlockReview → untouched
//   - UserSettings (incl. vdotOverride, hrMax/hrRest, garmin creds) → untouched
//   The new macrocycle inherits the user's effective VDOT via the form's
//   vdotInitial, which the client prefills from /api/settings.
import { z } from "zod";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { generateMacrocycle } from "@/lib/coach-engine/periodization";
import { generateWeekRunPlan } from "@/lib/coach-engine/run-coach";
import { generateWeekStrengthPlan } from "@/lib/coach-engine/strength-coach";
import { computeInitialVdotFromGoal } from "@/lib/coach-engine/vdot-table";
import {
  calibrateVdotFromRuns,
  type VdotCalibrationResult,
} from "@/lib/coach-engine/vdot-calculator";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { removeWorkoutFromGarmin } from "@/lib/garmin/workout-sync";
import {
  getGarminProfileMetrics,
  getRecentRunSummaries,
  type GarminProfileMetrics,
  type RunSummary,
} from "@/lib/garmin/profile";
import type { GoalInput, SessionPlan, TherapyPhase } from "@/lib/coach-engine/types";
import { dayKey } from "@/lib/db/queries/sensors";
import { createNotification } from "@/lib/notifications/create";

const Schema = z.object({
  primaryType: z.enum(["5k_time", "10k_time", "21k_time"]),
  currentTime: z.string().regex(/^\d{1,2}:\d{2}$/), // "24:30"
  targetTime: z.string().regex(/^\d{1,2}:\d{2}$/), // "22:00"
  targetDate: z.string(), // ISO date
  modality: z.enum(["hybrid", "run_only", "strength_only"]).default("hybrid"),
  vdotInitial: z.number().min(25).max(65),
  startDate: z.string().optional(), // ISO date; defaults to today
  constraints: z
    .array(
      z.object({
        type: z.string(),
        severity: z.enum(["active", "monitoring", "resolved"]),
      }),
    )
    .default([]),
  preferences: z
    .object({
      strengthPerWeek: z.number().int().min(0).max(5).optional(),
      maxTrainingDays: z.number().int().min(3).max(7).optional(),
    })
    .default({}),
});

/** Get the Monday of the ISO week containing `date`. Returns UTC midnight. */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

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

  const startDate = mondayOf(input.startDate ? new Date(input.startDate) : new Date());
  const targetDate = new Date(input.targetDate);

  // Sprint v0.7 (Garmin-driven): try multi-method VDOT calibration from the
  // last 90 days of Garmin run history. If Garmin is unavailable, or the
  // runner has too few runs, fall back to Daniels-from-Goal.currentValue.
  //
  // Both Garmin pulls are best-effort and wrapped — onboarding never crashes
  // on a Garmin outage; we just lose calibration and use the goal-derived
  // baseline. UserSettings tracks the source so /settings can show provenance.
  const initialVdotFromGoal = computeInitialVdotFromGoal(
    input.primaryType,
    input.currentTime,
  );
  let garminProfile: GarminProfileMetrics | null = null;
  let garminRuns: RunSummary[] = [];
  let garminCalibration: VdotCalibrationResult | null = null;
  try {
    garminProfile = await getGarminProfileMetrics();
  } catch (e) {
    console.error("[onboarding] garmin profile fetch failed:", e);
  }
  try {
    garminRuns = await getRecentRunSummaries(90);
  } catch (e) {
    console.error("[onboarding] garmin runs fetch failed:", e);
  }
  if (
    garminProfile?.hrMax &&
    garminProfile?.hrRest &&
    garminRuns.length >= 2
  ) {
    garminCalibration = calibrateVdotFromRuns(
      garminRuns,
      garminProfile.hrMax,
      garminProfile.hrRest,
    );
  }

  const useGarminCalibration =
    garminCalibration !== null && !garminCalibration.insufficient_data;
  const initialVdot = useGarminCalibration
    ? garminCalibration!.finalVdot
    : Math.round(initialVdotFromGoal);
  const vdotRationale = useGarminCalibration
    ? `Garmin-calibrated VDOT ${initialVdot} (${garminCalibration!.confidence} confidence, range ${garminCalibration!.range.min}-${garminCalibration!.range.max}). Methods: ${garminCalibration!.estimates.map((e) => `${e.method}=${e.vdot}`).join(", ")}. n=${garminRuns.length} runs.`
    : `Daniels-derived VDOT ${initialVdot} from Goal.currentValue (${input.currentTime} ${input.primaryType}). Garmin run history insufficient for multi-method calibration.`;

  const goalInput: GoalInput = {
    primaryType: input.primaryType,
    currentValue: { time: input.currentTime, date: dayKey(new Date()) },
    targetValue: { time: input.targetTime, date: targetDate },
    modality: input.modality,
    constraints: input.constraints,
    preferences: input.preferences,
    startDate,
    vdotInitial: initialVdot,
  };

  const macrocyclePlan = generateMacrocycle(goalInput);

  // Map active patellar tendinopathy → initial therapy phase. The Limitations
  // module re-evaluates this daily; for plan generation we only need a starting
  // assumption so Wall Sit gets prepended to strength sessions when relevant.
  const patellar = input.constraints.find((c) => c.type === "patellar_tendinopathy");
  const initialTherapyPhase: TherapyPhase | null = patellar
    ? patellar.severity === "active"
      ? "REACTIVE"
      : patellar.severity === "monitoring"
      ? "DISREPAIR"
      : "REMODELING"
    : null;

  // Sprint v0.10: collect future Workout-IDs that were pushed to Garmin under
  // the old (about-to-be-abandoned) macrocycle. We clean these from Garmin
  // OUTSIDE the transaction (Garmin calls are network I/O — slow + can fail,
  // we don't want the DB transaction to depend on them).
  const orphanGarminWorkoutIds: string[] = [];
  try {
    const userSettingsCheck = await db.userSettings.findUnique({
      where: { userId },
    });
    if (userSettingsCheck?.garminWorkoutPushEnabled) {
      const orphans = await db.workout.findMany({
        where: {
          userId,
          date: { gte: new Date() },
          garminWorkoutId: { not: null },
        },
        select: { id: true },
      });
      for (const o of orphans) orphanGarminWorkoutIds.push(o.id);
    }
  } catch (e) {
    console.error("[onboarding] orphan Garmin scan failed (non-fatal):", e);
  }

  // Persist atomically. Prisma's interactive transaction guarantees rollback if any step fails.
  const result = await db.$transaction(async (tx) => {
    // Mark any previous active goals/macrocycles as abandoned
    await tx.goal.updateMany({
      where: { userId, status: "active" },
      data: { status: "abandoned" },
    });
    await tx.macrocycle.updateMany({
      where: { userId, status: "active" },
      data: { status: "abandoned" },
    });

    // Sprint v0.7: seed UserSettings.vdotOverride from Garmin multi-method
    // calibration when available, else Daniels-from-Goal. Persist Garmin's
    // HRmax/HRrest too so HR-First targets work out of the box.
    // Re-onboarding overwrites these; manual override later still wins.
    const settingsUpdate: Record<string, unknown> = {
      vdotOverride: initialVdot,
      vdotOverrideAt: new Date(),
      vdotOverrideRationale: vdotRationale,
      vdotSource: "onboarding",
      // Sprint v0.12: persist derived therapy phase as the override so it
      // becomes the single source of truth for plan generation. null when
      // there's no patellar-tendinopathy constraint — engine then falls
      // back to the daily DailySensorData.therapyPhase value.
      therapyPhaseOverride: initialTherapyPhase,
    };
    if (garminProfile?.hrMax && garminProfile?.hrRest) {
      settingsUpdate.hrMax = garminProfile.hrMax;
      settingsUpdate.hrRest = garminProfile.hrRest;
      settingsUpdate.hrZonesUpdatedAt = new Date();
      settingsUpdate.hrZonesSource = "garmin";
    }
    await tx.userSettings.upsert({
      where: { userId },
      update: settingsUpdate,
      create: { userId, ...settingsUpdate },
    });

    // Sprint v0.10: read schedule constraints (forcedRestDays, preferredLongRunDay)
    // for the upcoming planWeekSchedule pass. Defaults baked into UserSettings
    // already (Wed+Sun rest, Sat long run); user can override via Settings UI.
    const scheduleSettings = await tx.userSettings.findUnique({
      where: { userId },
      select: {
        forcedRestDays: true,
        preferredLongRunDay: true,
        exerciseMaxEstimates: true,
      },
    });
    const userMaxEstimates =
      (scheduleSettings?.exerciseMaxEstimates as Record<string, number> | null) ??
      null;

    const goal = await tx.goal.create({
      data: {
        userId,
        primaryType: input.primaryType,
        currentValue: { time: input.currentTime, date: dayKey(new Date()).toISOString() },
        targetValue: { time: input.targetTime, date: targetDate.toISOString() },
        modality: input.modality,
        constraints: input.constraints,
        preferences: input.preferences,
        startDate,
        targetDate,
        status: "active",
      },
    });

    const macrocycle = await tx.macrocycle.create({
      data: {
        userId,
        goalId: goal.id,
        startDate: macrocyclePlan.startDate,
        endDate: macrocyclePlan.endDate,
        totalWeeks: macrocyclePlan.totalWeeks,
        status: "active",
      },
    });

    // Phases + weekly plans
    for (const phase of macrocyclePlan.phases) {
      const phaseRow = await tx.phase.create({
        data: {
          macrocycleId: macrocycle.id,
          blockNumber: phase.blockNumber,
          name: phase.phaseName,
          startDate: phase.startDate,
          plannedEndDate: phase.plannedEndDate,
          durationWeeks: phase.config.durationWeeks,
          config: phase.config as unknown as object,
          status: "active",
        },
      });

      // Generate weekly plans for this phase
      for (let w = 0; w < phase.config.durationWeeks; w++) {
        const weekStart = new Date(phase.startDate.getTime() + w * 7 * 86400000);
        const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
        const weekNumberInMacro = phase.startWeek + w;

        const runPlan = generateWeekRunPlan(
          phase.config,
          weekNumberInMacro,
          initialVdot,
          weekStart,
          {
            hrMax: garminProfile?.hrMax ?? undefined,
            hrRest: garminProfile?.hrRest ?? undefined,
          },
        );
        const strengthPlan = generateWeekStrengthPlan(
          phase.config,
          weekNumberInMacro,
          weekStart,
          null,
          initialTherapyPhase,
          userMaxEstimates,
        );

        // Sprint v0.10: Schedule-Strategy places sessions per user-specific
        // constraints (forced rest days, long-run day) and concurrent-training
        // science (strength A=Mon, B=Thu, C=Fri; quality run alone Tue;
        // long run alone Sat). Replaces the v0.9 naive "concat run+strength"
        // merge that had Strength B locked on Wed (Q's office day).
        const mergedSessions: SessionPlan[] = planWeekSchedule(
          runPlan.sessions,
          strengthPlan.sessions,
          weekStart,
          constraintsFromUserSettings({
            forcedRestDaysIso: scheduleSettings?.forcedRestDays ?? null,
            preferredLongRunDayIso: scheduleSettings?.preferredLongRunDay ?? null,
          }),
        );

        await tx.weeklyPlan.create({
          data: {
            phaseId: phaseRow.id,
            weekNumber: weekNumberInMacro,
            startDate: weekStart,
            endDate: weekEnd,
            plannedSessions: mergedSessions as unknown as object,
          },
        });
      }
    }

    return { goalId: goal.id, macrocycleId: macrocycle.id, totalPhases: macrocyclePlan.phases.length };
  });

  // Sprint v0.10: best-effort Garmin cleanup of orphan workouts from the
  // now-abandoned macrocycle. Fire-and-forget: failures don't block the
  // onboarding response. Each removeWorkoutFromGarmin call is itself
  // best-effort (logs but doesn't throw).
  if (orphanGarminWorkoutIds.length > 0) {
    void Promise.all(
      orphanGarminWorkoutIds.map((id) =>
        removeWorkoutFromGarmin(id).catch((e) =>
          console.error(
            "[onboarding] orphan Garmin cleanup failed for",
            id,
            e,
          ),
        ),
      ),
    );
  }

  // Surface the calibration as a notification so Q sees the result + reasoning.
  // Best-effort — never fails onboarding.
  try {
    await createNotification({
      userId,
      type: "VDOT_CALIBRATED",
      title: useGarminCalibration
        ? `Initial VDOT: ${initialVdot} (Garmin-calibrated, ${garminCalibration!.confidence})`
        : `Initial VDOT: ${initialVdot} (Daniels from Goal)`,
      message: useGarminCalibration
        ? `Aus ${garminRuns.length} Garmin-Runs der letzten 90 Tage berechnet. Range ${garminCalibration!.range.min}-${garminCalibration!.range.max}. App kalibriert mit jedem Lauf nach.`
        : `Garmin-Daten reichen für Multi-Method-Calibration nicht — Default aus Goal.currentValue verwendet. App kalibriert nach ein paar Runs nach.`,
      severity: "INFO",
      actionUrl: "/settings",
    });
  } catch (e) {
    console.error("[onboarding] notification create failed:", e);
  }

  return NextResponse.json({
    status: "ok",
    ...result,
    initialVdot,
    vdotSource: useGarminCalibration ? "garmin_calibration" : "daniels_from_goal",
    calibration: garminCalibration,
    garminProfile,
    macrocycle: {
      totalWeeks: macrocyclePlan.totalWeeks,
      startDate: macrocyclePlan.startDate.toISOString(),
      endDate: macrocyclePlan.endDate.toISOString(),
      phases: macrocyclePlan.phases.map((p) => ({
        blockNumber: p.blockNumber,
        phaseName: p.phaseName,
        startWeek: p.startWeek,
        endWeek: p.endWeek,
        vdotTarget: p.vdotTarget,
      })),
    },
  });
}
