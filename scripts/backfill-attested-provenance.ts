// Sprint 3.2a — relabel what /confirm wrote before it stopped passing the plan
// off as a measurement.
//
// Until 3.2a, a session confirmed without watch data was stored as
// `source: "manual"` with the PLANNED duration, in both the executedSession and
// the Workout.durationActualMin column. 31.08.: "Easy 30 min" for a 13-minute
// run. "manual" is also what the completion wizard writes for hand-logged
// sessions with real numbers, so the two were indistinguishable.
//
// Identification: /confirm stamps startTimeLocal at exactly noon UTC
// (sessionTimestampFor); the wizard writes `new Date()`. Plus no Garmin link,
// and the endpoint only exists since 29.08.
//
// Effect per row:
//   executedSession.source -> "attested"
//   durationEstimated: true + durationActualMin column -> null, but ONLY when
//   the stored duration equals the planned one (i.e. it was the plan).
// The ExerciseLog rows these confirmations wrote (rpe null) need no change:
// evaluateCycleClean no longer counts unrated sets as evidence.
//
// Dry-run by default; --apply writes in one transaction. Idempotent.
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";

const APPLY = process.argv.includes("--apply");
const CONFIRM_LIVE_SINCE = new Date("2026-08-29T00:00:00.000Z");

function durationMinOf(exec: Record<string, unknown>): number | null {
  if (exec.type === "run" && typeof exec.durationSec === "number") return exec.durationSec / 60;
  if (exec.type === "strength" && typeof exec.durationActualMin === "number") return exec.durationActualMin;
  return null;
}

async function main() {
  const u = await db.user.findFirst({ select: { id: true, email: true } });
  if (!u) { console.error("no user"); process.exit(1); }
  console.log(`user: ${u.email} | mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const rows = await db.workout.findMany({
    where: {
      userId: u.id,
      status: "completed",
      garminActivityId: null,
      updatedAt: { gte: CONFIRM_LIVE_SINCE },
    },
    orderBy: { date: "asc" },
    select: {
      id: true, date: true, type: true, durationActualMin: true,
      plannedSession: true, executedSession: true,
    },
  });

  const targets = rows
    .map((w) => {
      const exec = (w.executedSession ?? null) as Record<string, unknown> | null;
      if (!exec || exec.source !== "manual") return null;
      if (typeof exec.startTimeLocal !== "string" || !exec.startTimeLocal.endsWith("T12:00:00.000Z")) {
        return null;
      }
      const planned = (w.plannedSession as { durationMin?: number } | null)?.durationMin ?? null;
      const stored = durationMinOf(exec);
      const wasPlan = planned != null && stored != null && Math.round(stored) === planned;
      return { w, exec, planned, stored, wasPlan };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  console.log(`\n=== ${targets.length} Bestätigungen ohne Aufzeichnung ===`);
  for (const t of targets) {
    console.log(
      `  ${t.w.date.toISOString().slice(0, 10)} ${t.w.type.padEnd(14)}` +
        ` gespeichert ${t.stored ?? "—"} min · Plan ${t.planned ?? "—"} min · Spalte ${t.w.durationActualMin ?? "null"}` +
        ` → source attested${t.wasPlan ? ", durationEstimated, Spalte null" : " (Dauer bleibt)"}`,
    );
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — nichts geschrieben. Mit --apply ausfuehren.");
    await db.$disconnect();
    return;
  }

  await db.$transaction(
    targets.map((t) =>
      db.workout.update({
        where: { id: t.w.id },
        data: {
          executedSession: {
            ...t.exec,
            source: "attested",
            ...(t.wasPlan ? { durationEstimated: true } : {}),
          },
          ...(t.wasPlan ? { durationActualMin: null } : {}),
        },
      }),
    ),
  );
  console.log(`\nAPPLIED -> ${targets.length} Rows umetikettiert.`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
