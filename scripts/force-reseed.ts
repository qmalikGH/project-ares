// One-shot script: forceReseed + cascade for collagen protein fix.
// Run: npx tsx scripts/force-reseed.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { forceReseedDayTypeConfigs } from "@/lib/nutrition/seed-day-type-configs";
import { cascadeNutritionUpdate } from "@/lib/nutrition/cascade";

async function main() {
  const plan = await db.mealPlan.findFirst({
    where: { status: "active" },
    select: { id: true },
  });

  if (!plan) {
    console.error("No active meal plan found");
    process.exit(1);
  }

  console.log("Plan ID:", plan.id);

  const updated = await forceReseedDayTypeConfigs(plan.id);
  console.log("Reseeded day types:", updated.join(", "));

  await cascadeNutritionUpdate(
    plan.id,
    "config_change",
    "Macro-aware scaling deploy: protein-capping with carb rebalance",
  );
  console.log("Cascade complete");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
