// GET /api/debug/today-sessions
// Diagnostic endpoint — dumps raw date info so we can verify whether session
// dates in the DB are off by one. Remove after the timezone fix is confirmed.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  getCurrentPhaseRow,
  findWeekPlanForDate,
} from "@/lib/db/queries/plans";
import { dayKey } from "@/lib/db/queries/sensors";
import { userToday, toUserDateString } from "@/lib/date";

interface SessionRaw {
  date?: string | Date;
  type?: string;
  durationMin?: number;
}

export async function GET() {
  const userId = await getCurrentUserId();

  const serverNow = new Date();
  const todayUtc = dayKey(serverNow);
  const todayBerlin = userToday();

  const phaseRow = await getCurrentPhaseRow(userId, serverNow);
  if (!phaseRow) {
    return NextResponse.json({
      serverNow: serverNow.toISOString(),
      todayUtc: todayUtc.toISOString(),
      todayBerlin: todayBerlin.toISOString(),
      error: "NO_ACTIVE_PHASE",
    });
  }

  const weekPlan = findWeekPlanForDate(phaseRow.weeklyPlans, serverNow);
  if (!weekPlan) {
    return NextResponse.json({
      serverNow: serverNow.toISOString(),
      todayUtc: todayUtc.toISOString(),
      todayBerlin: todayBerlin.toISOString(),
      error: "NO_WEEK_PLAN",
    });
  }

  const rawSessions = Array.isArray(weekPlan.plannedSessions)
    ? (weekPlan.plannedSessions as unknown as SessionRaw[])
    : [];

  const sessionsDebug = rawSessions.map((s) => {
    const rawDate = s.date;
    const parsed =
      rawDate instanceof Date ? rawDate : rawDate ? new Date(rawDate) : null;
    return {
      type: s.type ?? "unknown",
      durationMin: s.durationMin ?? 0,
      rawDateValue: String(rawDate),
      rawDateType: rawDate instanceof Date ? "Date" : typeof rawDate,
      parsedIso: parsed?.toISOString() ?? null,
      parsedUtcDate: parsed
        ? parsed.toISOString().slice(0, 10)
        : null,
      parsedBerlinDate: parsed ? toUserDateString(parsed) : null,
      dayKeyUtc: parsed
        ? dayKey(parsed).toISOString().slice(0, 10)
        : null,
    };
  });

  return NextResponse.json({
    serverNow: serverNow.toISOString(),
    serverNowBerlin: toUserDateString(serverNow),
    todayUtc: todayUtc.toISOString().slice(0, 10),
    todayBerlin: todayBerlin.toISOString().slice(0, 10),
    utcVsBerlinMatch: todayUtc.getTime() === todayBerlin.getTime(),
    weekPlan: {
      id: weekPlan.id,
      weekNumber: weekPlan.weekNumber,
      startDate: weekPlan.startDate.toISOString(),
      startDateBerlin: toUserDateString(weekPlan.startDate),
      startDateDayOfWeek: [
        "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
      ][weekPlan.startDate.getUTCDay()],
      endDate: weekPlan.endDate.toISOString(),
    },
    sessions: sessionsDebug,
  });
}
