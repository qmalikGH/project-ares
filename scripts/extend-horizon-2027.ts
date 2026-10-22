// Sprint 3.3 (B5) — Planungshorizont statt Zieldatum. Einmal-Script.
//
// WHY
// Das Rennen hat kein festes Datum mehr. Der Makrozyklus wird nur noch als
// Planungshorizont verlängert, um 16 Wochen (vier ganze 4-Wochen-Zyklen):
//
//   Block 2  +4   Wiedereinstieg läuft noch — Threshold kommt zurück, bevor
//   Block 3  +8   VO2max (Block 4) startet. Sonst begänne Block 4 Ende November,
//   Block 4  +4   bevor Threshold überhaupt wieder läuft.
//   Block 5   0   Peak/Taper bleibt am Ende.
//
// Coach-Entscheidung #21. Das 22:00-Ziel bleibt. Goal.targetDate ist NOT NULL
// und wird als Platzhalter auf das Horizont-Ende gesetzt; ein Test mit
// VDOT ≥ 43 meldet „Rennen planen".
//
// WAS ES TUT (Mechanik wie resetBlock / restart-block2-2026-10.ts)
//   - Block 2: +4 leere WeeklyPlan-Rows hinter der letzten Row, plannedEndDate +4 W.
//   - Block 3/4: Start und vorhandene Rows rücken um die Verlängerung der
//     Blöcke davor nach hinten, dahinter neue leere Rows.
//   - Block 5: rückt um 16 Wochen.
//   - weekNumber läuft ab Block 2 fortlaufend weiter; `weekInBlockOf` rechnet
//     modulo Phase.config.durationWeeks (4), Deload bleibt also jede 4. Woche.
//     Phase.config bleibt unverändert, nur die Spalte durationWeeks wächst.
//   - Macrocycle endDate/totalWeeks, Goal (JSON + Spalte) aufs Horizont-Ende.
// Leere Rows füllt die Regeneration.
//
// Reihenfolge: purge-stale-garmin.ts --all → DIESES SCRIPT --apply →
// run-resync.ts. Muss vor dem Start von Block 3 (02.11.) laufen.
//
// Dry-Run per Default; --apply schreibt, in einer Transaktion. Selbst-guardend.
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";

const APPLY = process.argv.includes("--apply");

/** Wochen, um die jeder Block wächst. */
const EXTEND: Record<number, number> = { 2: 4, 3: 8, 4: 4, 5: 0 };
const TOTAL_EXTENSION = 16;
/** Guards: der Stand nach dem Restart vom 04.10. */
const EXPECTED_B2_END = new Date("2026-11-02T00:00:00.000Z");
const EXPECTED_MACRO_END = new Date("2027-01-25T00:00:00.000Z");

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addWeeks = (d: Date, w: number): Date => new Date(d.getTime() + w * 7 * 86400000);

/** Verschiebt das `date` jeder Session in einem plannedSessions-JSON-Blob. */
function shiftSessionDates(sessions: unknown, weeks: number): unknown {
  if (!Array.isArray(sessions) || weeks === 0) return sessions;
  return sessions.map((s) => {
    const session = s as { date?: string };
    if (!session?.date) return s;
    return { ...session, date: addWeeks(new Date(session.date), weeks).toISOString() };
  });
}

