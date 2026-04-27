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
import type { GoalInput, SessionPlan, TherapyPhase } from "@/lib/coach-engine/types";
import { dayKey } from "@/lib/db/queries/sensors";

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

  const goalInput: GoalInput = {
    primaryType: input.primaryType,
    currentValue: { time: input.currentTime, date: dayKey(new Date()) },
    targetValue: { time: input.targetTime, date: targetDate },
    modality: input.modality,
    constraints: input.constraints,
    preferences: input.preferences,
    startDate,
    vdotInitial: input.vdotInitial,
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

        const runPlan = generateWeekRunPlan(phase.config, weekNumberInMacro, input.vdotInitial, weekStart);
        const strengthPlan = generateWeekStrengthPlan(
          phase.config,
          weekNumberInMacro,
          weekStart,
          null,
          initialTherapyPhase,
        );

        // Merge: replace placeholder strength sessions in run plan with actual ones,
        // matched by date. Run plan is the spine (7 days), strength sessions slot into Mon/Wed/Fri afternoons.
        const mergedSessions: SessionPlan[] = [...runPlan.sessions];
        for (const strSess of strengthPlan.sessions) {
          // Strength sessions don't replace run sessions — they're additional PM sessions same day.
          // Tag them with a different time to differentiate; UI handles display.
          mergedSessions.push(strSess);
        }

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

  return NextResponse.json({
    status: "ok",
    ...result,
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
