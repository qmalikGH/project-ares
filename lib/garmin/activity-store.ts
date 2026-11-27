// Sprint 3.4 (#28), Phase A2 — the raw activity store.
//
// Rule 1 of the sprint: raw data first, matching after. Every activity the
// watch records lands in GarminActivity, whatever its sport and whether or not
// it fits a planned session. Matching (auto-import.ts, /confirm) reads from
// here; it is never a precondition for storing.
//
// Network side: garmin-connect has no date-range query, only `start/limit`
// over a newest-first list. fetchActivitiesSince pages until it passes the
// cutoff. Before this, auto-import called getActivities(0, 20) once per day
// with a plan and filtered in code — a day beyond the 20 newest activities was
// silently invisible.
import type { Prisma, PrismaClient } from "@prisma/client";

import { db } from "@/lib/db/client";
import {
  classifyActivity,
  garminTypeOf,
  getActivityDetail,
  getActivityHrZones,
  listActivitiesPage,
  toSummary,
  type RawActivity,
} from "./activities";
import { classifyError } from "./sync";
import type { Deadline } from "./timeout";

export const ACTIVITY_PAGE_SIZE = 20;
/** 14 days need one or two pages; the backfill passes its own limit. */
export const DEFAULT_MAX_PAGES = 5;
/** Leave room for the write after the last Garmin call. */
const DEADLINE_RESERVE_MS = 5_000;

export type FetchPage = (start: number, limit: number) => Promise<RawActivity[]>;

