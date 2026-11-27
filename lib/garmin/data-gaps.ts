// Sprint 3.4 (#28) — "is the watch delivering anything?"
//
// A GarminSyncLog SUCCESS/PARTIAL only says the server reached Garmin. When the
// watch is not worn, every nightly sync is PARTIAL with nothing in it, the
// failure streak never starts, and nothing tells the athlete. The signal that
// actually means "watch data arrived" is a resting HR or a sleep score on the
// day's DailySensorData row. Pure — shared by the export and the cron warning.

/** Sprint 3.4 (C5): this many days in a row without watch data raise a warning. */
export const MISSING_DATA_ALERT_DAYS = 3;

export function hasWatchData(garmin: unknown): boolean {
  const g = (garmin ?? null) as { rhr?: number | null; sleepScore?: number | null } | null;
  return g?.rhr != null || g?.sleepScore != null;
}

function key(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Days among the `days` days up to and including `yesterday` that carry no
 * watch data (ascending), plus the run of such days ending yesterday.
 */
export function watchDataGaps(
  rows: readonly { date: Date; garmin: unknown }[],
  yesterday: Date,
  days: number,
): { missing: string[]; streak: number } {
  const withData = new Set(rows.filter((r) => hasWatchData(r.garmin)).map((r) => key(r.date)));
  const missing: string[] = [];
  let streak = 0;
  let streakOpen = true;
  for (let i = 0; i < days; i++) {
    const k = key(new Date(yesterday.getTime() - i * 86400000));
    const gap = !withData.has(k);
    if (gap) missing.push(k);
    if (streakOpen && gap) streak++;
    else streakOpen = false;
  }
  return { missing: missing.reverse(), streak };
}
