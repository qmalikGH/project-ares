// Sprint 3.4 (#28), Phase A3 — the history backfill, as testable steps.
// The CLI is scripts/backfill-garmin-history.ts; see its header for usage.
//
// Contract:
//   - Idempotent: activities upsert by (userId, activityId), a filled day is
//     skipped, a run with details is skipped.
//   - Resumable: every step records its progress in `state` and calls
//     `saveState` before the next Garmin call.
//   - Throttled: `sleep` between calls; a rate limit throws RateLimited with
//     the state already saved.
//   - Raw only: nothing is linked to a planned session.
import { db } from "@/lib/db/client";
import { classifyActivity, type RawActivity } from "./activities";
import { ensureRunDetails, localDateKeyOf, upsertGarminActivities, type FetchPage } from "./activity-store";
import { isIncompleteDay } from "./gap-sweep";
import type { persistGarminSync } from "./persist";
import { classifyError, type syncGarminForDate } from "./sync";

export const BACKFILL_PAGE_SIZE = 50;
export const BACKFILL_MAX_PAGES = 60;
/** ≤ 1 Garmin call per second. */
export const CALL_GAP_MS = 1_100;
/** A day's wellness sync is ~6 calls. */
export const DAY_GAP_MS = 6_000;

export interface BackfillState {
  activitiesDone: boolean;
  /** Next list offset to fetch (resume point for the activity phase). */
  activityStart: number;
  detailsDone: boolean;
  /** Days already handled in the wellness phase (YYYY-MM-DD). */
  wellnessDone: string[];
}

export function freshBackfillState(): BackfillState {
  return { activitiesDone: false, activityStart: 0, detailsDone: false, wellnessDone: [] };
}

export interface BackfillDeps {
  apply: boolean;
  fetchPage: FetchPage;
  sync: typeof syncGarminForDate;
  persist: typeof persistGarminSync;
  sleep: (ms: number) => Promise<void>;
  saveState: (state: BackfillState) => void;
}

export class RateLimited extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimited";
  }
}

function rethrowIfRateLimited(message: string) {
  if (classifyError(message) === "RATE_LIMIT") throw new RateLimited(message);
}

export interface ActivityPhaseResult {
  /** "YYYY-MM" → counts per category. */
  perMonth: Map<string, Record<string, number>>;
  seen: number;
  created: number;
  skipped: boolean;
}

/** Phase 1 — activities, page by page, upserted as each page arrives. */
export async function backfillActivities(
  userId: string,
  cutoffKey: string,
  state: BackfillState,
  deps: BackfillDeps,
): Promise<ActivityPhaseResult> {
  const out: ActivityPhaseResult = { perMonth: new Map(), seen: 0, created: 0, skipped: false };
  if (state.activitiesDone) return { ...out, skipped: true };

  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    let raws: RawActivity[];
    try {
      raws = await deps.fetchPage(state.activityStart, BACKFILL_PAGE_SIZE);
    } catch (e) {
      rethrowIfRateLimited(e instanceof Error ? e.message : String(e));
      throw e;
    }
    const inWindow = raws.filter((a) => (localDateKeyOf(a) ?? "") >= cutoffKey);
    for (const a of inWindow) {
      const month = (localDateKeyOf(a) ?? "unknown").slice(0, 7);
      const counts = out.perMonth.get(month) ?? {};
      const cat = classifyActivity(a);
      counts[cat] = (counts[cat] ?? 0) + 1;
      out.perMonth.set(month, counts);
    }
    out.seen += inWindow.length;
    if (deps.apply && inWindow.length > 0) {
      out.created += (await upsertGarminActivities(userId, inWindow)).created.length;
    }
    state.activityStart += raws.length;

    const passedCutoff = inWindow.length < raws.length;
    if (passedCutoff || raws.length < BACKFILL_PAGE_SIZE) {
      state.activitiesDone = true;
      deps.saveState(state);
      break;
    }
    deps.saveState(state);
    await deps.sleep(CALL_GAP_MS);
  }
  return out;
}

/** Phase 2 — splits + HR zones for stored runs without them. */
export async function backfillDetails(
  userId: string,
  since: Date,
  state: BackfillState,
  deps: BackfillDeps,
  detailDeps?: NonNullable<Parameters<typeof ensureRunDetails>[1]>["deps"],
): Promise<{ fetched: number; errors: number; pending: number; skipped: boolean }> {
  if (state.detailsDone) return { fetched: 0, errors: 0, pending: 0, skipped: true };
  if (!deps.apply) {
    const pending = await db.garminActivity.count({
      where: { userId, category: "run", detailFetchedAt: null, localDate: { gte: since } },
    });
    return { fetched: 0, errors: 0, pending, skipped: false };
  }
  const res = await ensureRunDetails(userId, {
    since,
    limit: 2_000,
    beforeEach: () => deps.sleep(CALL_GAP_MS),
    deps: detailDeps,
  });
  if (res.rateLimited) throw new RateLimited(res.errors[res.errors.length - 1] ?? "rate limit");
  if (res.errors.length === 0 && res.pending === 0) {
    state.detailsDone = true;
    deps.saveState(state);
  }
  return { fetched: res.fetched.length, errors: res.errors.length, pending: res.pending, skipped: false };
}

/** Phase 3 — wellness/energy for missing or partial days, newest first. */
export async function backfillWellness(
  userId: string,
  from: Date,
  yesterday: Date,
  state: BackfillState,
  deps: BackfillDeps,
): Promise<{ candidates: number; filled: number; empty: number }> {
  const rows = await db.dailySensorData.findMany({
    where: { userId, date: { gte: from, lte: yesterday } },
    select: { date: true, garmin: true, totalKilocalories: true, bmrKilocalories: true },
  });
  const byDay = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  const done = new Set(state.wellnessDone);

  const days: Date[] = [];
  for (let t = yesterday.getTime(); t >= from.getTime(); t -= 86400000) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    if (done.has(key)) continue;
    if (isIncompleteDay(byDay.get(key))) days.push(d);
  }
  if (!deps.apply) return { candidates: days.length, filled: 0, empty: 0 };

  let filled = 0;
  let empty = 0;
  for (const day of days) {
    const key = day.toISOString().slice(0, 10);
    const res = await deps.sync(day);
    const message = res.errors.map((e) => `${e.datatype}: ${e.message}`).join(" | ");
    for (const e of res.errors) rethrowIfRateLimited(e.message);
    if (res.status === "FAILURE") throw new Error(`sync ${key} failed: ${message}`);

    // A day the watch recorded nothing for gets no row: half a year of
    // all-null rows for unworn days adds nothing.
    const hasData = Object.values(res.snapshot).some((v) => v != null);
    if (hasData) {
      const out = await deps.persist({
        userId,
        date: day,
        result: res,
        writeLog: false,
        refreshReadiness: false,
      });
      if (out.wrote) filled++;
    } else {
      empty++;
    }
    state.wellnessDone.push(key);
    deps.saveState(state);
    await deps.sleep(DAY_GAP_MS);
  }
  return { candidates: days.length, filled, empty };
}
