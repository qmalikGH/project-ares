// POST /api/sensors/morning-input
// Stores user's morning self-assessment. Triggers re-computation on next /sessions/today call.
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";

const Schema = z.object({
  date: z.string().optional(), // ISO; defaults to today
  subjectiveRecovery: z.number().int().min(1).max(10),
  morningStiffness: z.number().int().min(1).max(10),
  stairsScore: z.number().int().min(1).max(10),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  const date = dayKey(parsed.data.date ? new Date(parsed.data.date) : new Date());

  const userMorning = {
    subjectiveRecovery: parsed.data.subjectiveRecovery,
    morningStiffness: parsed.data.morningStiffness,
    stairsScore: parsed.data.stairsScore,
  };

  // Upsert by (userId, date). Schema only has unique on date alone; use findFirst+update.
  const existing = await db.dailySensorData.findFirst({ where: { userId, date } });
  const row = existing
    ? await db.dailySensorData.update({
        where: { id: existing.id },
        data: { userMorning, updatedAt: new Date() },
      })
    : await db.dailySensorData.create({
        data: { userId, date, userMorning },
      });

  return NextResponse.json({ status: "ok", id: row.id });
}

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dayKey(dateParam ? new Date(dateParam) : new Date());
  const row = await db.dailySensorData.findFirst({ where: { userId, date } });
  return NextResponse.json({ data: row });
}
