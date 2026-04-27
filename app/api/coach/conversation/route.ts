// POST /api/coach/conversation
// Free-chat with smart context window. Persists across messages within a conversationId.
//
// Body: { conversationId?: string, message: string }
// Returns: { conversationId, reply, cost }
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
import { getActiveGoal, getActiveMacrocycle } from "@/lib/db/queries/plans";
import { dayKey, getRecentSensorData } from "@/lib/db/queries/sensors";

const Schema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(4000),
});

export async function POST(req: Request) {
  if (process.env.ENABLE_AI_COACH !== "true") {
    return NextResponse.json({ status: "AI_COACH_DISABLED" }, { status: 200 });
  }

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
  const { message } = parsed.data;

  // Load (or create) the conversation
  let conversation = parsed.data.conversationId
    ? await db.aIConversation.findFirst({ where: { id: parsed.data.conversationId, userId, type: "free_chat" } })
    : null;

  const priorMessages =
    (conversation?.messages as Array<{ role: "user" | "assistant"; content: string }> | null) ?? [];

  // Build profile summary (always-on context)
  const goal = await getActiveGoal(userId);
  const macro = await getActiveMacrocycle(userId);
  const today = dayKey(new Date());
  const currentPhase = macro?.phases.find(
    (p) => today >= p.startDate && today < p.plannedEndDate,
  );
  const recentSensors = await getRecentSensorData(userId, 7);
  const trendLabel = describeTrend(recentSensors);

  const goalCurrent = (goal?.currentValue as { time?: string } | null)?.time ?? "?";
  const goalTarget = (goal?.targetValue as { time?: string } | null)?.time ?? "?";
  const profile: FreeChatProfile = {
    goalSummary: goal ? `${goal.primaryType} ${goalCurrent} → ${goalTarget}` : "(noch kein Goal)",
    currentBlock: currentPhase?.name ?? "(unbekannt)",
    weekNumber: weekNumberInMacro(macro?.startDate ?? null, today),
    vdotInitial: 42,
    recentTrend: trendLabel,
    activeConstraints: extractConstraints(recentSensors),
  };

  // Intent-aware context expansion
  const intent = detectIntent(message);
  const contextBlocks: string[] = [];

  if (intent.knee) {
    const kneeHistory: KneeHistoryEntry[] = [];
    for (const r of recentSensors.slice(-14)) {
      const m = r.userMorning as { morningStiffness?: number; stairsScore?: number; postSessionScore?: number } | null;
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
    const trendEntries: RecoveryTrendEntry[] = recentSensors.slice(-14).map((r) => {
      const garmin = r.garmin as { hrvRmssd?: number; sleepScore?: number; rhr?: number } | null;
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
        averageACWR: null, // not pre-computed; left null for v0.1
      }),
    );
  }

  const messages = buildFreeChatMessages({
    profile,
    priorMessages,
    newUserMessage: message,
    contextBlocks,
  });

  let response;
  try {
    response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 800,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: FREE_CHAT_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "AI_ERROR", error: message }, { status: 502 });
  }

  const reply = extractText(response);
  const cost = costFromUsage(response.model, response.usage);

  // Persist the (now-extended) conversation
  const updatedMessages = [...priorMessages, { role: "user" as const, content: message }, { role: "assistant" as const, content: reply }];

  if (conversation) {
    // Prisma Decimal — coerce to number via toString() before adding
    const prevCost = conversation.costUsd ? Number(conversation.costUsd.toString()) : 0;
    conversation = await db.aIConversation.update({
      where: { id: conversation.id },
      data: {
        messages: updatedMessages,
        modelUsed: response.model,
        tokensInput: (conversation.tokensInput ?? 0) + cost.inputTokens,
        tokensOutput: (conversation.tokensOutput ?? 0) + cost.outputTokens,
        costUsd: prevCost + cost.costUsd,
      },
    });
  } else {
    conversation = await db.aIConversation.create({
      data: {
        userId,
        type: "free_chat",
        messages: updatedMessages,
        modelUsed: response.model,
        tokensInput: cost.inputTokens,
        tokensOutput: cost.outputTokens,
        costUsd: cost.costUsd,
      },
    });
  }

  return NextResponse.json({
    conversationId: conversation.id,
    reply,
    intent,
    cost: {
      tokensInput: cost.inputTokens,
      tokensOutput: cost.outputTokens,
      cacheReadInputTokens: cost.cacheReadInputTokens,
      cacheCreationInputTokens: cost.cacheCreationInputTokens,
      costUsd: cost.costUsd,
    },
  });
}

function weekNumberInMacro(startDate: Date | null, today: Date): number {
  if (!startDate) return 0;
  const diffDays = Math.floor((today.getTime() - startDate.getTime()) / 86400000);
  if (diffDays < 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}

function describeTrend(rows: { readinessScore: number | null; date: Date }[]): string {
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
  else if (last.therapyPhase === "DISREPAIR") out.push("Sehnen-Therapie DISREPAIR");
  if (last.kneeScore != null && last.kneeScore >= 5) out.push(`Knee-Score ${last.kneeScore}/10`);
  return out;
}

function averageReadiness(rows: { readinessScore: number | null }[]): number | null {
  const scores = rows.map((r) => r.readinessScore).filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
