// POST /api/debug/cleanup-orphaned-workouts
//
// One-shot cleanup for the timezone-drift-induced duplicate Workout rows.
// When the plan was stored with one TZ and the completion landed under
// another (e.g. user travels mid-week), two rows can survive for the same
// logical session: a stale `planned` row with no Garmin/executed payload,
// plus the actual `completed` row.
//
// For every `completed` row in the active macrocycle, this endpoint finds
// sibling `planned` rows of the same `(userId, type)` within ±1 day, where
// the sibling has neither garminActivityId nor executedSession, and deletes
// them. Idempotent: re-running on a clean DB is a no-op.
//
// Auth: matches /api/debug/regenerate-from-now — Authorization: Bearer
// $CRON_SECRET (+ optional userId in body) OR fall through to session auth.
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db/client";
import { resolveRouteUserId } from "@/lib/auth/route-user";

export async function POST(req: NextRequest) {
  // Sprint 2.5: shared resolver; `userId` in the body only counts on the
  // bearer path.
  let bodyUserId: unknown;
  try {
    bodyUserId = ((await req.json()) as { userId?: unknown }).userId;
  } catch {
    // empty / non-JSON body is fine
  }
  const userId = await resolveRouteUserId(req, bodyUserId);

  const completed = await db.workout.findMany({
    where: { userId, status: "completed" },
    select: { id: true, type: true, date: true },
  });

  const deletedSamples: Array<{ id: string; type: string; date: string }> = [];
  let deleted = 0;

  for (const c of completed) {
    const windowStart = new Date(c.date.getTime() - 86400000);
    const windowEnd = new Date(c.date.getTime() + 2 * 86400000);

    const orphans = await db.workout.findMany({
      where: {
        userId,
        type: c.type,
        status: "planned",
        date: { gte: windowStart, lt: windowEnd },
        garminActivityId: null,
        executedSession: { equals: Prisma.AnyNull },
        id: { not: c.id },
      },
      select: { id: true, date: true, type: true },
    });

    if (orphans.length === 0) continue;

    const ids = orphans.map((o) => o.id);
    const result = await db.workout.deleteMany({ where: { id: { in: ids } } });
    deleted += result.count;
    for (const o of orphans.slice(0, 5)) {
      deletedSamples.push({
        id: o.id,
        type: o.type,
        date: o.date.toISOString().slice(0, 10),
      });
    }
  }

  return NextResponse.json({
    status: "ok",
    deleted,
    completedConsidered: completed.length,
    sample: deletedSamples.slice(0, 20),
  });
}
