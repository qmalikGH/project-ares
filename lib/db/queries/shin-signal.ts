// Sprint 3.4 (#28, C3) — the shin as a weekly signal.
//
// The rule from Sprint 2.4 stays: no data is not "healthy". What changes is
// where a signal may come from. Until now only the rating of a session in
// /confirm counted; Q rarely opens /confirm, so the gate sat on "hold". Now
// any of three sources counts, and one per week is enough:
//
//   - the rating of a session in /confirm (executedSession.shinPainNrs)
//   - the one-tap card on /today ("Schienbein diese Woche")
//   - the coaching action reportShinStatus (what Q told the coach in the chat)
//
// The gate reads the HIGHEST value of the last 14 days, not the latest — Q's
// decision (27.11.), against the brief's "jüngste Meldung": with bone stress a
// later 0 must not cancel an earlier pain report. Sessions completed by the
// auto-import carry no shin value and still count as no report.
import { db } from "@/lib/db/client";

/** Was 10 days in both readers. */
export const SHIN_SIGNAL_WINDOW_DAYS = 14;

export type ShinReportSource = "today_card" | "coach";

/**
 * The /today card's buckets → the stored value. The upper end of each bucket,
 * so a report never reads milder than the athlete meant: 1–2 → 2, 4+ → 4
 * (≥ 4 is already "regress" in deriveVolumeGate).
 */
export const SHIN_CARD_BUCKETS = { "0": 0, "1-2": 2, "3": 3, "4+": 4 } as const;
export type ShinCardBucket = keyof typeof SHIN_CARD_BUCKETS;

/** Pure: the worst value and how many reports there were. */
export function combineShinValues(values: readonly number[]): { worst: number | null; count: number } {
  let worst: number | null = null;
  for (const v of values) worst = worst === null ? v : Math.max(worst, v);
  return { worst, count: values.length };
}

/** painNrs of the reports (card + coach) with `from ≤ date ≤ to`. */
export async function loadShinReportValues(userId: string, from: Date, to: Date): Promise<number[]> {
  const rows = await db.shinReport.findMany({
    where: { userId, date: { gte: from, lte: to } },
    select: { painNrs: true },
  });
  return rows.map((r) => r.painNrs);
}

/** One report per day and source; a second one the same day replaces it. */
export async function upsertShinReport(
  userId: string,
  date: Date,
  painNrs: number,
  source: ShinReportSource,
): Promise<void> {
  await db.shinReport.upsert({
    where: { userId_date_source: { userId, date, source } },
    create: { userId, date, painNrs, source },
    update: { painNrs },
  });
}

/**
 * The most recent day with any shin signal (rated session or report), for the
 * /today card: it shows when there was none in the last 7 days.
 */
export async function lastShinSignalDate(userId: string, since: Date): Promise<Date | null> {
  const [report, sessions] = await Promise.all([
    db.shinReport.findFirst({
      where: { userId, date: { gte: since } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    db.workout.findMany({
      where: { userId, status: "completed", date: { gte: since } },
      orderBy: { date: "desc" },
      select: { date: true, executedSession: true },
    }),
  ]);
  const rated = sessions.find(
    (w) => typeof (w.executedSession as { shinPainNrs?: unknown } | null)?.shinPainNrs === "number",
  );
  const candidates = [report?.date, rated?.date].filter((d): d is Date => d instanceof Date);
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}
