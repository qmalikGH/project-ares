import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import type { MealItem, MealSlots } from "@/lib/nutrition/types";

async function main() {
  const plan = await db.mealPlan.findFirst({ where: { status: "active" }, select: { id: true } });
  if (!plan) { console.error("no plan"); process.exit(1); }

  const dp = await db.dayPlan.findFirst({
    where: { mealPlanId: plan.id, dayType: "long_run" },
  });
  console.log("DayPlan long_run keys:", Object.keys(dp ?? {}));
  console.log("\nlong_run targets:", { calorieTarget: dp?.calorieTarget, proteinG: dp?.proteinG, carbsG: dp?.carbsG, fatG: dp?.fatG });

  // DayPlan.slots is a Prisma Json column; its shape is MealSlots.
  const slots = dp?.slots as unknown as MealSlots | null;
  if (slots) {
    console.log("\nDayPlan.slots JSON:");
    let kcal = 0, p = 0, c = 0, f = 0;
    for (const [name, val] of Object.entries(slots)) {
      const items: MealItem[] = val?.items ?? [];
      let sk = 0, sp = 0, sc = 0, sf = 0;
      for (const item of items) {
        sk += item.kcal ?? 0;
        sp += item.protein ?? 0;
        sc += item.carbs ?? 0;
        sf += item.fat ?? 0;
      }
      console.log(`  ${name.padEnd(20)} | ${String(Math.round(sk)).padStart(4)} kcal | ${String(Math.round(sp)).padStart(4)}g P | ${String(Math.round(sc)).padStart(4)}g C`);
      kcal += sk; p += sp; c += sc; f += sf;
    }
    console.log(`  TOTAL                | ${String(Math.round(kcal)).padStart(4)} kcal | ${String(Math.round(p)).padStart(4)}g P | ${String(Math.round(c)).padStart(4)}g C | ${String(Math.round(f)).padStart(4)}g F`);
  } else {
    console.log("\nNo slots JSON on DayPlan");
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
