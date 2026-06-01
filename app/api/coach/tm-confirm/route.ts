// POST /api/coach/tm-confirm
// Apply confirmed Training-Max increments from the W4 block-review (Sprint 2.1).
//
// Body: { phaseId: string, acceptedExercises: string[] }
//   - phaseId: the reviewed phase whose proposals are being confirmed
//   - acceptedExercises: exercise names the user accepted
//
// The proposals are RE-COMPUTED server-side (proposalsForPhase) and only the
// accepted, actionable ones are applied — the client never supplies the kg
// value, so a tampered body can't inject an arbitrary TM. After merging the
// new TMs into UserSettings.exerciseMaxEstimates we regenerate current+future
// WeeklyPlans so `loadAbs` reflects the climbed Training Max.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { proposalsForPhase } from "@/lib/coach-engine/strength-coach/block-transition";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";

const Schema = z.object({
  phaseId: z.string().min(1).max(64),
  acceptedExercises: z.array(z.string().min(1).max(80)).max(40),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const userId = await getCurrentUserId();
  const { phaseId, acceptedExercises } = parsed.data;

  // Re-compute proposals server-side; trust only the server's kg values.
  const proposals = await proposalsForPhase(userId, phaseId);
  const accepted = new Set(acceptedExercises);
  const toApply = proposals.filter(
    (p) => p.actionable && accepted.has(p.exerciseName),
  );

  if (toApply.length === 0) {
    return NextResponse.json({ status: "ok", applied: [], regenerated: 0 });
  }

  // Merge into the stored TMs.
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { exerciseMaxEstimates: true },
  });
  const estimates: Record<string, number> = {
    ...((settings?.exerciseMaxEstimates as Record<string, number> | null) ?? {}),
  };
  for (const p of toApply) estimates[p.exerciseName] = p.proposedTm;

  await db.userSettings.upsert({
    where: { userId },
    update: {
      exerciseMaxEstimates: estimates,
      exerciseMaxSource: "block_review",
      exerciseMaxUpdatedAt: new Date(),
    },
    create: {
      userId,
      exerciseMaxEstimates: estimates,
      exerciseMaxSource: "block_review",
      exerciseMaxUpdatedAt: new Date(),
    },
  });

  // Regenerate current + future plans so loadAbs reflects the new TMs.
  const result = await regeneratePlansFromNow(userId);

  return NextResponse.json({
    status: "ok",
    applied: toApply.map((p) => ({
      exerciseName: p.exerciseName,
      proposedTm: p.proposedTm,
      deltaKg: p.deltaKg,
      reason: p.reason,
    })),
    regenerated: result.regenerated,
  });
}
