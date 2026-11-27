// Sprint 3.4 (#28), Phase A3 — load the Garmin history into the raw store.
//
// Run locally with .env.local, never on Vercel:
//
//   npx tsx scripts/backfill-garmin-history.ts            # dry run (reads Garmin, writes nothing)
//   npx tsx scripts/backfill-garmin-history.ts --apply    # writes
//   options: --activity-months=12  --wellness-months=6  --reset
//
// What it does (logic in lib/garmin/history-backfill.ts, tested there):
//   1. Activities of the last 12 months → GarminActivity, page by page.
//   2. Splits + HR zones for every run among them.
//   3. Daily wellness/energy of the last 6 months, ONLY for days that are
//      missing or partially filled. No GarminSyncLog rows (they would bury the
//      real "last sync" and feed the failure streak), no readiness refresh.
//
// What it does NOT do: link activities to planned sessions. Historic
// activities stay raw data; linking happens only in the auto-import window
// (and once from 05.10. via scripts/link-since-restart.ts).
//
// Resumable: progress lives in scripts/.backfill-garmin-state.json (gitignored).
// Idempotent and throttled (≤ 1 Garmin call/s on average). A rate limit stops
// the run cleanly with the state saved — run it again later.
//
// Output: counts only (activities per category and month, filled days). The
// repo is public; the result goes into the issue as is.
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";

import { db } from "@/lib/db/client";
import { userTodayForUser } from "@/lib/date";
import { listActivitiesPage } from "@/lib/garmin/activities";
import { dateFromKey } from "@/lib/garmin/activity-store";
import {
  backfillActivities,
  backfillDetails,
  backfillWellness,
  freshBackfillState,
  RateLimited,
  type BackfillDeps,
  type BackfillState,
} from "@/lib/garmin/history-backfill";
import { persistGarminSync } from "@/lib/garmin/persist";
import { syncGarminForDate } from "@/lib/garmin/sync";

const APPLY = process.argv.includes("--apply");
const RESET = process.argv.includes("--reset");
const ACTIVITY_MONTHS = Number(argValue("activity-months") ?? 12);
const WELLNESS_MONTHS = Number(argValue("wellness-months") ?? 6);
const STATE_PATH = path.resolve(process.cwd(), "scripts/.backfill-garmin-state.json");

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

function loadState(): BackfillState {
  const fresh = freshBackfillState();
  if (RESET || !APPLY || !fs.existsSync(STATE_PATH)) return fresh;
  return { ...fresh, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) };
}

async function resolveUserId(): Promise<string> {
  const settings = await db.userSettings.findFirst({ select: { userId: true } });
  if (settings) return settings.userId;
  const user = await db.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("No user found in the database");
  return user.id;
}

function monthsBack(today: Date, months: number): Date {
  const d = new Date(today);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

async function main() {
  const userId = await resolveUserId();
  const today = await userTodayForUser(userId);
  const yesterday = new Date(today.getTime() - 86400000);
  const cutoffKey = monthsBack(today, ACTIVITY_MONTHS).toISOString().slice(0, 10);
  const wellnessFrom = monthsBack(today, WELLNESS_MONTHS);
  const state = loadState();
  const deps: BackfillDeps = {
    apply: APPLY,
    fetchPage: listActivitiesPage,
    sync: syncGarminForDate,
    persist: persistGarminSync,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    saveState: (s) => {
      if (APPLY) fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
    },
  };

  console.log(APPLY ? "MODE: APPLY (writes)" : "MODE: DRY RUN (pass --apply to write)");
  console.log(`Activities since ${cutoffKey}, wellness since ${wellnessFrom.toISOString().slice(0, 10)}`);

  try {
    const acts = await backfillActivities(userId, cutoffKey, state, deps);
    if (acts.skipped) {
      console.log("\nPhase 1: activities already done (state file).");
    } else {
      console.log(`\nPhase 1: ${acts.seen} activities in the window${APPLY ? `, ${acts.created} new in the DB` : ""}.`);
      for (const m of [...acts.perMonth.keys()].sort()) {
        const c = acts.perMonth.get(m)!;
        console.log(`  ${m}  run ${c.run ?? 0}  strength ${c.strength ?? 0}  other ${c.other ?? 0}`);
      }
    }

    const det = await backfillDetails(userId, dateFromKey(cutoffKey), state, deps);
    if (det.skipped) console.log("Phase 2: run details already done (state file).");
    else if (!APPLY) console.log(`Phase 2 (dry run): ${det.pending} stored runs without details.`);
    else console.log(`Phase 2: details for ${det.fetched} runs, ${det.errors} errors, ${det.pending} pending (run again).`);

    const well = await backfillWellness(userId, wellnessFrom, yesterday, state, deps);
    console.log(
      APPLY
        ? `Phase 3: ${well.candidates} days missing or partial → ${well.filled} filled, ${well.empty} without any Garmin data.`
        : `Phase 3 (dry run): ${well.candidates} days missing or partial.`,
    );
  } catch (e) {
    if (e instanceof RateLimited) {
      console.error(`\nGarmin rate limit — stopped cleanly, state saved. Run again later.\n  ${e.message}`);
      process.exitCode = 3;
      return;
    }
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
