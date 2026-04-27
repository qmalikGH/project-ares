// POST /api/coach/explain-session
// Generates the AI-Coach's 3-5 sentence explanation of today's modulated session.
// Persists the call in AIConversation with token usage + cost.
//
// Body: { force?: boolean }  // force=true bypasses any cached explanation
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  anthropic,
  costFromUsage,
  DEFAULT_MODEL,
  extractText,
} from "@/lib/ai-coach/client";
import {
  DAILY_EXPLANATION_SYSTEM_PROMPT,
  buildDailyExplanationUserContent,
  type DailyExplanationContext,
} from "@/lib/ai-coach/prompts/daily-explanation";
import { loadWorkoutContext } from "@/lib/db/queries/workout-context";
import { formatWorkoutContext } from "@/lib/ai-coach/prompts/workout-context";
import { isAiCoachEnabled } from "@/lib/db/queries/settings";
import { computeReadiness, computeBaselines } from "@/lib/coach-engine/readiness";
import { buildLoadOutput, computeDailyLoad } from "@/lib/coach-engine/load-monitoring";
import { computeKneeStatus } from "@/lib/coach-engine/limitations";
import { modulateSession } from "@/lib/coach-engine/session-modulator";
import {
  getCurrentPhaseRow,
  findWeekPlanForDate,
  findTodaySessionInPlan,
} from "@/lib/db/queries/plans";
import {
  getRecentSensorData,
  rowsToSensorInputs,
  rowsToKneeLogs,
  getRecentDailyLoads,
  getSensorDataOnDate,
  dayKey,
} from "@/lib/db/queries/sensors";
import type {
  DailySensorInputs,
  SessionPlan,
  TherapyPhase,
  UserMorningInputs,
} from "@/lib/coach-engine/types";

const Schema = z.object({ force: z.boolean().optional() });

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  if (!(await isAiCoachEnabled(userId))) {
    return NextResponse.json({ status: "AI_COACH_DISABLED" }, { status: 200 });
  }
  const today = new Date();
  const todayDay = dayKey(today);

  // Cache: re-use today's explanation unless `force` is set
  if (!parsed.data.force) {
    const existing = await db.aIConversation.findFirst({
      where: {
        userId,
        type: "daily_explanation",
        contextRef: todayDay.toISOString().slice(0, 10),
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const messages = existing.messages as Array<{ role: string; content: string }>;
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        return NextResponse.json({
          status: "ok",
          explanation: last.content,
          cached: true,
          cost: { tokensInput: existing.tokensInput, tokensOutput: existing.tokensOutput, costUsd: existing.costUsd },
        });
      }
    }
  }

  // Re-run the modulation pipeline so explanation context matches current state
  const phaseRow = await getCurrentPhaseRow(userId, today);
  if (!phaseRow) return NextResponse.json({ status: "NO_ACTIVE_PLAN" });
  const weekPlan = findWeekPlanForDate(phaseRow.weeklyPlans, today);
  if (!weekPlan) return NextResponse.json({ status: "NO_WEEK_PLAN" });
  const plannedSession = findTodaySessionInPlan(weekPlan.plannedSessions, today);
  if (!plannedSession) return NextResponse.json({ status: "NO_SESSION_TODAY" });

  const todayRow = await getSensorDataOnDate(userId, today);
  if (!todayRow?.userMorning) {
    return NextResponse.json({ status: "AWAITING_MORNING_INPUT" });
  }

  const recentRows = await getRecentSensorData(userId, 30);
  const baselines = computeBaselines(rowsToSensorInputs(recentRows));
  const todayInputs: DailySensorInputs = {
    date: todayDay,
    garmin: (todayRow.garmin as unknown as DailySensorInputs["garmin"]) ?? undefined,
    userMorning: todayRow.userMorning as unknown as UserMorningInputs,
  };
  const readiness = computeReadiness(todayInputs, baselines);
  const recentLoads = await getRecentDailyLoads(userId, 28);
  const todayLoadAu = computeDailyLoad(0, 0);
  const load = buildLoadOutput(recentLoads, todayLoadAu, todayDay);
  const limitations = computeKneeStatus(
    { morning: todayInputs.userMorning, postSession: todayInputs.userPostSession?.trainingScore },
    rowsToKneeLogs(recentRows),
    (todayRow.therapyPhase as TherapyPhase | null) ?? "DISREPAIR",
    null,
  );
  const finalSession = modulateSession(plannedSession as SessionPlan, readiness, load, limitations);

  const rawSensors = {
    hrvRmssd: todayInputs.garmin?.hrvRmssd ?? null,
    hrvBaselineRmssd: Math.round(baselines.hrv28dAvg),
    sleepScore: todayInputs.garmin?.sleepScore ?? null,
    sleepDurationMin: todayInputs.garmin?.sleepDurationMin ?? null,
    bodyBatteryMorning: todayInputs.garmin?.bodyBatteryMorning ?? null,
    rhr: todayInputs.garmin?.rhr ?? null,
    rhrBaseline: Math.round(baselines.rhr28dAvg),
    subjectiveRecovery1to10: todayInputs.userMorning.subjectiveRecovery,
  };

  const ctx: DailyExplanationContext = {
    date: todayDay,
    weekNumber: weekPlan.weekNumber,
    blockNumber: phaseRow.blockNumber,
    phaseName: phaseRow.name,
    plannedSession: plannedSession as SessionPlan,
    finalSession,
    readiness,
    load,
    limitations,
  };

  const sessionUserContent = buildDailyExplanationUserContent(ctx, rawSensors);

  // Append workout-context (always-on plan snapshot) so the explanation can
  // reference upcoming sessions ("warum heute easy: morgen Threshold") and
  // recent RPE trends.
  let workoutContextBlock = "";
  try {
    const wctx = await loadWorkoutContext(userId, new Date());
    if (wctx) workoutContextBlock = `\n\n---\n\n${formatWorkoutContext(wctx)}`;
  } catch {
    // non-fatal
  }
  const userContent = sessionUserContent + workoutContextBlock;

  // Frozen system prompt → cache_control:ephemeral. Per-request user content is volatile.
  let response;
  try {
    response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 600,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: DAILY_EXPLANATION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[explain-session] Anthropic call failed:", message);
    return NextResponse.json({ status: "AI_ERROR", error: message }, { status: 502 });
  }

  const explanation = extractText(response);
  const cost = costFromUsage(response.model, response.usage);

  await db.aIConversation.create({
    data: {
      userId,
      type: "daily_explanation",
      contextRef: todayDay.toISOString().slice(0, 10),
      messages: [
        { role: "user", content: userContent },
        { role: "assistant", content: explanation },
      ],
      modelUsed: response.model,
      tokensInput: cost.inputTokens,
      tokensOutput: cost.outputTokens,
      costUsd: cost.costUsd,
    },
  });

  return NextResponse.json({
    status: "ok",
    explanation,
    cached: false,
    cost: {
      tokensInput: cost.inputTokens,
      tokensOutput: cost.outputTokens,
      cacheReadInputTokens: cost.cacheReadInputTokens,
      cacheCreationInputTokens: cost.cacheCreationInputTokens,
      costUsd: cost.costUsd,
    },
  });
}
