import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";

async function main() {
  const plan = await db.mealPlan.findFirst({ where: { status: "active" }, select: { id: true } });
  if (!plan) { console.error("no plan"); process.exit(1); }

  const cfg = await db.dayTypeConfig.findFirst({
    where: { planId: plan.id, dayType: "long_run" },
  });
  console.log("DayTypeConfig long_run:", { calorieTarget: cfg?.calorieTarget, proteinG: cfg?.proteinG, carbsG: cfg?.carbsG, fatG: cfg?.fatG });

  const dp = await db.dayPlan.findFirst({
    where: { mealPlanId: plan.id, dayType: "long_run" },
    select: { id: true, calorieTarget: true, proteinG: true, carbsG: true, fatG: true },
  });
  console.log("DayPlan long_run:", dp);

  const slots = await db.computedMealSlot.findMany({
    where: { planId: plan.id, dayType: "long_run" },
    select: { slotName: true, totalKcal: true, totalProtein: true, totalCarbs: true, totalFat: true, computedAt: true },
    orderBy: { slotName: "asc" },
  });
  console.log("ComputedMealSlots long_run:");
  let totalKcal = 0, totalP = 0, totalC = 0, totalF = 0;
  for (const s of slots) {
    console.log(`  ${s.slotName.padEnd(20)} | ${String(Math.round(s.totalKcal)).padStart(4)} kcal | ${String(Math.round(s.totalProtein)).padStart(4)}g P | ${String(Math.round(s.totalCarbs)).padStart(4)}g C | ${String(Math.round(s.totalFat)).padStart(4)}g F | ${s.computedAt.toISOString()}`);
    totalKcal += s.totalKcal;
    totalP += s.totalProtein;
    totalC += s.totalCarbs;
    totalF += s.totalFat;
  }
  console.log(`  TOTAL                | ${String(Math.round(totalKcal)).padStart(4)} kcal | ${String(Math.round(totalP)).padStart(4)}g P | ${String(Math.round(totalC)).padStart(4)}g C | ${String(Math.round(totalF)).padStart(4)}g F`);

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
