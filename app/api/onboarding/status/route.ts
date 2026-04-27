// GET /api/onboarding/status
// Tells the UI whether onboarding is needed.
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";

export async function GET() {
  const userId = await getCurrentUserId();
  const goal = await db.goal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ onboarded: goal !== null });
}
