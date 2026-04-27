// GET /api/progress
// Aggregated read-only data for the /progress page.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  getAdherenceStats,
  getBlockStatus,
  getGoalProgress,
  getHrBasedTIDDistribution,
  getTIDDistribution,
  getVdotHistory,
} from "@/lib/db/queries/progress";

export async function GET() {
  const userId = await getCurrentUserId();
  const today = new Date();

  const [
    goal,
    vdotHistory,
    blockStatus,
    adherenceWeek,
    adherenceBlock,
    tidBlock,
    tidHrBlock,
  ] = await Promise.all([
    getGoalProgress(userId, today),
    getVdotHistory(userId),
    getBlockStatus(userId, today),
    getAdherenceStats(userId, "this_week", today),
    getAdherenceStats(userId, "this_block", today),
    getTIDDistribution(userId, "this_block", today),
    getHrBasedTIDDistribution(userId, "this_block", today),
  ]);

  if (!goal) {
    return NextResponse.json({ status: "NO_ACTIVE_GOAL" }, { status: 200 });
  }

  return NextResponse.json({
    status: "ok",
    goal,
    vdotHistory,
    blockStatus,
    adherence: { thisWeek: adherenceWeek, thisBlock: adherenceBlock },
    // tidPlan = plan-based zone bucketing (intent). tidHr = HR-zone-based (actual effort).
    // tid kept as alias for backwards compat with /progress UI before v0.6.
    tid: tidBlock,
    tidPlan: tidBlock,
    tidHr: tidHrBlock,
  });
}
