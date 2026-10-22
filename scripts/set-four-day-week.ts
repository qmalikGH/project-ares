// Sprint 3.3 (A1) — four training days: Wed, Fri and Sun become forced rest
// days (ISO 3, 5, 7). Q_DEFAULT_CONSTRAINTS only applies to users without saved
// settings; an existing UserSettings row keeps its own list, so it is set here.
//
// Same effect as Settings → Trainingstage, without the regenerate that route
// starts — the deploy runs run-resync.ts right after this.
// Reihenfolge: purge-stale-garmin.ts --all → DIESES SCRIPT → run-resync.ts
//
// Dry-run by default; --apply writes.
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";

const APPLY = process.argv.includes("--apply");
const REST_DAYS_ISO = [3, 5, 7];

async function main() {
  const u = await db.user.findFirst({ select: { id: true } });
  if (!u) { console.error("no user"); process.exit(1); }
  const s = await db.userSettings.findUnique({
    where: { userId: u.id },
    select: { forcedRestDays: true, preferredLongRunDay: true, preventionExercises: true },
  });
  if (!s) { console.error("no UserSettings row"); process.exit(1); }

  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`forcedRestDays (ISO)   ${JSON.stringify(s.forcedRestDays)} → ${JSON.stringify(REST_DAYS_ISO)}`);
  console.log(`preferredLongRunDay    ${s.preferredLongRunDay} (unverändert)`);
  console.log(`preventionExercises    ${s.preventionExercises.length} Übungen (Heim-Routine an jedem Ruhetag)`);
  if (REST_DAYS_ISO.includes(s.preferredLongRunDay ?? 6)) {
    console.error("ABBRUCH: der Long-Run-Tag wäre ein Ruhetag.");
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.");
    await db.$disconnect();
    return;
  }
  await db.userSettings.update({ where: { userId: u.id }, data: { forcedRestDays: REST_DAYS_ISO } });
  console.log("\nAPPLIED. Nächster Schritt: npx tsx scripts/run-resync.ts");
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
