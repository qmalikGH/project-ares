// Set the athlete's goal weight — Sprint 2.7 (A5).
//
// `targetWeightKg` had exactly one writer: the v0.15 goals migration route,
// which hardcodes 87 and also rewrites the annual goal targets. Re-running that
// route to change one number is the wrong tool. This script changes the goal
// weight and nothing else — but it changes it in BOTH places, because the
// progress chart draws its line from UserSettings while the coach narrative
// reads AnnualGoal.targets.weight. Writing only one of them makes the app
// disagree with itself.
//
// Dry-run by default. Run:
//   npx tsx scripts/set-target-weight.ts 84
//   npx tsx scripts/set-target-weight.ts 84 --apply
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";

const APPLY = process.argv.includes("--apply");

async function main() {
  const raw = process.argv[2];
  const targetKg = Number(raw);
  if (!raw || !Number.isFinite(targetKg) || targetKg < 40 || targetKg > 200) {
    console.error("Usage: npx tsx scripts/set-target-weight.ts <kg> [--apply]");
    process.exit(1);
  }

  const settings = await db.userSettings.findFirst({
    select: { userId: true, targetWeightKg: true, currentWeightKg: true },
  });
  if (!settings) {
    console.error("No UserSettings row found");
    process.exit(1);
  }

  const annual = await db.annualGoal.findFirst({
    where: { userId: settings.userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, targets: true },
  });

  const oldAnnualWeight = (annual?.targets as { weight?: number } | null)?.weight ?? null;

  console.log(`User:            ${settings.userId}`);
  console.log(`Current weight:  ${settings.currentWeightKg ?? "—"} kg`);
  console.log(`UserSettings:    ${settings.targetWeightKg ?? "—"} -> ${targetKg} kg`);
  console.log(`AnnualGoal:      ${oldAnnualWeight ?? "—"} -> ${targetKg} kg${annual ? "" : "  (no annual goal row — skipped)"}`);

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to write.");
    await db.$disconnect();
    return;
  }

  await db.userSettings.update({
    where: { userId: settings.userId },
    data: { targetWeightKg: targetKg },
  });

  if (annual) {
    await db.annualGoal.update({
      where: { id: annual.id },
      data: { targets: { ...(annual.targets as object), weight: targetKg } },
    });
  }

  await db.coachingLog.create({
    data: {
      userId: settings.userId,
      action: "setTargetWeight",
      data: { from: settings.targetWeightKg, to: targetKg, annualGoalUpdated: !!annual },
      reason: "Sprint 2.7 (A5): goal weight corrected — the previous 87 kg came from the hardcoded v0.15 migration, never a decision",
    },
  });

  console.log("\nApplied.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
