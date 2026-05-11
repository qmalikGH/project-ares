"use client";

import { useEffect } from "react";

const LAST_SENT_KEY = "userTz:lastSent";

// Writes a `userTz` cookie with the browser's IANA timezone so server
// route handlers can serve "today" relative to the user's actual location
// (e.g. while traveling). Re-runs on every mount; cheap and idempotent.
//
// Also persists the timezone to UserSettings via PATCH /api/settings/timezone
// (crons have no request context so they can't read the cookie — they read
// from DB instead). Throttled by localStorage so we only PATCH on first mount
// or after a real timezone change.
export function TimezoneCookieSetter() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;

    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `userTz=${encodeURIComponent(tz)}; path=/; max-age=${oneYear}; SameSite=Lax`;

    let lastSent: string | null = null;
    try {
      lastSent = localStorage.getItem(LAST_SENT_KEY);
    } catch {
      // localStorage may be unavailable in strict-cookie contexts; just PATCH
      // unconditionally — the endpoint upsert is idempotent.
    }

    if (lastSent === tz) return;

    fetch("/api/settings/timezone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    })
      .then((r) => {
        if (r.ok) {
          try {
            localStorage.setItem(LAST_SENT_KEY, tz);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Network/server failure — silently retry next mount.
      });
  }, []);
  return null;
}