/** "YYYY-MM-DD" of Garmin's local start time, or null when it is missing. */
export function localDateKeyOf(a: Pick<RawActivity, "startTimeLocal">): string | null {
  const key = (a.startTimeLocal ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/** UTC midnight of a local date key — the convention every date column uses. */
export function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export interface FetchSinceResult {
  /** Activities whose local start date is ≥ cutoff, newest first. */
  activities: RawActivity[];
  pages: number;
  /** false when a page limit or the deadline stopped paging before the cutoff. */
  complete: boolean;
}

/**
 * Page through the activity list (newest first) until the oldest activity on
 * a page starts before `cutoffKey`, the list ends, or a limit is hit.
 */
export async function fetchActivitiesSince(
  cutoffKey: string,
  opts: {
    pageSize?: number;
    maxPages?: number;
    deadline?: Deadline;
    fetchPage?: FetchPage;
    /** Called after each page — the backfill throttles here. */
    onPage?: (page: number) => Promise<void>;
  } = {},
): Promise<FetchSinceResult> {
  const pageSize = opts.pageSize ?? ACTIVITY_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const fetchPage = opts.fetchPage ?? listActivitiesPage;

  const activities: RawActivity[] = [];
  let pages = 0;
  while (pages < maxPages) {
    if (opts.deadline?.isNear(DEADLINE_RESERVE_MS)) {
      return { activities, pages, complete: false };
    }
    const page = await fetchPage(pages * pageSize, pageSize);
    pages++;
    let passedCutoff = false;
    for (const a of page) {
      const key = localDateKeyOf(a);
      if (key == null) continue;
      if (key < cutoffKey) {
        passedCutoff = true;
        continue;
      }
      activities.push(a);
    }
    if (passedCutoff || page.length < pageSize) {
      return { activities, pages, complete: true };
    }
    await opts.onPage?.(pages);
  }
  return { activities, pages, complete: false };
}

/** Prisma data for one list-endpoint activity. Pure. */
export function toActivityRow(a: RawActivity) {
  const key = localDateKeyOf(a);
  if (key == null) return null;
  const s = toSummary(a);
  const gmt = a.startTimeGMT ? new Date(a.startTimeGMT.replace(" ", "T") + "Z") : null;
  return {
    activityId: String(a.activityId),
    activityName: a.activityName ?? null,
    startTimeLocal: a.startTimeLocal ?? key,
    localDate: dateFromKey(key),
    startTimeGMT: gmt && !Number.isNaN(gmt.getTime()) ? gmt : null,
    category: classifyActivity(a),
    garminType: garminTypeOf(a),
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    averageHr: s.averageHr,
    maxHr: s.maxHr,
    averagePaceSecPerKm: s.averagePaceSecPerKm,
    elevationGainM: s.elevationGainM,
    calories: s.calories,
    workoutId: s.workoutId != null ? String(s.workoutId) : null,
    raw: a as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Review fix (#28, point 5): keep GarminActivity.workoutRefId in step with a
 * manual link or unlink (/confirm, the free-run form, the wizard). Until now
 * only the auto-import set it, so the export showed manually linked
 * activities as unlinked until the next cron reconciled them.
 *
 * `updateMany`: no error when the activity is not in the store yet (picked
 * from a live list before the cron fetched it); the cron reconciles it then.
 * Returns the Prisma promise unawaited, so it works inside an interactive
 * transaction and in the array form.
 */
export function setActivityLink(
  client: Pick<PrismaClient, "garminActivity"> | Pick<Prisma.TransactionClient, "garminActivity">,
  userId: string,
  activityId: string,
  workoutId: string | null,
) {
  return (client.garminActivity as PrismaClient["garminActivity"]).updateMany({
    where: { userId, activityId },
    data: { workoutRefId: workoutId },
  });
}

export interface UpsertResult {
  /** activityIds that were not stored before this call. */
  created: string[];
  updated: number;
  /** Activities without a usable start time (never expected; counted, not stored). */
  skipped: number;
}

/**
 * Store activities idempotently by (userId, activityId). An update refreshes
 * the summary fields (Q can rename or trim an activity in Garmin Connect) but
 * never touches the link (`workoutRefId`) or the fetched details.
 */
export async function upsertGarminActivities(
  userId: string,
  raws: readonly RawActivity[],
): Promise<UpsertResult> {
  const result: UpsertResult = { created: [], updated: 0, skipped: 0 };
  if (raws.length === 0) return result;

  const ids = raws.map((a) => String(a.activityId));
  const existing = await db.garminActivity.findMany({
    where: { userId, activityId: { in: ids } },
    select: { activityId: true },
  });
  const known = new Set(existing.map((e) => e.activityId));

  for (const a of raws) {
    const row = toActivityRow(a);
    if (!row) {
      result.skipped++;
      continue;
    }
    await db.garminActivity.upsert({
      where: { userId_activityId: { userId, activityId: row.activityId } },
      create: { userId, ...row },
      update: row,
    });
    if (known.has(row.activityId)) {
      result.updated++;
    } else {
      result.created.push(row.activityId);
      known.add(row.activityId);
    }
  }
  return result;
}

export interface DetailResult {
  fetched: string[];
  errors: string[];
  /** Runs still without details because the deadline or the limit stopped us. */
  pending: number;
  /** Garmin answered with a rate limit; the loop stopped instead of hammering on. */
  rateLimited: boolean;
}

/**
 * Load splits and HR zones once per run. A run whose detail call fails keeps
 * `detailFetchedAt = null` and is retried next time; missing HR zones are not
 * an error (no strap, no optical HR) and do not block the stamp.
 */
export async function ensureRunDetails(
  userId: string,
  opts: {
    since?: Date;
    limit?: number;
    deadline?: Deadline;
    /** Called between activities — the backfill throttles here. */
    beforeEach?: () => Promise<void>;
    deps?: {
      getDetail?: typeof getActivityDetail;
      getZones?: typeof getActivityHrZones;
    };
  } = {},
): Promise<DetailResult> {
  const getDetail = opts.deps?.getDetail ?? getActivityDetail;
  const getZones = opts.deps?.getZones ?? getActivityHrZones;
  const result: DetailResult = { fetched: [], errors: [], pending: 0, rateLimited: false };

  const todo = await db.garminActivity.findMany({
    where: {
      userId,
      category: "run",
      detailFetchedAt: null,
      ...(opts.since ? { localDate: { gte: opts.since } } : {}),
    },
    orderBy: { localDate: "desc" },
    take: opts.limit ?? 50,
    select: { id: true, activityId: true },
  });

  for (let i = 0; i < todo.length; i++) {
    const act = todo[i];
    if (opts.deadline?.isNear(DEADLINE_RESERVE_MS)) {
      result.pending = todo.length - i;
      break;
    }
    await opts.beforeEach?.();
    try {
      const detail = await getDetail(Number(act.activityId));
      await opts.beforeEach?.();
      const zones = await getZones(Number(act.activityId));
      await db.garminActivity.update({
        where: { id: act.id },
        data: {
          splits: detail.splits as unknown as Prisma.InputJsonValue,
          ...(zones ? { hrZones: zones as unknown as Prisma.InputJsonValue } : {}),
          detailFetchedAt: new Date(),
        },
      });
      result.fetched.push(act.activityId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.errors.push(`detail ${act.activityId}: ${message}`);
      const kind = classifyError(message);
      // Review fix (#28): a timeout or network error is not this run's fault —
      // the next run would take another 15 s each. Stop, retry next night.
      if (kind === "RATE_LIMIT" || kind === "NETWORK") {
        result.rateLimited = kind === "RATE_LIMIT";
        result.pending = todo.length - i - 1;
        break;
      }
    }
  }
  return result;
}

/**
 * The cron's raw-data step: fetch the last `days` days, store everything, load
 * run details. Errors are collected, never thrown — the sensor sync that
 * follows must not depend on this succeeding.
 */
export async function syncRecentActivities(
  userId: string,
  today: Date,
  days: number,
  deadline?: Deadline,
): Promise<{
  fetched: number;
  created: string[];
  details: number;
  complete: boolean;
  errors: string[];
  /** Review fix (#28): Garmin did not answer (timeout/network) — skip further calls. */
  unreachable: boolean;
}> {
  const errors: string[] = [];
  const cutoff = new Date(today.getTime() - days * 86400000);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  let fetched = 0;
  let created: string[] = [];
  let complete = false;
  try {
    const res = await fetchActivitiesSince(cutoffKey, { deadline });
    fetched = res.activities.length;
    complete = res.complete;
    const up = await upsertGarminActivities(userId, res.activities);
    created = up.created;
  } catch (e) {
    errors.push(`activities: ${e instanceof Error ? e.message : String(e)}`);
  }
  const unreachable = errors.some((e) => classifyError(e) === "NETWORK");

  let details = 0;
  if (!unreachable) {
    try {
      const d = await ensureRunDetails(userId, { since: cutoff, deadline });
      details = d.fetched.length;
      errors.push(...d.errors);
    } catch (e) {
      errors.push(`details: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { fetched, created, details, complete, errors, unreachable };
}
