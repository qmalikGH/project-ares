// GET /api/sensors/insights
// Aggregated sensor data for the /sensors page: today snapshot, 28d trend, sync health.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import {
  getSensorTrend,
  getSyncHealth,
  getTodaySensorSnapshot,
} from "@/lib/db/queries/sensors-aggregate";

export async function GET() {
  const userId = await getCurrentUserId();
  const today = new Date();

  const [snapshot, trend, syncHealth] = await Promise.all([
    getTodaySensorSnapshot(userId, today),
    getSensorTrend(userId, 28),
    getSyncHealth(userId, 10),
  ]);

  return NextResponse.json({ status: "ok", snapshot, trend, syncHealth });
}
