// GET  /api/goals/annual → active AnnualGoal for current user
// POST /api/goals/annual → create or update AnnualGoal
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

const AnnualGoalBodySchema = z.object({
  visionId: z.string(),
  targets: z.record(z.string(), z.union([z.string(), z.number()])),
  startDate: z.string().datetime(),
  targetDate: z.string().datetime(),
  notes: z.string().optional(),
});

export async function GET() {
  const userId = await getCurrentUserId();

  const annualGoal = await db.annualGoal.findFirst({
    where: { userId, status: "active" },
    include: {
      macrocycles: { where: { status: "active" }, orderBy: { startDate: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!annualGoal) {
    return NextResponse.json({ status: "ok", annualGoal: null });
  }

  return NextResponse.json({ status: "ok", annualGoal });
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  const body = await req.json();
  const parsed = AnnualGoalBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { visionId, targets, startDate, targetDate, notes } = parsed.data;
  const targetsJson = targets as Record<string, string | number>;

  // Verify vision belongs to user
  const vision = await db.vision.findFirst({
    where: { id: visionId, userId },
  });
  if (!vision) {
    return NextResponse.json({ error: "Vision not found" }, { status: 404 });
  }

  // Upsert: update existing or create new
  const existing = await db.annualGoal.findFirst({
    where: { userId, status: "active" },
  });

  if (existing) {
    const updated = await db.annualGoal.update({
      where: { id: existing.id },
      data: {
        visionId,
        targets: targetsJson,
        startDate: new Date(startDate),
        targetDate: new Date(targetDate),
        notes,
      },
    });
    return NextResponse.json({ status: "ok", annualGoal: updated });
  }

  const annualGoal = await db.annualGoal.create({
    data: {
      userId,
      visionId,
      targets: targetsJson,
      startDate: new Date(startDate),
      targetDate: new Date(targetDate),
      notes,
    },
  });

  return NextResponse.json({ status: "ok", annualGoal }, { status: 201 });
}
