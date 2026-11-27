// /api/shin-report — Sprint 3.4 (#28, C3)
//
// GET  → whether the /today card should show (no shin signal in 7 days).
// POST → { bucket: "0" | "1-2" | "3" | "4+" } — one tap, stored for today as
//        a ShinReport (source "today_card"), then the next two weeks are
//        regenerated so the gate decision shows at once.
//
// One signal a week is enough; the gate reads the highest value of 14 days
// (lib/db/queries/shin-signal.ts).
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { userTodayDynamic } from "@/lib/date";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import {
  lastShinSignalDate,
  SHIN_CARD_BUCKETS,
  upsertShinReport,
  type ShinCardBucket,
} from "@/lib/db/queries/shin-signal";

/** The card shows when the last signal is older than this. */
const CARD_INTERVAL_DAYS = 7;

const BodySchema = z.object({
  bucket: z.enum(Object.keys(SHIN_CARD_BUCKETS) as [ShinCardBucket, ...ShinCardBucket[]]),
});

export async function GET() {
  const userId = await getCurrentUserId();
  const today = await userTodayDynamic();
  const since = new Date(today.getTime() - (CARD_INTERVAL_DAYS - 1) * 86400000);
  const last = await lastShinSignalDate(userId, since);
  return NextResponse.json({
    needed: last == null,
    lastSignal: last ? last.toISOString().slice(0, 10) : null,
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const userId = await getCurrentUserId();
  const today = await userTodayDynamic();
  await upsertShinReport(userId, today, SHIN_CARD_BUCKETS[parsed.data.bucket], "today_card");

  let regenerate: Record<string, unknown>;
  try {
    const r = await regeneratePlansFromNow(userId, { horizonWeeks: 2 });
    regenerate = { gate: r.gate, gateReason: r.gateReason };
  } catch (e) {
    regenerate = { error: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json({ status: "ok", regenerate });
}
