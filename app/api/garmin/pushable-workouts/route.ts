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
import { userToday } from "@/lib/date";
import { isPushableSessionType } from "@/lib/garmin/workout-builder";
import { getHrTargetForSession } from "@/lib/coach-engine/run-coach";
import { getOrCreateUserSettings } from "@/lib/db/queries/settings";
import type { SessionType } from "@/lib/coach-engine/types";

interface PlannedSessionRaw {
  date?: string | Date;
  type?: string;
  durationMin?: number;
  hrTarget?: { from: number; to: number };
}

export async function GET() {
  const userId = await getCurrentUserId();
  const today0 = userToday();
  const sevenDaysOut = new Date(today0.getTime() + 7 * 86400000);

  // 1. Find every weekly plan in the [today, today+7) window — but ONLY for
  // the user's currently ACTIVE macrocycle. Re-onboarding sets prior macros
  // to "abandoned"; if we don't filter, sessions from both macros surface
  // and the user sees duplicate rows for every day.
  const weeklyPlans = await db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      AND: [
        { endDate: { gt: today0 } },
        { startDate: { lt: sevenDaysOut } },
      ],
    },
    orderBy: { startDate: "asc" },
    select: { id: true, plannedSessions: true },
  });

  // HR fallback: when an old plannedSession was generated before Sprint v0.7
  // (no hrTarget in the JSON) but the user has hrMax/hrRest in UserSettings,
  // we can derive the HR-zone on the fly via Karvonen. UI then treats those
  // sessions as pushable too.
  const settings = await getOrCreateUserSettings(userId);
  const canDeriveHr =
    typeof settings.hrMax === "number" && typeof settings.hrRest === "number";

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
      const typeOk = isPushableSessionType(s.type);
      // HR-Target may come from the planned JSON OR be derivable on-the-fly
      // from UserSettings. Either path makes the session pushable.
      let derivedHr: { from: number; to: number } | null = null;
      if (!s.hrTarget && typeOk && canDeriveHr) {
        derivedHr = getHrTargetForSession({
          sessionType: s.type as SessionType,
          hrMax: settings.hrMax!,
          hrRest: settings.hrRest!,
        });
      }
      const hasHr = !!s.hrTarget || !!derivedHr;
      const pushable = typeOk && hasHr;
      const reasonNotPushable = !typeOk
        ? ("non_pushable_session" as const)
        : !hasHr
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

