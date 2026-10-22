// Sprint 3.3 (C1) — recompute a stored readiness when Garmin data arrives late.
//
// /today computes readiness live and caches it on the day's sensor row. The day
// view, the coaching export and the block review read that cached value. When
// the watch syncs later the same day (or a gap sweep fills the day in), the row
// gets its HRV and sleep, but the cached readiness kept the half-morning
// version — a RED band without a score was exactly such a row.
//
// Called by the single Garmin writer (lib/garmin/persist.ts) after every write.
// Only rows with a morning input carry a readiness at all.
import { db } from "@/lib/db/client";
import { computeBaselines, computeReadiness } from "@/lib/coach-engine/readiness";
import { dayKey, rowsToSensorInputs } from "@/lib/db/queries/sensors";
import type { DailySensorInputs, UserMorningInputs } from "@/lib/coach-engine/types";

const BASELINE_WINDOW_DAYS = 30;

export async function refreshStoredReadiness(userId: string, date: Date): Promise<boolean> {
  const day = dayKey(date);
  const row = await db.dailySensorData.findFirst({ where: { userId, date: day } });
  if (!row?.userMorning) return false;

  const recent = await db.dailySensorData.findMany({
    where: { userId, date: { gte: new Date(day.getTime() - BASELINE_WINDOW_DAYS * 86400000), lte: day } },
    orderBy: { date: "asc" },
  });
  const readiness = computeReadiness(
    {
      date: day,
      garmin: (row.garmin as unknown as DailySensorInputs["garmin"]) ?? undefined,
      userMorning: row.userMorning as unknown as UserMorningInputs,
    },
    computeBaselines(rowsToSensorInputs(recent)),
  );

  await db.dailySensorData.update({
    where: { id: row.id },
    data: {
      readinessScore: readiness.score,
      readinessBand: readiness.band,
      readinessComponents: readiness.components,
      computedAt: new Date(),
    },
  });
  return true;
}
