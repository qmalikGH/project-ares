// GET /api/garmin/pushable-workouts
//
// Lists planned sessions in the NEXT 7 DAYS, derived from
// `WeeklyPlan.plannedSessions` (the source-of-truth — Workout rows are only
// created at `/api/sessions/start`/`complete` time, so the read path can't
// rely on them existing yet).
//
// For each session we also look up an existing Workout row by (userId, date,
// type). If one exists we return its id + Garmin sync status; otherwise we
// return null and the push endpoint will materialise the row on demand.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { dayKey } from "@/lib/db/queries/sensors";
import { isPushableSessionType } from "@/lib/garmin/workout-builder";

interface PlannedSessionRaw {
  date?: string | Date;
  type?: string;
  durationMin?: number;
  hrTarget?: { from: number; to: number };
}

export async function GET() {
  const userId = await getCurrentUserId();
  const today0 = dayKey(new Date());
  const sevenDaysOut = new Date(today0.getTime() + 7 * 86400000);

  // 1. Find every weekly plan that overlaps the [today, today+7) window.
  const weeklyPlans = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId } },
      // overlap: plan.endDate > today AND plan.startDate < sevenDaysOut
      AND: [
        { endDate: { gt: today0 } },
        { startDate: { lt: sevenDaysOut } },
      ],
    },
    orderBy: { startDate: "asc" },
    select: { id: true, plannedSessions: true },
  });

  // 2. Flatten + filter every session into the 7-day window.
  interface FlatSession {
    date: Date;
    type: string;
    durationMin: number | null;
    hrTarget: { from: number; to: number } | null;
  }
  const flatSessions: FlatSession[] = [];
  for (const wp of weeklyPlans) {
    if (!Array.isArray(wp.plannedSessions)) continue;
    for (const raw of wp.plannedSessions as unknown as PlannedSessionRaw[]) {
      if (!raw || typeof raw !== "object") continue;
      if (!raw.type) continue;
      const sDate = raw.date instanceof Date ? raw.date : raw.date ? new Date(raw.date) : null;
      if (!sDate || Number.isNaN(sDate.getTime())) continue;
      const sDay = dayKey(sDate);
      if (sDay.getTime() < today0.getTime() || sDay.getTime() >= sevenDaysOut.getTime()) continue;
      flatSessions.push({
        date: sDay,
        type: raw.type,
        durationMin: typeof raw.durationMin === "number" ? raw.durationMin : null,
        hrTarget: raw.hrTarget ?? null,
      });
    }
  }

  // 3. Correlate with any existing Workout rows for those (date, type) pairs.
  const existingRows = await db.workout.findMany({
    where: {
      userId,
      date: { gte: today0, lt: sevenDaysOut },
    },
    select: {
      id: true,
      type: true,
      date: true,
      garminPushStatus: true,
      garminWorkoutId: true,
    },
  });
  const rowKey = (date: Date, type: string) =>
    `${dayKey(date).toISOString().slice(0, 10)}|${type}`;
  const rowByKey = new Map<string, (typeof existingRows)[number]>();
  for (const r of existingRows) {
    rowByKey.set(rowKey(r.date, r.type), r);
  }

  // 4. Build response items, sorted by date.
  const items = flatSessions
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((s) => {
      const isoDate = s.date.toISOString().slice(0, 10);
      const existing = rowByKey.get(rowKey(s.date, s.type));
      const pushable = isPushableSessionType(s.type) && !!s.hrTarget;
      const reasonNotPushable = !isPushableSessionType(s.type)
        ? ("non_pushable_session" as const)
        : !s.hrTarget
          ? ("missing_hr_target" as const)
          : null;
      return {
        date: isoDate,
        type: s.type,
        durationMin: s.durationMin,
        pushable,
        reasonNotPushable,
        existingWorkoutId: existing?.id ?? null,
        currentStatus: existing?.garminPushStatus ?? null,
      };
    });

  return NextResponse.json({
    status: "ok",
    items,
    pushable: items.filter((i) => i.pushable).length,
    skipped: items.filter((i) => !i.pushable).length,
  });
}

