// POST /api/coach/conversation
//
// Sprint v0.12: tool-use enabled. The coach handles user prose AND can
// modify the training plan via four tools (substitute_exercise,
// adjust_run_volume, set_therapy_phase, skip_session). Loop:
//
//   1. Render messages (system + tools + history + new user turn).
//   2. Call anthropic.messages.create with tools.
//   3. If stop_reason === "tool_use": execute each tool_use block, append
//      tool_results as a user-role message, call again. Cap at 5 iterations
//      so a misbehaving model can't burn the budget.
//   4. Persist USER text + FINAL assistant text to AIConversation.messages
//      (schema is plain {role, content: string}; tool_use blocks live only
//      in the live request). Sum usage across iterations for cost tracking.
//
// Cache strategy: cache_control on the last tool definition (in tools.ts)
// caches the tools array; cache_control on the system block caches the
// tools+system prefix together. Volatile content (the workout-context
// block, profile, prior messages, new user message) sits in `messages` —
// changing it does NOT invalidate the tools+system cache, so cache_read
// stays hot across turns.
//
// Body: { conversationId?: string, message: string }
// Returns: { conversationId, reply, intent, cost, toolsUsed }
import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  anthropic,
  costFromUsage,
  DEFAULT_MODEL,
  extractText,
} from "@/lib/ai-coach/client";
import {
  FREE_CHAT_SYSTEM_PROMPT,
  buildFreeChatMessages,
  detectIntent,
  formatBlockStatus,
  formatKneeHistory,
  formatRecoveryTrend,
  type FreeChatProfile,
  type KneeHistoryEntry,
  type RecoveryTrendEntry,
} from "@/lib/ai-coach/prompts/free-chat";
import { COACH_TOOLS } from "@/lib/ai-coach/tools";
import { executeCoachTool } from "@/lib/coach-engine/coach-tools";
import { getActiveGoal, getActiveMacrocycle } from "@/lib/db/queries/plans";
import { getRecentSensorData } from "@/lib/db/queries/sensors";
import { userToday } from "@/lib/date";
import { loadWorkoutContext } from "@/lib/db/queries/workout-context";
import { formatWorkoutContext } from "@/lib/ai-coach/prompts/workout-context";
import { isAiCoachEnabled } from "@/lib/db/queries/settings";

const Schema = z.object({
  conversationId: z.string().nullable().optional(),
  message: z.string().min(1).max(4000),
});

