// GET /api/workouts?days=7
// Recent workouts (newest first), used by Today dashboard for status pills + history.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get("days") ?? "7", 10), 1), 90);

  const cutoff = dayKey(new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  const workouts = await db.workout.findMany({
    where: { userId, date: { gte: cutoff } },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      type: true,
      status: true,
      rpe: true,
      durationActualMin: true,
      modulationApplied: true,
      modulations: true,
    },
  });

  return NextResponse.json({ workouts });
}
