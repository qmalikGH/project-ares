// GET /api/cron/block-review-check
// Daily 06:00 UTC: for each active user, find phases whose `plannedEndDate` was
// yesterday but have no blockReview yet — fire BLOCK_REVIEW_DUE notification.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { dayKey } from "@/lib/db/queries/sensors";
import { createNotificationIfNew } from "@/lib/notifications/create";

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today0 = dayKey(new Date());
  const phases = await db.phase.findMany({
    where: {
      blockReviewId: null,
      plannedEndDate: { lte: today0 },
    },
    include: { macrocycle: true },
  });

  let notified = 0;
  for (const p of phases) {
    await createNotificationIfNew(
      {
        userId: p.macrocycle.userId,
        type: "BLOCK_REVIEW_DUE",
        title: `Block ${p.blockNumber} (${p.name}) abgeschlossen`,
        message: "Coach hat eine Auswertung vorbereitet — schau sie dir an.",
        severity: "INFO",
        actionUrl: `/blocks/${p.id}/review`,
      },
      // 24h dedup so daily cron doesn't repeat.
      24 * 60,
    );
    notified++;
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), notified });
}