const MAX_TOOL_ITERATIONS = 5;

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
  if (!(await isAiCoachEnabled(userId))) {
    return NextResponse.json({ status: "AI_COACH_DISABLED" }, { status: 200 });
  }
  const { message } = parsed.data;

  let conversation = parsed.data.conversationId
    ? await db.aIConversation.findFirst({
        where: { id: parsed.data.conversationId, userId, type: "free_chat" },
      })
    : null;

  const priorMessages =
    (conversation?.messages as Array<{
      role: "user" | "assistant";
      content: string;
    }> | null) ?? [];

  // ── Profile + intent + workout context (unchanged from v0.11) ──
  const goal = await getActiveGoal(userId);
  const macro = await getActiveMacrocycle(userId);
  const today = userToday();
  const currentPhase = macro?.phases.find(
    (p) => today >= p.startDate && today < p.plannedEndDate,
  );
  const recentSensors = await getRecentSensorData(userId, 7);
  const trendLabel = describeTrend(recentSensors);

  const goalCurrent =
    (goal?.currentValue as { time?: string } | null)?.time ?? "?";
  const goalTarget =
    (goal?.targetValue as { time?: string } | null)?.time ?? "?";
  const profile: FreeChatProfile = {
    goalSummary: goal
      ? `${goal.primaryType} ${goalCurrent} → ${goalTarget}`
      : "(noch kein Goal)",
    currentBlock: currentPhase?.name ?? "(unbekannt)",
    weekNumber: weekNumberInMacro(macro?.startDate ?? null, today),
    vdotInitial: 42,
    recentTrend: trendLabel,
    activeConstraints: extractConstraints(recentSensors),
  };

  const intent = detectIntent(message);
  const contextBlocks: string[] = [];

  if (intent.knee) {
    const kneeHistory: KneeHistoryEntry[] = [];
    for (const r of recentSensors.slice(-14)) {
      const m = r.userMorning as
        | {
            morningStiffness?: number;
            stairsScore?: number;
            postSessionScore?: number;
          }
        | null;
      if (!m || m.morningStiffness == null || m.stairsScore == null) continue;
      kneeHistory.push({
        date: r.date.toISOString().slice(0, 10),
        morningStiffness: m.morningStiffness,
        stairsScore: m.stairsScore,
        postSession: m.postSessionScore,
      });
    }
    contextBlocks.push(formatKneeHistory(kneeHistory));
  }

  if (intent.recovery) {
    const trendEntries: RecoveryTrendEntry[] = recentSensors
      .slice(-14)
      .map((r) => {
        const garmin = r.garmin as
          | { hrvRmssd?: number; sleepScore?: number; rhr?: number }
          | null;
        return {
          date: r.date.toISOString().slice(0, 10),
          hrv: garmin?.hrvRmssd ?? null,
          sleepScore: garmin?.sleepScore ?? null,
          rhr: garmin?.rhr ?? null,
          readinessScore: r.readinessScore,
        };
      });
    contextBlocks.push(formatRecoveryTrend(trendEntries));
  }

  if (intent.block && currentPhase && macro) {
    contextBlocks.push(
      formatBlockStatus({
        blockNumber: currentPhase.blockNumber,
        phaseName: currentPhase.name,
        startDate: currentPhase.startDate.toISOString().slice(0, 10),
        endDate: currentPhase.plannedEndDate.toISOString().slice(0, 10),
        averageReadiness: averageReadiness(recentSensors),
        averageACWR: null,
      }),
    );
  }

  let workoutContext: string | null = null;
  try {
    const ctx = await loadWorkoutContext(userId, new Date());
    if (ctx) workoutContext = formatWorkoutContext(ctx);
  } catch {
    // Non-fatal — coach still works on profile + intent context alone.
  }

  // The initial messages array (text-only). The tool-use loop will append
  // assistant content blocks (incl. tool_use) and user tool_result blocks.
  const initialMessages = buildFreeChatMessages({
    profile,
    priorMessages,
    newUserMessage: message,
    workoutContext,
    contextBlocks,
  });

  // Promote to MessageParam so subsequent appends can carry mixed content.
  const liveMessages: Anthropic.MessageParam[] = initialMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Cost accumulators.
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  let totalCostUsd = 0;
  let lastModel = DEFAULT_MODEL;
  const toolsUsed: Array<{ name: string; result: string }> = [];

  let response: Anthropic.Message;
  let iteration = 0;

  try {
    while (true) {
      response = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 1024,
        thinking: { type: "adaptive" },
        system: [
          {
            type: "text",
            text: FREE_CHAT_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: COACH_TOOLS,
        messages: liveMessages,
      });

      const usage = costFromUsage(response.model, response.usage);
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      totalCacheCreate += usage.cacheCreationInputTokens;
      totalCacheRead += usage.cacheReadInputTokens;
      totalCostUsd += usage.costUsd;
      lastModel = response.model;

      if (response.stop_reason !== "tool_use") break;
      if (++iteration >= MAX_TOOL_ITERATIONS) break;

      // Append the assistant turn (full content — including tool_use blocks)
      // so the next iteration sees the same context Claude sees.
      liveMessages.push({ role: "assistant", content: response.content });

      // Execute every tool_use block in this turn and collect tool_results.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const result = await executeCoachTool(userId, block.name, block.input);
        toolsUsed.push({ name: block.name, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
      liveMessages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "AI_ERROR", error: errMsg },
      { status: 502 },
    );
  }

  const reply = extractText(response);

  // Persist USER text + FINAL assistant text (schema is plain string content;
  // intermediate tool_use/tool_result blocks aren't part of the durable
  // history because each user turn re-derives plan state from workoutContext).
  const updatedMessages = [
    ...priorMessages,
    { role: "user" as const, content: message },
    { role: "assistant" as const, content: reply },
  ];

  if (conversation) {
    const prevCost = conversation.costUsd
      ? Number(conversation.costUsd.toString())
      : 0;
    conversation = await db.aIConversation.update({
      where: { id: conversation.id },
      data: {
        messages: updatedMessages,
        modelUsed: lastModel,
        tokensInput: (conversation.tokensInput ?? 0) + totalInputTokens,
        tokensOutput: (conversation.tokensOutput ?? 0) + totalOutputTokens,
        costUsd: prevCost + totalCostUsd,
      },
    });
  } else {
    conversation = await db.aIConversation.create({
      data: {
        userId,
        type: "free_chat",
        messages: updatedMessages,
        modelUsed: lastModel,
        tokensInput: totalInputTokens,
        tokensOutput: totalOutputTokens,
        costUsd: totalCostUsd,
      },
    });
  }

  return NextResponse.json({
    conversationId: conversation.id,
    reply,
    intent,
    toolsUsed,
    cost: {
      tokensInput: totalInputTokens,
      tokensOutput: totalOutputTokens,
      cacheReadInputTokens: totalCacheRead,
      cacheCreationInputTokens: totalCacheCreate,
      costUsd: Math.round(totalCostUsd * 10000) / 10000,
    },
  });
}

function weekNumberInMacro(startDate: Date | null, today: Date): number {
  if (!startDate) return 0;
  const diffDays = Math.floor(
    (today.getTime() - startDate.getTime()) / 86400000,
  );
  if (diffDays < 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}

function describeTrend(
  rows: { readinessScore: number | null; date: Date }[],
): string {
  const scores = rows
    .map((r) => r.readinessScore)
    .filter((s): s is number => s !== null)
    .slice(-7);
  if (scores.length < 3) return "stabil (zu wenig Daten für Trend)";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const last3Avg = scores.slice(-3).reduce((a, b) => a + b, 0) / 3;
  if (last3Avg > avg + 5) return "Readiness verbessert sich";
  if (last3Avg < avg - 5) return "Readiness fällt";
  return "stabil";
}

function extractConstraints(
  rows: { therapyPhase: string | null; kneeScore: number | null }[],
): string[] {
  const last = rows[rows.length - 1];
  if (!last) return [];
  const out: string[] = [];
  if (last.therapyPhase === "REACTIVE") out.push("Sehnen-Therapie REACTIVE");
  else if (last.therapyPhase === "DISREPAIR")
    out.push("Sehnen-Therapie DISREPAIR");
  if (last.kneeScore != null && last.kneeScore >= 5)
    out.push(`Knee-Score ${last.kneeScore}/10`);
  return out;
}

function averageReadiness(
  rows: { readinessScore: number | null }[],
): number | null {
  const scores = rows
    .map((r) => r.readinessScore)
    .filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
