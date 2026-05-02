// GET  /api/goals/vision → active Vision for current user
// POST /api/goals/vision → create or update Vision
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

const VisionBodySchema = z.object({
  targets: z.record(z.string(), z.union([z.string(), z.number()])),
  timeHorizon: z.string().optional().default("3-5 years"),
  notes: z.string().optional(),
});

export async function GET() {
  const userId = await getCurrentUserId();

  const vision = await db.vision.findFirst({
    where: { userId, status: "active" },
    include: { annualGoals: { where: { status: "active" } } },
    orderBy: { createdAt: "desc" },
  });

  if (!vision) {
    return NextResponse.json({ status: "ok", vision: null });
  }

  return NextResponse.json({ status: "ok", vision });
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  const body = await req.json();
  const parsed = VisionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { targets, timeHorizon, notes } = parsed.data;
  const targetsJson = targets as Record<string, string | number>;

  // Upsert: archive existing active, create new
  const existing = await db.vision.findFirst({
    where: { userId, status: "active" },
  });

  if (existing) {
    // Update existing
    const updated = await db.vision.update({
      where: { id: existing.id },
      data: { targets: targetsJson, timeHorizon, notes },
    });
    return NextResponse.json({ status: "ok", vision: updated });
  }

  // Create new
  const vision = await db.vision.create({
    data: { userId, targets: targetsJson, timeHorizon, notes },
  });

  return NextResponse.json({ status: "ok", vision }, { status: 201 });
}
