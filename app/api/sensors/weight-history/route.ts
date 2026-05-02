// GET /api/sensors/weight-history?days=90
// Returns body weight entries with computed 7-day rolling average.
// Sprint v0.15: Weight trend data for the progress dashboard chart.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 90));

  const since = new Date(Date.now() - days * 86400000);

  const rows = await db.dailySensorData.findMany({
    where: {
      userId,
      bodyWeightKg: { not: null },
      date: { gte: since },
    },
    orderBy: { date: "asc" },
    select: { date: true, bodyWeightKg: true },
  });

  // Compute rolling 7-day average for each data point
  const entries = rows.map((row, idx) => {
    // Look back up to 7 entries (not 7 days — entries may be sparse)
    const windowStart = Math.max(0, idx - 6);
    const window = rows.slice(windowStart, idx + 1);
    const avg = window.reduce((sum, w) => sum + w.bodyWeightKg!, 0) / window.length;

    return {
      date: row.date.toISOString().slice(0, 10),
      weightKg: row.bodyWeightKg!,
      avg7d: Math.round(avg * 10) / 10,
    };
  });

  // Also return settings for target line + current avg
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { currentWeightKg: true, targetWeightKg: true },
  });

  // Weekly rate (last 14d vs now) — for the "Rate" display
  let weeklyRateKg: number | null = null;
  let weeklyRatePct: number | null = null;
  if (entries.length >= 2) {
    const latest = entries[entries.length - 1];
    // Find entry closest to 14 days ago
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const earlier = entries.filter((e) => e.date <= cutoff);
    if (earlier.length > 0) {
      const ref = earlier[earlier.length - 1];
      const daysBetween = Math.max(1, (new Date(latest.date).getTime() - new Date(ref.date).getTime()) / 86400000);
      const weeksBetween = daysBetween / 7;
      weeklyRateKg = Math.round(((ref.avg7d - latest.avg7d) / weeksBetween) * 10) / 10;
      weeklyRatePct = Math.round(((ref.avg7d - latest.avg7d) / weeksBetween / ref.avg7d * 100) * 10) / 10;
    }
  }

  return NextResponse.json({
    entries,
    currentWeightKg: settings?.currentWeightKg ?? null,
    targetWeightKg: settings?.targetWeightKg ?? null,
    weeklyRateKg,
    weeklyRatePct,
  });
}
