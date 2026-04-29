// Timezone-aware date utilities for Project Ares.
//
// The system stores all dates as UTC midnight timestamps. But "today" must be
// determined relative to the USER's timezone (Europe/Berlin for Q), not UTC.
// Berlin is UTC+1 (CET) or UTC+2 (CEST). Between 22:00–23:59 UTC the UTC
// calendar date is one day behind Berlin — causing the engine to serve
// yesterday's session or match tomorrow's session to today.
//
// These helpers ensure "today" always means the Berlin calendar date.

const USER_TZ = process.env.USER_TIMEZONE ?? "Europe/Berlin";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: USER_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The current calendar date in the user's timezone, returned as a UTC midnight
 * Date. Use this everywhere the system needs "today" — it replaces the
 * `dayKey(new Date())` pattern which silently uses the UTC date.
 *
 * Example: at 00:30 Berlin (22:30 UTC on April 28), this returns
 * `2026-04-29T00:00:00.000Z` — the Berlin date, not the UTC date.
 */
export function userToday(): Date {
  const dateStr = dateFormatter.format(new Date());
  return new Date(dateStr + "T00:00:00.000Z");
}

/**
 * Convert any Date to a YYYY-MM-DD string in the user's timezone.
 * Use for Garmin's schedule endpoint which expects the user's local date.
 */
export function toUserDateString(date: Date): string {
  return dateFormatter.format(date);
}

/**
 * "Tomorrow" in the user's timezone, returned as UTC midnight.
 * Replaces the fragile `new Date(); d.setDate(d.getDate()+1)` pattern
 * which uses local-server timezone arithmetic.
 */
export function userTomorrow(): Date {
  const today = userToday();
  return new Date(today.getTime() + 86400000);
}
