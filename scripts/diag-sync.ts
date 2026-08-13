import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";

async function main() {
  const u = await db.user.findFirst({ select: { id: true, email: true } });
  if (!u) { console.error("no user"); process.exit(1); }
  console.log("user:", u.email);

  console.log("\n=== garminSyncLog (last 12) ===");
  const logs = await db.garminSyncLog.findMany({
    where: { userId: u.id },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  for (const l of logs) {
    const flags = `hrv:${l.hrvSyncOk?1:0} sleep:${l.sleepSyncOk?1:0} bb:${l.bodyBatterySyncOk?1:0} rhr:${l.rhrSyncOk?1:0} act:${l.activitiesSyncOk?1:0} energy:${l.energySyncOk?1:0}`;
    console.log(`${l.createdAt.toISOString().slice(0,16)} ${l.status} [${flags}] ${l.errorType ?? ""} ${l.errorMessage ? "→ " + l.errorMessage.slice(0,160) : ""}`);
  }

  // Sprint 2.8: the energy columns are printed here because they were the ones
  // going missing while every visible signal said SUCCESS. A diagnostic that
  // cannot show the broken field is not a diagnostic.
  console.log("\n=== dailySensorData freshness (last 8) ===");
  const rows = await db.dailySensorData.findMany({
    where: { userId: u.id },
    orderBy: { date: "desc" },
    take: 8,
    select: {
      date: true, garminLastSyncAt: true, garmin: true,
      totalKilocalories: true, activeKilocalories: true, bmrKilocalories: true,
      bodyBatteryEnd: true, averageStress: true,
    },
  });
  for (const r of rows) {
    const g = r.garmin as { rhr?: number; sleepScore?: number; bodyBatteryMorning?: number } | null;
    const wellness = `rhr=${g?.rhr ?? "—"} sleep=${g?.sleepScore ?? "—"} bb=${g?.bodyBatteryMorning ?? "—"}`;
    const energy = `tot=${r.totalKilocalories ?? "—"} act=${r.activeKilocalories ?? "—"} bmr=${r.bmrKilocalories ?? "—"} bbEnd=${r.bodyBatteryEnd ?? "—"} stress=${r.averageStress ?? "—"}`;
    // An adult BMR below ~1500 is a partially-elapsed day, not a measurement.
    const suspect = r.bmrKilocalories != null && r.bmrKilocalories < 1500 ? "  ⚠ partial-day BMR" : "";
    console.log(`${r.date.toISOString().slice(0,10)} lastSync=${r.garminLastSyncAt?.toISOString().slice(0,16) ?? "—"} ${wellness} | ${energy}${suspect}`);
  }

  console.log("\n=== latest Garmin activity import (Workout.garminActivityId) ===");
  const acts = await db.workout.findMany({
    where: { userId: u.id, garminActivityId: { not: null } },
    orderBy: { date: "desc" },
    take: 5,
    select: { date: true, type: true, status: true, garminActivityId: true },
  });
  for (const a of acts) {
    console.log(`${a.date.toISOString().slice(0,10)} ${a.type} ${a.status} actId=${a.garminActivityId}`);
  }

  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
