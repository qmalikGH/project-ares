// Sprint 3.4 (#28), Phase A2 — gap sweep for daily wellness/energy rows.
//
// Moved out of the cron route (route files may only export handlers) and
// widened from 3 to 14 days. Bounded so that a fortnight without the watch —
// every day incomplete, every night — cannot eat the cron's time budget.
import { db } from "@/lib/db/client";
import { syncGarminForDate } from "./sync";
import { persistGarminSync } from "./persist";
import type { Deadline } from "./timeout";

/** How far back the gap sweep looks (was 3). */
export const GAP_SWEEP_DAYS = 14;
/**
 * A sweep day costs a full syncGarminForDate (~7 Garmin calls). Without the
 * watch on the wrist every day in the window is incomplete, every night; this
 * cap plus the retry guard spreads the window over a few nights.
 */
export const MAX_SWEEP_DAYS_PER_RUN = 5;
/**
 * A day already attempted within this window is not retried this run — a
 * guard against a second run on the same day. It is NOT what spreads the
 * window: with a nightly cron the guard has always expired by the next run.
 * The order does that (see sweepRecentGaps).
 */
export const SWEEP_RETRY_AFTER_MS = 20 * 3600 * 1000;
/** Below this much time left, the sweep stops starting new days. */
const SWEEP_RESERVE_MS = 12_000;

export type SensorRow = {
  date: Date;
  garmin: unknown;
  totalKilocalories: number | null;
  bmrKilocalories: number | null;
};

/**
 * Sprint 3.4 (#28): a day counts as incomplete when any wellness value or the
 * day totals are missing — not only rhr/sleep/total kcal as before.
 */
export function isIncompleteDay(row: SensorRow | undefined): boolean {
  if (!row) return true;
  const g = (row.garmin ?? null) as {
    rhr?: number | null;
    sleepScore?: number | null;
    hrvRmssd?: number | null;
    bodyBatteryMorning?: number | null;
  } | null;
  return (
    g?.rhr == null ||
    g?.sleepScore == null ||
    g?.hrvRmssd == null ||
    g?.bodyBatteryMorning == null ||
    row.totalKilocalories == null ||
    row.bmrKilocalories == null
  );
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Re-sync recent incomplete days, the ones tried longest ago first: never
 * tried before anything else, then by the last attempt (GarminSyncLog
 * .createdAt for that targetDate), the newer day on a tie. A day attempted
 * within SWEEP_RETRY_AFTER_MS is skipped, at most MAX_SWEEP_DAYS_PER_RUN days
 * run per invocation, and the sweep stops when the budget runs low.
 *
 * Review fix (#28): "newest first" plus a 20-h guard tried the same five days
 * every night while they stayed incomplete (no watch), and D-7 … D-14 never.
 * Ordering by the last attempt rotates through the whole window.
 *
 * Replaces a guard that could never fire (it checked the newest log row, which
 * the primary sync had just written) and a `catch { break }` that dropped the
 * error.
 */
export async function sweepRecentGaps(
  userId: string,
  primaryDate: Date,
  deadline: Deadline,
  now: Date = new Date(),
): Promise<{ repaired: string[]; attempted: string[]; deferred: number; errors: string[] }> {
  const out = { repaired: [] as string[], attempted: [] as string[], deferred: 0, errors: [] as string[] };

  const days = Array.from(
    { length: GAP_SWEEP_DAYS },
    (_, i) => new Date(primaryDate.getTime() - (i + 1) * 86400000),
  );
  const from = days[days.length - 1];
  const to = days[0];

  const [rows, logs] = await Promise.all([
    db.dailySensorData.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { date: true, garmin: true, totalKilocalories: true, bmrKilocalories: true },
    }),
    // Every attempt on these days, not just the recent ones: the order needs
    // the last attempt per day.
    db.garminSyncLog.findMany({
      where: { userId, targetDate: { gte: from, lte: to } },
      select: { targetDate: true, createdAt: true },
    }),
  ]);
  const rowByDay = new Map(rows.map((r) => [dayKey(r.date), r]));
  const lastTried = new Map<string, number>();
  for (const l of logs) {
    if (!l.targetDate) continue;
    const k = dayKey(l.targetDate);
    lastTried.set(k, Math.max(lastTried.get(k) ?? 0, l.createdAt.getTime()));
  }
  const guardSince = now.getTime() - SWEEP_RETRY_AFTER_MS;

  const candidates = orderSweepCandidates(
    days.filter((d) => isIncompleteDay(rowByDay.get(dayKey(d)))),
    lastTried,
  ).filter((d) => (lastTried.get(dayKey(d)) ?? 0) < guardSince);

  for (let i = 0; i < candidates.length; i++) {
    const day = candidates[i];
    if (out.attempted.length >= MAX_SWEEP_DAYS_PER_RUN || deadline.isNear(SWEEP_RESERVE_MS)) {
      out.deferred = candidates.length - i;
      break;
    }
    out.attempted.push(dayKey(day));
    try {
      const res = await syncGarminForDate(day, { deadline });
      // Sprint 3.4: a failed sweep day is logged like any other attempt
      // (it used to `break` before persisting, leaving no trace).
      const persisted = await persistGarminSync({ userId, date: day, result: res });
      if (res.status === "FAILURE") {
        out.errors.push(
          `${dayKey(day)}: ${res.errors.map((e) => `${e.datatype}: ${e.message}`).join(" | ") || "FAILURE"}`,
        );
        out.deferred = candidates.length - i - 1;
        break; // connection went bad — stop sweeping
      }
      if (persisted.wrote) out.repaired.push(dayKey(day));
    } catch (e) {
      out.errors.push(`${dayKey(day)}: ${e instanceof Error ? e.message : String(e)}`);
      out.deferred = candidates.length - i - 1;
      break;
    }
  }
  return out;
}

/**
 * Never-tried days first, then the oldest last attempt; on a tie the newer
 * day. Pure.
 */
export function orderSweepCandidates(days: readonly Date[], lastTried: ReadonlyMap<string, number>): Date[] {
  return [...days].sort((a, b) => {
    const ta = lastTried.get(dayKey(a));
    const tb = lastTried.get(dayKey(b));
    if (ta === undefined && tb !== undefined) return -1;
    if (tb === undefined && ta !== undefined) return 1;
    if (ta !== undefined && tb !== undefined && ta !== tb) return ta - tb;
    return b.getTime() - a.getTime();
  });
}
