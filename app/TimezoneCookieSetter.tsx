"use client";

import { useEffect } from "react";

// Writes a `userTz` cookie with the browser's IANA timezone so server
// route handlers can serve "today" relative to the user's actual location
// (e.g. while traveling). Re-runs on every mount; cheap and idempotent.
export function TimezoneCookieSetter() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `userTz=${encodeURIComponent(tz)}; path=/; max-age=${oneYear}; SameSite=Lax`;
  }, []);
  return null;
}
