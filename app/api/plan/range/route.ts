// GET /api/plan/range?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Returns ALL planned sessions in the active macrocycle whose date falls in
// [start, end). Used by the v0.11 PlanCalendar to render a month view.
// Sessions are flattened across overlapping WeeklyPlans and grouped by date.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { SessionPlan } from "@/lib/coach-engine/types";

const Schema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

interface PlannedSessionRaw {
  date?: string | Date;
  type?: string;
}

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const parsed = Schema.safeParse({
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid range", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const start = new Date(`${parsed.data.start}T00:00:00.000Z`);
  const end = new Date(`${parsed.data.end}T00:00:00.000Z`);
  if (end.getTime() <= start.getTime()) {
    return NextResponse.json({ error: "end must be after start" }, { status: 400 });
  }

  // Pull every WeeklyPlan whose [startDate, endDate) overlaps the range. Filter
  // by active macrocycle (re-onboarding leaves abandoned macros around — see
  // v0.10.4 fix for getCurrentPhaseRow).
  const weeklyPlans = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      startDate: { lt: end },
      endDate: { gt: start },
    },
    include: { phase: true },
    orderBy: { startDate: "asc" },
  });

  // Group sessions by their date (UTC midnight key, YYYY-MM-DD string).
  const byDate = new Map<string, SessionPlan[]>();
  for (const wp of weeklyPlans) {
    if (!Array.isArray(wp.plannedSessions)) continue;
    for (const raw of wp.plannedSessions as unknown as PlannedSessionRaw[]) {
      if (!raw || typeof raw !== "object" || !raw.date) continue;
      const sessionDate =
        raw.date instanceof Date ? raw.date : new Date(raw.date);
      if (Number.isNaN(sessionDate.getTime())) continue;
      if (sessionDate < start || sessionDate >= end) continue;
      const key = sessionDate.toISOString().slice(0, 10);
      const list = byDate.get(key) ?? [];
      list.push({
        ...(raw as unknown as SessionPlan),
        date: sessionDate,
      });
      byDate.set(key, list);
    }
  }

  const days = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sessions]) => ({ date, sessions }));

  // Block context for the visible window (use the FIRST overlapping plan).
  const blockInfo = weeklyPlans[0]
    ? {
        blockNumber: weeklyPlans[0].phase.blockNumber,
        phaseName: weeklyPlans[0].phase.name,
        weekNumber: weeklyPlans[0].weekNumber,
      }
    : null;

  return NextResponse.json({ status: "ok", days, blockInfo });
}
