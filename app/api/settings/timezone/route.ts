// PATCH /api/settings/timezone
//
// Persists the user's IANA timezone (e.g. "America/New_York") to UserSettings.
// Called by TimezoneCookieSetter on layout mount whenever the detected zone
// changes — gives crons (which have no request context) a way to read the
// user's actual location instead of falling back to USER_TIMEZONE env.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

const Schema = z.object({
  timezone: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z_+\-]*\/[A-Za-z][A-Za-z_+\-/]*$/, "invalid IANA shape"),
});

function isRealIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await getCurrentUserId();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { timezone } = parsed.data;
  if (!isRealIanaZone(timezone)) {
    return NextResponse.json(
      { error: "unknown IANA timezone" },
      { status: 400 },
    );
  }

  await db.userSettings.upsert({
    where: { userId },
    update: { timezone },
    create: { userId, timezone },
  });

  return NextResponse.json({ status: "ok", timezone });
}
