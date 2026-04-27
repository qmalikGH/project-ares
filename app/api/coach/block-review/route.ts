// POST /api/coach/block-review
// Aggregate the just-finished block, run the engine's transition decision,
// AI-narrate, persist BlockReview row, link to the Phase.
//
// Body: { phaseId?: string }  // defaults to most recently ended Phase
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
  BLOCK_REVIEW_SYSTEM_PROMPT,
  buildBlockReviewUserContent,
} from "@/lib/ai-coach/prompts/block-review";
import { decidePhaseTransition } from "@/lib/coach-engine/periodization";
import { buildBlockReviewInput } from "@/lib/block-review/compute";
import { dayKey } from "@/lib/db/queries/sensors";
import type { PhaseName } from "@/lib/coach-engine/types";

const Schema = z.object({ phaseId: z.string().optional() });

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty OK */
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const userId = await getCurrentUserId();

  // Pick the phase: explicit id, else most recently completed (plannedEndDate <= today)
  let phase = parsed.data.phaseId
    ? await db.phase.findFirst({
        where: { id: parsed.data.phaseId, macrocycle: { userId } },
        include: { macrocycle: true },
      })
    : null;

  if (!phase) {
    const today0 = dayKey(new Date());
    phase = await db.phase.findFirst({
      where: { macrocycle: { userId }, plannedEndDate: { lte: today0 } },
      include: { macrocycle: true },
      orderBy: { plannedEndDate: "desc" },
    });
  }
  if (!phase) {
    return NextResponse.json({ status: "NO_PHASE_FOUND" }, { status: 404 });
  }

  // Pull workouts + sensor rows in the block window
  const [workouts, sensorRows] = await Promise.all([
    db.workout.findMany({
      where: {
        userId,
        date: { gte: phase.startDate, lt: phase.plannedEndDate },
      },
      select: { date: true, type: true, status: true, rpe: true, durationActualMin: true },
      orderBy: { date: "asc" },
    }),
    db.dailySensorData.findMany({
      where: { userId, date: { gte: phase.startDate, lt: phase.plannedEndDate } },
      select: { date: true, readinessScore: true, kneeScore: true, loadMetrics: true },
      orderBy: { date: "asc" },
    }),
  ]);

  // For v0.1, performance-marker uses the phase's vdot config — actual achieved VDOT
  // would come from a calibration run / time trial. Set both to the target so we
  // always produce a valid review; UI can override later.
  const phaseConfig = phase.config as { vdotTarget?: number } | null;
  const targetVdot = phaseConfig?.vdotTarget ?? null;
  const achievedVdot = targetVdot; // v0.1 placeholder

  const reviewInput = buildBlockReviewInput({
    workouts,
    sensorRows,
    performance: { targetVdot, achievedVdot, targetTime: null, achievedTime: null },
  });

  const decision = decidePhaseTransition(phase.name as PhaseName, reviewInput);

  // AI narration
  let aiSummary: string | null = null;
  let aiCostUsd = 0;
  if (process.env.ENABLE_AI_COACH === "true") {
    try {
      const userContent = buildBlockReviewUserContent(phase.blockNumber, phase.name, reviewInput, decision);
      const response = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 600,
        thinking: { type: "adaptive" },
        system: [
          { type: "text", text: BLOCK_REVIEW_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userContent }],
      });
      aiSummary = extractText(response);
      const cost = costFromUsage(response.model, response.usage);
      aiCostUsd = cost.costUsd;
      await db.aIConversation.create({
        data: {
          userId,
          type: "block_review",
          contextRef: phase.id,
          messages: [
            { role: "user", content: userContent },
            { role: "assistant", content: aiSummary },
          ],
          modelUsed: response.model,
          tokensInput: cost.inputTokens,
          tokensOutput: cost.outputTokens,
          costUsd: cost.costUsd,
        },
      });
    } catch {
      /* AI optional — proceed without summary */
    }
  }

  // Persist BlockReview + link
  const review = await db.blockReview.create({
    data: {
      performanceMarkerResult: {
        targetVdot,
        achievedVdot,
        met: reviewInput.performanceMarkerMet,
        close: reviewInput.performanceMarkerClose,
      },
      actualTID: reviewInput.actualTID,
      averageACWR: reviewInput.averageACWR,
      averageReadiness: reviewInput.averageReadiness,
      kneeScoreTrend: reviewInput.kneeScoreTrend,
      missedSessionsCount: reviewInput.missedSessionsCount,
      decision: decision.decision,
      decisionRationale: rationaleFor(decision),
      aiSummary,
    },
  });

  await db.phase.update({
    where: { id: phase.id },
    data: { blockReviewId: review.id, status: phase.actualEndDate ? phase.status : "completed" },
  });

  return NextResponse.json({
    status: "ok",
    blockReviewId: review.id,
    decision,
    reviewInput,
    aiSummary,
    aiCostUsd,
  });
}

function rationaleFor(d: { decision: string } & Record<string, unknown>): string {
  switch (d.decision) {
    case "PROCEED":
      return d.recoverInNext ? "Performance verfehlt, aber heilbar im nächsten Block (Distribution-Problem)." : "Performance erreicht, Health stabil.";
    case "EXTEND_PHASE":
      return `Performance knapp, Health-Warnung. Block um ${d.extendByWeeks ?? "?"} Woche(n) verlängern.`;
    case "ADJUST_PHASE":
      return `Health im Decline. Intensität um ${(Number(d.reduceIntensityFraction ?? 0) * 100).toFixed(0)}% reduzieren.`;
    case "DEFER":
      return `Performance verfehlt, Ursache unklar. Block um ${d.deferByWeeks ?? "?"} Woche(n) verschieben.`;
    default:
      return "—";
  }
}
