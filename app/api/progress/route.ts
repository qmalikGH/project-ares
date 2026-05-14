// GET /api/progress
// Aggregated read-only data for the /progress page.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { userToday } from "@/lib/date";
import {
  getAdherenceStats,
  getBlockStatus,
  getAllBlockWeeks,
  getGarminBasedTIDDistribution,
  getGoalProgress,
  getHrBasedTIDDistribution,
  getPaceDriftStatus,
  getPhasesSummary,
  getTIDDistribution,
  getVdotHistory,
  loadActiveMacrocycle,
} from "@/lib/db/queries/progress";
import { getEffectiveVdot } from "@/lib/db/queries/settings";

export async function GET() {
  const userId = await getCurrentUserId();
  const today = userToday();

  // Load macrocycle once, reuse for block-related queries
  const macro = await loadActiveMacrocycle(userId);

  const [
    goal,
    vdotHistory,
    blockStatus,
    adherenceWeek,
    adherenceBlock,
    tidBlock,
    tidHrBlock,
    tidGarminBlock,
    paceDrift,
    effectiveVdot,
  ] = await Promise.all([
    getGoalProgress(userId, today),
    getVdotHistory(userId),
    getBlockStatus(userId, today, macro),
    getAdherenceStats(userId, "this_week", today),
    getAdherenceStats(userId, "this_block", today),
    getTIDDistribution(userId, "this_block", today),
    getHrBasedTIDDistribution(userId, "this_block", today),
    getGarminBasedTIDDistribution(userId, "this_block", today),
    getPaceDriftStatus(userId, 7),
    getEffectiveVdot(userId),
  ]);

  // Block-detail data (phase tabs + per-week summaries)
  const phases = macro ? getPhasesSummary(macro) : null;
  const allBlockWeeks = macro ? getAllBlockWeeks(macro, today) : null;

  if (!goal) {
    return NextResponse.json({ status: "NO_ACTIVE_GOAL" }, { status: 200 });
  }

  return NextResponse.json({
    status: "ok",
    goal,
    vdotHistory,
    blockStatus,
    adherence: { thisWeek: adherenceWeek, thisBlock: adherenceBlock },
    // TID hierarchy (Sprint v0.7):
    //   tidGarmin → most accurate, from Garmin's per-activity HR-time-in-zones
    //   tidHr     → splits-based Karvonen-classified (fallback)
    //   tidPlan   → plan-zone bucketing (intent only)
    // `tid` kept as alias for backwards compat with /progress UI before v0.6.
    tid: tidBlock,
    tidPlan: tidBlock,
    tidHr: tidHrBlock,
    tidGarmin: tidGarminBlock,
    paceDrift,
    effectiveVdot,
    phases,
    allBlockWeeks,
  });
}
