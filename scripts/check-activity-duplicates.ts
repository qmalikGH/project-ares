// Sprint 3.4 (#28), Phase A1 — read-only pre-check for the migration
// 20261127000000_add_garmin_activity.
//
// The migration adds @@unique([userId, garminActivityId]) to Workout. If two
// sessions already point at the same Garmin activity, `prisma migrate deploy`
// fails and with it the production build. Run this against the production DB
// before merging. It only reads, and it prints counts and dates — no values.
//
//   npx tsx scripts/check-activity-duplicates.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";

async function main() {
  const rows = await db.workout.findMany({
    where: { garminActivityId: { not: null } },
    select: { id: true, userId: true, date: true, type: true, status: true, garminActivityId: true },
    orderBy: { date: "asc" },
  });

  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.userId}::${r.garminActivityId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const dupes = [...byKey.values()].filter((g) => g.length > 1);

  console.log(`Workouts with a Garmin activity: ${rows.length}`);
  console.log(`Activities linked to more than one workout: ${dupes.length}`);
  for (const group of dupes) {
    console.log(
      "  " +
        group
          .map((w) => `${w.date.toISOString().slice(0, 10)} ${w.type} (${w.status}, ${w.id})`)
          .join("  |  "),
    );
  }
  if (dupes.length > 0) process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
