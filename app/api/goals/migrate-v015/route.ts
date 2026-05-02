// POST /api/goals/migrate-v015
// Sprint v0.15: One-time data migration.
// 1. Set focusMode = "recomp" on active macrocycle
// 2. Update AnnualGoal targets with corrected strength values
// 3. Set targetWeightKg on UserSettings
//
// Idempotent — safe to call multiple times.
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth/current-user";

const CORRECTED_ANNUAL_TARGETS = {
  "5k": "22:00",
  hexBarDl: 165,
  bench: 105,
  convDl: 160,
  weight: 87,
};

export async function POST() {
  const userId = await getCurrentUserId();

  // 1. Set focusMode on active macrocycle
  const macroUpdate = await db.macrocycle.updateMany({
    where: { userId, status: "active" },
    data: { focusMode: "recomp" },
  });

  // 2. Update AnnualGoal targets
  const annualGoal = await db.annualGoal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  let annualGoalUpdated = false;
  if (annualGoal) {
    const existingTargets = (annualGoal.targets as Record<string, unknown>) ?? {};
    await db.annualGoal.update({
      where: { id: annualGoal.id },
      data: {
        targets: { ...existingTargets, ...CORRECTED_ANNUAL_TARGETS } as Record<string, string | number>,
      },
    });
    annualGoalUpdated = true;
  }

  // 3. Set targetWeightKg on UserSettings
  await db.userSettings.upsert({
    where: { userId },
    update: { targetWeightKg: 87 },
    create: { userId, targetWeightKg: 87 },
  });

  return NextResponse.json({
    status: "ok",
    macrocyclesUpdated: macroUpdate.count,
    annualGoalUpdated,
    targetWeightKg: 87,
    focusMode: "recomp",
    targets: CORRECTED_ANNUAL_TARGETS,
  });
}
