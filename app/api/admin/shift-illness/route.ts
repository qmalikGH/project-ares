// POST /api/admin/shift-illness
// One-time migration: Block 1 W2 missed due to illness (May 5-9 2026).
// Shifts W2+ by 7 days, marks old sessions as skipped_illness, extends macrocycle.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";

const SHIFT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function shiftDate(d: Date): Date {
  return new Date(d.getTime() + SHIFT_MS);
}

/** Shift every session.date inside a plannedSessions JSON array by +7 days. */
function shiftSessionDates(sessions: unknown): unknown {
  if (!Array.isArray(sessions)) return sessions;
  return sessions.map((s) => {
    if (!s || typeof s !== "object") return s;
    const raw = s as Record<string, unknown>;
    if (!raw.date) return s;
    const oldDate = new Date(raw.date as string);
    return { ...raw, date: new Date(oldDate.getTime() + SHIFT_MS).toISOString() };
  });
}

export async function POST() {
  const userId = await getCurrentUserId();

  // ── 1. Load active macrocycle with all phases + weekly plans ──
  const macrocycle = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
    include: {
      phases: {
        orderBy: { blockNumber: "asc" },
        include: { weeklyPlans: { orderBy: { weekNumber: "asc" } } },
      },
    },
  });
  if (!macrocycle) {
    return NextResponse.json({ error: "No active macrocycle" }, { status: 404 });
  }

  const block1 = macrocycle.phases.find((p) => p.blockNumber === 1);
  if (!block1) {
    return NextResponse.json({ error: "Block 1 not found" }, { status: 404 });
  }

  // ── 2. Mark sessions in illness window as skipped_illness ──
  // User reported illness May 5-9; entire W2 (May 5-11) lost.
  const illnessStart = new Date("2026-05-05T00:00:00.000Z");
  const illnessEnd = new Date("2026-05-12T00:00:00.000Z"); // exclusive

  // Collect sessions from ALL block-1 weekly plans that fall in the illness window.
  // Typically these are all in W2, but we scan broadly to be safe.
  interface SkippedEntry {
    userId: string;
    date: Date;
    type: string;
    plannedSession: object;
    status: string;
    modulationApplied: boolean;
    notes: string;
  }
  const skippedEntries: SkippedEntry[] = [];

  for (const wp of block1.weeklyPlans) {
    const sessions = wp.plannedSessions;
    if (!Array.isArray(sessions)) continue;
    for (const raw of sessions) {
      if (!raw || typeof raw !== "object") continue;
      const session = raw as Record<string, unknown>;
      if (!session.date) continue;
      const d = new Date(session.date as string);
      // Normalize to midnight UTC for comparison
      const dMid = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      if (dMid >= illnessStart && dMid < illnessEnd) {
        // Avoid duplicating if there's already a Workout on this date+type
        skippedEntries.push({
          userId,
          date: dMid,
          type: (session.type as string) ?? "unknown",
          plannedSession: raw as object,
          status: "skipped_illness",
          modulationApplied: false,
          notes: "Krankheit - W2 Block 1 verpasst (5.-9. Mai 2026)",
        });
      }
    }
  }

  // Delete any existing Workout rows for the illness window (avoid duplicates on re-run)
  await db.workout.deleteMany({
    where: {
      userId,
      date: { gte: illnessStart, lt: illnessEnd },
    },
  });

  if (skippedEntries.length > 0) {
    await db.workout.createMany({ data: skippedEntries });
  }

  // ── 3. Shift Block 1 W2+ weekly plans by +7 days ──
  const block1ShiftedWeeks: string[] = [];
  for (const wp of block1.weeklyPlans) {
    if (wp.weekNumber < 2) continue; // W1 already completed — leave untouched
    const newStart = shiftDate(wp.startDate);
    const newEnd = shiftDate(wp.endDate);
    await db.weeklyPlan.update({
      where: { id: wp.id },
      data: {
        startDate: newStart,
        endDate: newEnd,
        plannedSessions: shiftSessionDates(wp.plannedSessions) as object,
      },
    });
    block1ShiftedWeeks.push(
      `W${wp.weekNumber}: ${wp.startDate.toISOString().slice(0, 10)} -> ${newStart.toISOString().slice(0, 10)}`,
    );
  }

  // Extend Block 1 phase end date by 7 days
  const oldBlock1End = block1.plannedEndDate;
  await db.phase.update({
    where: { id: block1.id },
    data: { plannedEndDate: shiftDate(block1.plannedEndDate) },
  });

  // ── 4. Shift all subsequent phases (Block 2-5) + their weekly plans ──
  const laterPhases = macrocycle.phases.filter((p) => p.blockNumber > 1);
  const laterShifted: string[] = [];

  for (const phase of laterPhases) {
    await db.phase.update({
      where: { id: phase.id },
      data: {
        startDate: shiftDate(phase.startDate),
        plannedEndDate: shiftDate(phase.plannedEndDate),
      },
    });

    for (const wp of phase.weeklyPlans) {
      await db.weeklyPlan.update({
        where: { id: wp.id },
        data: {
          startDate: shiftDate(wp.startDate),
          endDate: shiftDate(wp.endDate),
          plannedSessions: shiftSessionDates(wp.plannedSessions) as object,
        },
      });
    }

    laterShifted.push(
      `Block ${phase.blockNumber} (${phase.name}): ${phase.startDate.toISOString().slice(0, 10)} -> ${shiftDate(phase.startDate).toISOString().slice(0, 10)}`,
    );
  }

  // ── 5. Extend macrocycle end date + totalWeeks ──
  const oldMacroEnd = macrocycle.endDate;
  await db.macrocycle.update({
    where: { id: macrocycle.id },
    data: {
      endDate: shiftDate(macrocycle.endDate),
      totalWeeks: 21,
    },
  });

  return NextResponse.json({
    status: "OK",
    skippedWorkouts: skippedEntries.length,
    skippedDates: skippedEntries.map((e) => `${e.date.toISOString().slice(0, 10)} ${e.type}`),
    block1: {
      oldEndDate: oldBlock1End.toISOString().slice(0, 10),
      newEndDate: shiftDate(oldBlock1End).toISOString().slice(0, 10),
      shiftedWeeks: block1ShiftedWeeks,
    },
    laterPhases: laterShifted,
    macrocycle: {
      oldEndDate: oldMacroEnd.toISOString().slice(0, 10),
      newEndDate: shiftDate(oldMacroEnd).toISOString().slice(0, 10),
      totalWeeks: 21,
    },
  });
}