async function main() {
  const u = await db.user.findFirst({ select: { id: true } });
  if (!u) { console.error("no user"); process.exit(1); }
  const today0 = userToday();
  console.log(`today: ${iso(today0)} | mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const macro = await db.macrocycle.findFirst({
    where: { userId: u.id, status: "active" },
    include: {
      phases: { orderBy: { startDate: "asc" }, include: { weeklyPlans: { orderBy: { startDate: "asc" } } } },
    },
  });
  if (!macro) { console.error("no active macrocycle"); process.exit(1); }

  const newMacroEnd = addWeeks(EXPECTED_MACRO_END, TOTAL_EXTENSION);
  if (macro.endDate.getTime() === newMacroEnd.getTime()) {
    console.log(`\nHorizont endet bereits ${iso(newMacroEnd)} — nichts zu tun.`);
    await db.$disconnect();
    return;
  }
  if (macro.endDate.getTime() !== EXPECTED_MACRO_END.getTime()) {
    console.error(`\nABBRUCH: Makrozyklus endet ${iso(macro.endDate)}, erwartet ${iso(EXPECTED_MACRO_END)}.`);
    process.exit(1);
  }
  const byBlock = new Map(macro.phases.map((p) => [p.blockNumber, p]));
  for (const b of [2, 3, 4, 5]) {
    const n = macro.phases.filter((p) => p.blockNumber === b).length;
    if (n !== 1) { console.error(`\nABBRUCH: ${n} Phasen für Block ${b}, erwartet genau 1.`); process.exit(1); }
  }
  const b2 = byBlock.get(2)!;
  if (b2.plannedEndDate.getTime() !== EXPECTED_B2_END.getTime()) {
    console.error(`\nABBRUCH: Block 2 endet ${iso(b2.plannedEndDate)}, erwartet ${iso(EXPECTED_B2_END)}.`);
    process.exit(1);
  }
  if (today0 >= EXPECTED_B2_END) {
    console.error(`\nABBRUCH: Block 3 hat am ${iso(EXPECTED_B2_END)} schon begonnen. Konstanten anpassen.`);
    process.exit(1);
  }

  // -- Plan rechnen ----------------------------------------------------------
  type RowShift = { id: string; from: string; to: Date; weekNumber: number; sessions: unknown };
  type NewRow = { phaseId: string; startDate: Date; weekNumber: number };
  const plan: Array<{
    blockNumber: number;
    phaseId: string;
    shiftWeeks: number;
    newStart: Date;
    newEnd: Date;
    durationWeeks: number;
    shifted: RowShift[];
    created: NewRow[];
  }> = [];

  let shiftWeeks = 0; // wie weit dieser Block durch die Verlängerung davor wandert
  let weekNumber = b2.weeklyPlans[b2.weeklyPlans.length - 1].weekNumber; // B2-Historie bleibt
  for (const b of [2, 3, 4, 5]) {
    const p = byBlock.get(b)!;
    const extend = EXTEND[b];
    const newStart = addWeeks(p.startDate, shiftWeeks);
    const newEnd = addWeeks(p.plannedEndDate, shiftWeeks + extend);
    const shifted: RowShift[] = [];
    if (b !== 2) {
      for (const wp of p.weeklyPlans) {
        weekNumber += 1;
        shifted.push({
          id: wp.id,
          from: `W${wp.weekNumber} ${iso(wp.startDate)}`,
          to: addWeeks(wp.startDate, shiftWeeks),
          weekNumber,
          sessions: shiftSessionDates(wp.plannedSessions, shiftWeeks),
        });
      }
    }
    const lastStart = b === 2
      ? p.weeklyPlans[p.weeklyPlans.length - 1].startDate
      : addWeeks(p.weeklyPlans[p.weeklyPlans.length - 1].startDate, shiftWeeks);
    const created: NewRow[] = [];
    for (let i = 1; i <= extend; i++) {
      weekNumber += 1;
      created.push({ phaseId: p.id, startDate: addWeeks(lastStart, i), weekNumber });
    }
    plan.push({
      blockNumber: b,
      phaseId: p.id,
      shiftWeeks,
      newStart,
      newEnd,
      durationWeeks: p.durationWeeks + extend,
      shifted,
      created,
    });
    shiftWeeks += extend;
  }

  const newTotalWeeks = Math.round((newMacroEnd.getTime() - macro.startDate.getTime()) / (7 * 86400000));
  const goal = await db.goal.findUnique({ where: { id: macro.goalId } });
  const goalTarget = (goal?.targetValue ?? {}) as { date?: string; time?: string };

  // Lückenlos? Jeder Block beginnt, wo der vorige endet.
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].newStart.getTime() !== plan[i - 1].newEnd.getTime()) {
      console.error(`\nABBRUCH: Lücke zwischen Block ${plan[i - 1].blockNumber} und ${plan[i].blockNumber}.`);
      process.exit(1);
    }
  }
  if (plan[plan.length - 1].newEnd.getTime() !== newMacroEnd.getTime()) {
    console.error(`\nABBRUCH: Block 5 endet ${iso(plan[plan.length - 1].newEnd)}, Horizont ${iso(newMacroEnd)}.`);
    process.exit(1);
  }

  // -- Ausgabe ---------------------------------------------------------------
  for (const p of plan) {
    console.log(
      `\n=== Block ${p.blockNumber}: ${iso(p.newStart)} – ${iso(p.newEnd)}  ` +
        `(Spalte durationWeeks ${p.durationWeeks}, verschoben um ${p.shiftWeeks} W) ===`,
    );
    for (const r of p.shifted) console.log(`  ${r.from}  →  W${r.weekNumber} ${iso(r.to)}`);
    for (const r of p.created) console.log(`  neu        →  W${r.weekNumber} ${iso(r.startDate)}`);
  }
  console.log(`\n=== Macrocycle + Goal ===`);
  console.log(`  endDate      ${iso(macro.endDate)} → ${iso(newMacroEnd)}`);
  console.log(`  totalWeeks   ${macro.totalWeeks} → ${newTotalWeeks}`);
  console.log(`  Goal.targetDate + targetValue.date → ${iso(newMacroEnd)} (Platzhalter, Zeit bleibt ${goalTarget.time ?? "—"})`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.`);
    await db.$disconnect();
    return;
  }

  // -- Schreiben -------------------------------------------------------------
  // Erst alle verschobenen Rows (von hinten nach vorn, damit sich nichts
  // überholt), dann die neuen. Ein Abbruch rollt alles zurück.
  await db.$transaction(async (tx) => {
    for (const p of [...plan].reverse()) {
      await tx.phase.update({
        where: { id: p.phaseId },
        data: { startDate: p.newStart, plannedEndDate: p.newEnd, durationWeeks: p.durationWeeks },
      });
      for (const r of p.shifted) {
        await tx.weeklyPlan.update({
          where: { id: r.id },
          data: {
            weekNumber: r.weekNumber,
            startDate: r.to,
            endDate: addWeeks(r.to, 1),
            plannedSessions: r.sessions as object,
          },
        });
      }
    }
    await tx.weeklyPlan.createMany({
      data: plan.flatMap((p) =>
        p.created.map((r) => ({
          phaseId: r.phaseId,
          weekNumber: r.weekNumber,
          startDate: r.startDate,
          endDate: addWeeks(r.startDate, 1),
          plannedSessions: [] as unknown as object,
          loadOverrideWeek: null,
        })),
      ),
    });
    await tx.macrocycle.update({
      where: { id: macro.id },
      data: { endDate: newMacroEnd, totalWeeks: newTotalWeeks },
    });
    if (goal) {
      await tx.goal.update({
        where: { id: goal.id },
        data: {
          targetValue: { ...goalTarget, date: newMacroEnd.toISOString() },
          targetDate: newMacroEnd,
        },
      });
    }
  }, { timeout: 60000 });

  console.log(`\nAPPLIED → Horizont ${iso(newMacroEnd)}. Nächster Schritt: npx tsx scripts/run-resync.ts`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
