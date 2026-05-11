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

  // 1. Find active macrocycle + set focusMode
  const activeMacro = await db.macrocycle.findFirst({
    where: { userId, status: "active" },
  });
  let macrocyclesUpdated = 0;
  if (activeMacro) {
    await db.macrocycle.update({
      where: { id: activeMacro.id },
      data: { focusMode: "recomp" },
    });
    macrocyclesUpdated = 1;
  }

  // 2. Update AnnualGoal targets
  const annualGoal = await db.annualGoal.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  let annualGoalUpdated = false;
  let annualGoalLinked = false;
  if (annualGoal) {
    const existingTargets = (annualGoal.targets as Record<string, unknown>) ?? {};
    await db.annualGoal.update({
      where: { id: annualGoal.id },
      data: {
        targets: { ...existingTargets, ...CORRECTED_ANNUAL_TARGETS } as Record<string, string | number>,
      },
    });
    annualGoalUpdated = true;

    // 2b. Link active macrocycle → active AnnualGoal by explicit ID update
    if (activeMacro) {
      await db.macrocycle.update({
        where: { id: activeMacro.id },
        data: { annualGoalId: annualGoal.id },
      });
      annualGoalLinked = true;
    }
  }

  // 3. Set targetWeightKg on UserSettings
  await db.userSettings.upsert({
    where: { userId },
    update: { targetWeightKg: 87 },
    create: { userId, targetWeightKg: 87 },
  });

  return NextResponse.json({
    status: "ok",
    macrocyclesUpdated,
    macrocycleId: activeMacro?.id ?? null,
    annualGoalId: annualGoal?.id ?? null,
    annualGoalUpdated,
    annualGoalLinked,
    targetWeightKg: 87,
    focusMode: "recomp",
    targets: CORRECTED_ANNUAL_TARGETS,
  });
}
