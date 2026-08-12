// Read-only diff across all four nutrition stores — Sprint 2.7 (A5).
//
// The stores are supposed to agree: DayTypeConfig holds the targets,
// MealPlan.deficitKcal the deficit they were derived from, DayPlan the copy the
// UI reads, ComputedMealSlot the actual food. Between 2026-06-15 and 2026-08-12
// they did not, and nothing in the app said so — the cascade that keeps them in
// sync was failing silently. This prints all four side by side so the split is
// one glance, not an investigation.
//
// Run: npx tsx scripts/check-nutrition-stores.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { minCalorieTargetForConfig } from "@/lib/nutrition/min-intake";
import { dbConfigToEngineConfig } from "@/lib/nutrition/seed-day-type-configs";

const DAY_TYPES = ["strength_run", "threshold", "long_run", "rest"];

function pad(v: unknown, n: number) {
  return String(v ?? "—").padEnd(n);
}

async function main() {
  const plan = await db.mealPlan.findFirst({
    where: { status: "active" },
    select: {
      id: true,
      userId: true,
      deficitKcal: true,
      calibrationStatus: true,
      calibratedAt: true,
    },
  });
  if (!plan) {
    console.error("No active meal plan found");
    process.exit(1);
  }

  const settings = await db.userSettings.findUnique({
    where: { userId: plan.userId },
    select: { currentWeightKg: true, currentWeightUpdatedAt: true, targetWeightKg: true },
  });
  const weightKg = settings?.currentWeightKg ?? 92;

  console.log("── MealPlan ─────────────────────────────────────────────");
  console.log(`  deficitKcal        ${plan.deficitKcal}`);
  console.log(`  calibrationStatus  ${plan.calibrationStatus}`);
  console.log(`  calibratedAt       ${plan.calibratedAt?.toISOString() ?? "—"}`);
  console.log(`  currentWeightKg    ${settings?.currentWeightKg ?? "—"}  (${settings?.currentWeightUpdatedAt?.toISOString().slice(0, 10) ?? "—"})`);
  console.log(`  targetWeightKg     ${settings?.targetWeightKg ?? "—"}`);

  const configs = await db.dayTypeConfig.findMany({ where: { planId: plan.id } });
  const dayPlans = await db.dayPlan.findMany({ where: { mealPlanId: plan.id } });
  const slots = await db.computedMealSlot.groupBy({
    by: ["dayType"],
    where: { planId: plan.id },
    _sum: { totalKcal: true, totalProtein: true, totalCarbs: true, totalFat: true },
    _count: { _all: true },
  });

  console.log("\n── Per day type ─────────────────────────────────────────");
  console.log(
    "  dayType        cfgTDEE  cfgTarget  dpTarget  slotSum  Δcfg-dp  Δcfg-slots  floor   cfgP  cfgC",
  );

  let split = false;
  for (const dt of DAY_TYPES) {
    const cfg = configs.find((c) => c.dayType === dt);
    const dp = dayPlans.find((d) => d.dayType === dt);
    const sl = slots.find((s) => s.dayType === dt);
    const slotSum = sl?._sum.totalKcal ?? null;
    const dCfgDp = cfg && dp ? cfg.calorieTarget - dp.calorieTarget : null;
    const dCfgSlot = cfg && slotSum != null ? cfg.calorieTarget - slotSum : null;
    const floor = cfg ? minCalorieTargetForConfig(dbConfigToEngineConfig(cfg), weightKg).minKcal : null;

    if (dCfgDp !== 0 || (dCfgSlot != null && Math.abs(dCfgSlot) > 30)) split = true;

    console.log(
      `  ${pad(dt, 14)} ${pad(cfg?.tdeeEstimate, 8)} ${pad(cfg?.calorieTarget, 10)} ` +
      `${pad(dp?.calorieTarget, 9)} ${pad(slotSum, 8)} ${pad(dCfgDp, 8)} ${pad(dCfgSlot, 11)} ` +
      `${pad(floor, 7)} ${pad(cfg?.proteinG, 5)} ${pad(cfg?.carbsG, 5)}`,
    );

    if (cfg && floor != null && cfg.calorieTarget < floor) {
      console.log(`      !! target ${cfg.calorieTarget} is BELOW the derived minimum ${floor} — this config cannot be built`);
    }
    if (cfg?.tdeeEstimate != null) {
      const implied = cfg.tdeeEstimate - cfg.calorieTarget;
      if (implied !== plan.deficitKcal) {
        console.log(`      !! implied deficit ${implied} ≠ MealPlan.deficitKcal ${plan.deficitKcal}`);
      }
    }
  }

  const lastCascade = await db.coachingLog.findFirst({
    where: { userId: plan.userId, action: { startsWith: "cascade" } },
    orderBy: { createdAt: "desc" },
    select: { action: true, createdAt: true, reason: true, data: true },
  });

  console.log("\n── Last cascade ─────────────────────────────────────────");
  if (lastCascade) {
    console.log(`  ${lastCascade.action}  ${lastCascade.createdAt.toISOString()}`);
    console.log(`  reason: ${lastCascade.reason}`);
    const d = lastCascade.data as { errors?: string[]; warnings?: string[] } | null;
    for (const e of d?.errors ?? []) console.log(`  error:   ${e}`);
    for (const w of d?.warnings ?? []) console.log(`  warning: ${w}`);
  } else {
    console.log("  none");
  }

  console.log(`\n${split ? "STORES ARE SPLIT" : "stores agree"}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
