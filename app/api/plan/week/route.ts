// GET /api/plan/week?weeksAhead=0
// Returns the week's planned sessions for the current user.
// `weeksAhead`: 0 = current week, 1 = next week, etc.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const weeksAhead = Number.parseInt(url.searchParams.get("weeksAhead") ?? "0", 10);
  const refDate = new Date(userToday().getTime() + weeksAhead * 7 * 86400000);

  const macrocycle = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!macrocycle) {
    return NextResponse.json({ status: "NO_ACTIVE_PLAN" });
  }

  const weekPlan = await db.weeklyPlan.findFirst({
    where: {
      phase: { macrocycleId: macrocycle.id },
      startDate: { lte: refDate },
      endDate: { gt: refDate },
    },
    include: { phase: true },
    orderBy: { startDate: "desc" },
  });

  if (!weekPlan) {
    return NextResponse.json({ status: "NO_WEEK_PLAN" });
  }

  return NextResponse.json({
    status: "ok",
    week: {
      weekNumber: weekPlan.weekNumber,
      startDate: weekPlan.startDate.toISOString(),
      endDate: weekPlan.endDate.toISOString(),
      phaseName: weekPlan.phase.name,
      blockNumber: weekPlan.phase.blockNumber,
      sessions: weekPlan.plannedSessions,
    },
  });
}
