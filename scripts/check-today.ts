import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";

async function main() {
  const user = await db.user.findFirst({ select: { id: true, email: true } });
  if (!user) { console.error("no user"); process.exit(1); }
  console.log("User:", user.email);

  // Today
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  console.log("Today (UTC):", today.toISOString());

  const log = await db.dailyNutritionLog.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
  });
  // Macros (proteinG/carbsG/fatG) live on DayPlan, not DailyNutritionLog —
  // printing them here only ever yielded undefined.
  console.log("DailyNutritionLog today:", log ? {
    dayType: log.dayType,
    calorieTarget: log.calorieTarget,
    garminTDEE: log.garminTDEE,
    adjustment: log.adjustment,
  } : "(none)");

  // Recent logs to see pattern
  const recent = await db.dailyNutritionLog.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 5,
  });
  console.log("\nRecent DailyNutritionLogs:");
  for (const r of recent) {
    console.log(`  ${r.date.toISOString().slice(0,10)} | ${r.dayType.padEnd(13)} | ${r.calorieTarget} kcal`);
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
