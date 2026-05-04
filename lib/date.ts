// Timezone-aware date utilities for Project Ares.
//
// The system stores all dates as UTC midnight timestamps. But "today" must be
// determined relative to the USER's timezone (Europe/Berlin for Q), not UTC.
// Berlin is UTC+1 (CET) or UTC+2 (CEST). Between 22:00–23:59 UTC the UTC
// calendar date is one day behind Berlin — causing the engine to serve
// yesterday's session or match tomorrow's session to today.
//
// Travel mode: while abroad, the user's actual TZ differs from Berlin. The
// client writes a `userTz` cookie on mount; route handlers can call
// `userTodayDynamic()` (async) to honor it, falling back to USER_TIMEZONE env
// var when the cookie is absent (cron/script contexts).

import { cookies } from "next/headers";

const ENV_TZ = process.env.USER_TIMEZONE ?? "Europe/Berlin";
export const USER_TZ_COOKIE = "userTz";

function makeFormatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const envFormatter = makeFormatter(ENV_TZ);

/** UTC midnight for the given timezone's current calendar date. Pure. */
export function userTodayInTz(tz: string): Date {
  const dateStr = makeFormatter(tz).format(new Date());
  return new Date(dateStr + "T00:00:00.000Z");
}

/**
 * Reads the user's timezone from the `userTz` cookie set by the client,
 * validating against IANA-shaped names. Falls back to USER_TIMEZONE env var.
 * Outside a request context (cron, standalone script) the cookies() call
 * throws and we fall back silently.
 */
export async function getUserTimezone(): Promise<string> {
  try {
    const c = await cookies();
    const v = c.get(USER_TZ_COOKIE)?.value;
    if (v && /^[A-Za-z][A-Za-z_+\-]*\/[A-Za-z][A-Za-z_+\-/]*$/.test(v)) {
      return v;
    }
  } catch {
    // No request context — fall through to env.
  }
  return ENV_TZ;
}

/**
 * Async variant of userToday() that honors the user's TZ cookie when present.
 * Use in route handlers / server components that serve the current user.
 * Crons and pure code keep using the sync userToday() (env-based).
 */
export async function userTodayDynamic(): Promise<Date> {
  return userTodayInTz(await getUserTimezone());
}

/**
 * The current calendar date in the user's timezone, returned as a UTC midnight
 * Date. Use this everywhere the system needs "today" — it replaces the
 * `dayKey(new Date())` pattern which silently uses the UTC date.
 *
 * Example: at 00:30 Berlin (22:30 UTC on April 28), this returns
 * `2026-04-29T00:00:00.000Z` — the Berlin date, not the UTC date.
 *
 * Sync — uses USER_TIMEZONE env var. For request handlers that should respect
 * the user's actual TZ when traveling, prefer `userTodayDynamic()`.
 */
export function userToday(): Date {
  const dateStr = envFormatter.format(new Date());
  return new Date(dateStr + "T00:00:00.000Z");
}

/**
 * Convert any Date to a YYYY-MM-DD string in the user's timezone.
 * Use for Garmin's schedule endpoint which expects the user's local date.
 */
export function toUserDateString(date: Date): string {
  return envFormatter.format(date);
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
