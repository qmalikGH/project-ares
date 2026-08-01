import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db/client";
async function main() {
  const user = await db.user.findFirst({ select: { id: true } });
  if (!user) process.exit(1);
  const s = await db.userSettings.findUnique({
    where: { userId: user.id },
    select: { garminWorkoutPushEnabled: true, garminUsernameOverride: true },
  });
  console.log("garminWorkoutPushEnabled:", s?.garminWorkoutPushEnabled);
  console.log("garminUsernameOverride:", s?.garminUsernameOverride);

  const today = new Date(); today.setUTCHours(0,0,0,0);
  const nextWeek = new Date(today.getTime() + 8*86400000);
  const workouts = await db.workout.findMany({
    where: { userId: user.id, date: { gte: today, lt: nextWeek } },
    orderBy: { date: "asc" },
  });
  console.log(`\nWorkout rows next 7 days (${workouts.length}):`);
  for (const w of workouts) {
    const day = w.date.toISOString().slice(0,10);
    const hasPS = w.plannedSession ? "✓" : "✗";
    const garmin = w.garminScheduledWorkoutId ? `Garmin:${w.garminScheduledWorkoutId}` : "no-Garmin";
    console.log(`  ${day} ${w.type.padEnd(20)} plannedSession=${hasPS} ${garmin} status=${w.status}`);
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
