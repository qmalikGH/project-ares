// Garmin Activity fetch + classification.
// Separate from sync.ts (which does daily-sensor sync) — this is per-workout,
// triggered when the user finalises a session.
//
// All public methods are async (network I/O). Pure matching logic lives in
// `match.ts`.
import { getGarminClient } from "./client";

export type ActivityCategory = "run" | "strength" | "other";

// Defensive: garmin-connect's IActivity type has many fields, but several are
// optional in practice (indoor activities lack distance, etc.). We re-type
// against `any` and validate at the boundary.

interface RawActivity {
  activityId: number;
  activityName?: string;
  startTimeLocal?: string;
  startTimeGMT?: string;
  duration?: number;
  movingDuration?: number;
  distance?: number;
  averageHR?: number;
  maxHR?: number;
  averageSpeed?: number;
  maxSpeed?: number;
  elevationGain?: number;
  elevationLoss?: number;
  calories?: number;
  steps?: number;
  lapCount?: number;
  activityType?: { typeKey?: string };
  splitSummaries?: RawSplit[];
}

interface RawSplit {
  distance?: number;
  duration?: number;
  movingDuration?: number;
  averageSpeed?: number;
  averageHR?: number;
  maxHR?: number;
  elevationGain?: number;
}

const RUN_TYPE_KEYS = new Set([
  "running",
  "street_running",
  "trail_running",
  "indoor_running",
  "treadmill_running",
  "track_running",
]);

const STRENGTH_TYPE_KEYS = new Set([
  "strength_training",
  "indoor_cardio", // Garmin's catch-all for non-run indoor sessions
]);

export function classifyActivity(activity: RawActivity): ActivityCategory {
  const typeKey = activity.activityType?.typeKey ?? "";
  if (RUN_TYPE_KEYS.has(typeKey)) return "run";
  if (STRENGTH_TYPE_KEYS.has(typeKey)) return "strength";
  return "other";
}

export interface ActivitySummary {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  startTimeGMT: string;
  category: ActivityCategory;
  durationSec: number;
  distanceM: number | null;
  averageHr: number | null;
  maxHr: number | null;
  /** Pace in seconds per kilometre (e.g. 339 = 5:39/km). null when no distance. */
  averagePaceSecPerKm: number | null;
  elevationGainM: number | null;
  calories: number | null;
}

function toSummary(a: RawActivity): ActivitySummary {
  const distanceM = typeof a.distance === "number" && a.distance > 0 ? a.distance : null;
  const durationSec = typeof a.duration === "number" ? Math.round(a.duration) : 0;
  const avgPaceSecPerKm =
    distanceM && distanceM > 0 && durationSec > 0
      ? Math.round(durationSec / (distanceM / 1000))
      : null;
  return {
    activityId: a.activityId,
    activityName: a.activityName ?? "Activity",
    startTimeLocal: a.startTimeLocal ?? "",
    startTimeGMT: a.startTimeGMT ?? "",
    category: classifyActivity(a),
    durationSec,
    distanceM,
    averageHr: typeof a.averageHR === "number" ? Math.round(a.averageHR) : null,
    maxHr: typeof a.maxHR === "number" ? Math.round(a.maxHR) : null,
    averagePaceSecPerKm: avgPaceSecPerKm,
    elevationGainM:
      typeof a.elevationGain === "number" ? Math.round(a.elevationGain) : null,
    calories: typeof a.calories === "number" ? Math.round(a.calories) : null,
  };
}

interface GarminAPI {
  getActivities(start?: number, limit?: number): Promise<unknown[]>;
  getActivity(args: { activityId: number }): Promise<unknown>;
}

/**
 * List recent activities. Filters to the given `date` (local YYYY-MM-DD).
 * Sorted ascending by start time so AM activities precede PM in pickers.
 */
export async function listActivitiesForDate(date: Date): Promise<ActivitySummary[]> {
  const client = (await getGarminClient()) as unknown as GarminAPI;
  const raw = (await client.getActivities(0, 20)) as RawActivity[];

  const targetKey = date.toISOString().slice(0, 10);
  const filtered = raw.filter((a) => {
    const sk = (a.startTimeLocal ?? "").slice(0, 10);
    return sk === targetKey;
  });

  return filtered
    .map(toSummary)
    .sort(
      (a, b) =>
        new Date(a.startTimeLocal).getTime() - new Date(b.startTimeLocal).getTime(),
    );
}

export interface SplitDetail {
  splitNumber: number;
  distanceM: number;
  durationSec: number;
  paceSecPerKm: number | null;
  averageHr: number | null;
  maxHr: number | null;
}

export interface ActivityDetail extends ActivitySummary {
  splits: SplitDetail[];
}

/**
 * Fetch one activity in detail (incl. split summaries).
 */
export async function getActivityDetail(activityId: number): Promise<ActivityDetail> {
  const client = (await getGarminClient()) as unknown as GarminAPI;
  const raw = (await client.getActivity({ activityId })) as RawActivity;

  const summary = toSummary(raw);

  const splits: SplitDetail[] = Array.isArray(raw.splitSummaries)
    ? raw.splitSummaries.map((s, i) => {
        const distanceM = typeof s.distance === "number" ? s.distance : 0;
        const durationSec =
          typeof s.duration === "number" ? Math.round(s.duration) : 0;
        const paceSecPerKm =
          distanceM > 0 && durationSec > 0
            ? Math.round(durationSec / (distanceM / 1000))
            : null;
        return {
          splitNumber: i + 1,
          distanceM,
          durationSec,
          paceSecPerKm,
          averageHr:
            typeof s.averageHR === "number" ? Math.round(s.averageHR) : null,
          maxHr: typeof s.maxHR === "number" ? Math.round(s.maxHR) : null,
        };
      })
    : [];

  return { ...summary, splits };
}
