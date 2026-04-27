// Macrocycle / phase / weekly-plan query helpers.
import { db } from "@/lib/db/client";
import type { SessionPlan } from "@/lib/coach-engine/types";
import { dayKey } from "./sensors";

export async function getActiveMacrocycle(userId: string) {
  return db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getActiveGoal(userId: string) {
  return db.goal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCurrentPhaseRow(userId: string, today: Date) {
  const today0 = dayKey(today);
  return db.phase.findFirst({
    where: {
      macrocycle: { userId },
      startDate: { lte: today0 },
      plannedEndDate: { gt: today0 },
    },
    include: { weeklyPlans: true, macrocycle: true },
    orderBy: { startDate: "desc" },
  });
}

/** Find the WeeklyPlan covering `date`. endDate is exclusive (next week's startDate). */
export function findWeekPlanForDate<T extends { startDate: Date; endDate: Date }>(
  weeks: T[],
  date: Date,
): T | null {
  const d = dayKey(date).getTime();
  return weeks.find((w) => dayKey(w.startDate).getTime() <= d && d < dayKey(w.endDate).getTime()) ?? null;
}

/** Pick the FIRST planned session for today. Kept for back-compat — prefer
 * `findAllTodaySessionsInPlan` so two-a-days (e.g. AM Easy + PM Strength) are
 * surfaced. */
export function findTodaySessionInPlan(
  plannedSessionsJson: unknown,
  today: Date,
): SessionPlan | null {
  return findAllTodaySessionsInPlan(plannedSessionsJson, today)[0] ?? null;
}

/**
 * All sessions scheduled for `today`, sorted with cardio AM before strength PM
 * (concurrent training rule: lift AFTER endurance to minimize interference).
 * See spec §9 / science_doc Kap 5 (Concurrent Training).
 */
export function findAllTodaySessionsInPlan(
  plannedSessionsJson: unknown,
  today: Date,
): SessionPlan[] {
  if (!Array.isArray(plannedSessionsJson)) return [];
  const todayKey = dayKey(today).getTime();
  const matches: SessionPlan[] = [];
  for (const raw of plannedSessionsJson) {
    if (!raw || typeof raw !== "object") continue;
    const session = raw as SessionPlan & { date: string | Date };
    const sessionDate = session.date instanceof Date ? session.date : new Date(session.date);
    if (dayKey(sessionDate).getTime() === todayKey) {
      matches.push({ ...session, date: sessionDate });
    }
  }
  return matches.sort((a, b) => sessionSlotOrder(a) - sessionSlotOrder(b));
}

/** Stable ordering: rest first, then runs (AM), then strength (PM), then cross. */
function sessionSlotOrder(s: SessionPlan): number {
  const t = s.type;
  if (t === "rest") return 0;
  if (t.endsWith("_run") || t === "calibration_run" || t === "long_run" || t === "vo2max_intervals" || t === "time_trial_5k") return 1;
  if (t === "active_recovery" || t === "mobility") return 2;
  if (t.startsWith("strength")) return 3;
  return 4;
}
