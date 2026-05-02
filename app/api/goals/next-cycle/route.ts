// POST /api/goals/next-cycle → create next macrocycle from evaluation.
//
// Two modes:
//   { confirmed: false } → preview (return adjusted configs + targets)
//   { confirmed: true }  → create Goal + Macrocycle + Phases + WeeklyPlans
//
// Reuses the onboarding pattern but applies focus-adjusted BLOCK_CONFIGS.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { generateMacrocycle, BLOCK_CONFIGS } from "@/lib/coach-engine/periodization";
import { adjustBlockConfigsForFocus } from "@/lib/coach-engine/periodization/focus-configs";
import { generateWeekRunPlan } from "@/lib/coach-engine/run-coach";
import { generateWeekStrengthPlan } from "@/lib/coach-engine/strength-coach";
import {
  constraintsFromUserSettings,
  planWeekSchedule,
} from "@/lib/coach-engine/schedule-strategy";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import type { MacrocycleFocus, SessionPlan, TherapyPhase } from "@/lib/coach-engine/types";
import { dayKey } from "@/lib/db/queries/sensors";

const NextCycleBodySchema = z.object({
  confirmed: z.boolean(),
  focusMode: z.enum(["balanced", "strength_focus", "endurance_focus", "recomp"]),
  targets: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  focusRationale: z.string().optional(),
});

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  const body = await req.json();
  const parsed = NextCycleBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { confirmed, focusMode, targets: nextTargets, focusRationale } = parsed.data;
  const focus = focusMode as MacrocycleFocus;

  // Compute adjusted configs for preview
  const adjustedConfigs = adjustBlockConfigsForFocus(BLOCK_CONFIGS, focus);

  // Preview mode: return what would be created
  if (!confirmed) {
    return NextResponse.json({
      status: "ok",
      mode: "preview",
      focusMode: focus,
      adjustedConfigs,
      nextTargets: nextTargets ?? {},
    });
  }

  // ─── Confirmed: create the new cycle ───────────────────

  const annualGoal = await db.annualGoal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!annualGoal) {
    return NextResponse.json({ error: "No active annual goal" }, { status: 404 });
  }

  // Load user settings for plan generation
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: {
      forcedRestDays: true,
      preferredLongRunDay: true,
      exerciseMaxEstimates: true,
      therapyPhaseOverride: true,
      hrMax: true,
      hrRest: true,
    },
  });

  const effectiveVdot = await getEffectiveVdot(userId);
  const userMaxEstimates =
    (settings?.exerciseMaxEstimates as Record<string, number> | null) ?? null;
  const therapyPhase = (settings?.therapyPhaseOverride as TherapyPhase | null) ?? null;
  const hrCtx = {
    hrMax: settings?.hrMax ?? undefined,
    hrRest: settings?.hrRest ?? undefined,
  };

  // Start date: next Monday after today
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
  const startDate = new Date(dayKey(now).getTime() + daysUntilMonday * 86400000);

  // Use standard GoalInput to generate macrocycle structure
  const goalInput = {
    primaryType: "5k_time" as const,
    currentValue: { time: (nextTargets?.["5k"] as string) ?? "22:00", date: now },
    targetValue: { time: (nextTargets?.["5k"] as string) ?? "22:00", date: new Date(annualGoal.targetDate) },
    modality: "hybrid" as const,
    constraints: [],
    preferences: { strengthPerWeek: 3, maxTrainingDays: 6 },
    startDate,
    vdotInitial: effectiveVdot,
  };

  const macrocyclePlan = generateMacrocycle(goalInput);

  // Atomic transaction: create everything
  const result = await db.$transaction(async (tx) => {
    // Mark old macrocycle as completed
    await tx.macrocycle.updateMany({
      where: { userId, status: "active" },
      data: { status: "completed" },
    });

    // Create new Goal
    const goal = await tx.goal.create({
      data: {
        userId,
        primaryType: goalInput.primaryType,
        currentValue: { time: goalInput.currentValue.time, date: dayKey(now).toISOString() },
        targetValue: { time: goalInput.targetValue.time, date: goalInput.targetValue.date.toISOString() },
        modality: goalInput.modality,
        constraints: goalInput.constraints,
        preferences: goalInput.preferences,
        startDate,
        targetDate: goalInput.targetValue.date,
        status: "active",
      },
    });

    // Create new Macrocycle with focus mode
    const macrocycle = await tx.macrocycle.create({
      data: {
        userId,
        goalId: goal.id,
        annualGoalId: annualGoal.id,
        focusMode: focus,
        startDate: macrocyclePlan.startDate,
        endDate: macrocyclePlan.endDate,
        totalWeeks: macrocyclePlan.totalWeeks,
        status: "active",
      },
    });

    // Create Phases + WeeklyPlans with focus-adjusted configs
    for (const phase of macrocyclePlan.phases) {
      // Use the focus-adjusted config for this block
      const focusConfig = adjustedConfigs[phase.blockNumber];

      const phaseRow = await tx.phase.create({
        data: {
          macrocycleId: macrocycle.id,
          blockNumber: phase.blockNumber,
          name: focusConfig.phaseName,
          startDate: phase.startDate,
          plannedEndDate: phase.plannedEndDate,
          durationWeeks: focusConfig.durationWeeks,
          config: focusConfig as unknown as object,
          status: "active",
        },
      });

      for (let w = 0; w < focusConfig.durationWeeks; w++) {
        const weekStart = new Date(phase.startDate.getTime() + w * 7 * 86400000);
        const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
        const weekNumberInMacro = phase.startWeek + w;

        const runPlan = generateWeekRunPlan(
          focusConfig,
          weekNumberInMacro,
          effectiveVdot,
          weekStart,
          hrCtx,
        );
        const strengthPlan = generateWeekStrengthPlan(
          focusConfig,
          weekNumberInMacro,
          weekStart,
          null,
          therapyPhase,
          userMaxEstimates,
        );

        const mergedSessions: SessionPlan[] = planWeekSchedule(
          runPlan.sessions,
          strengthPlan.sessions,
          weekStart,
          constraintsFromUserSettings({
            forcedRestDaysIso: settings?.forcedRestDays ?? null,
            preferredLongRunDayIso: settings?.preferredLongRunDay ?? null,
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

    return {
      goalId: goal.id,
      macrocycleId: macrocycle.id,
      totalPhases: macrocyclePlan.phases.length,
    };
  });

  return NextResponse.json({
    status: "ok",
    mode: "created",
    ...result,
    focusMode: focus,
    focusRationale: focusRationale ?? "",
    startDate: macrocyclePlan.startDate.toISOString(),
    endDate: macrocyclePlan.endDate.toISOString(),
  });
}
