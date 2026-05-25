// Garmin Activity fetch + classification.
// Separate from sync.ts (which does daily-sensor sync) — this is per-workout,
// triggered when the user finalises a session.
//
// All public methods are async (network I/O). Pure matching logic lives in
// `match.ts`.
import { toUserDateString } from "@/lib/date";
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
  // The list endpoint (getActivities) returns these flat. The single-activity
  // endpoint (getActivity) nests them inside summaryDTO + uses activityTypeDTO
  // instead of activityType. We normalise via `unwrapActivity` before reading.
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
  activityTypeDTO?: { typeKey?: string };
  summaryDTO?: {
    distance?: number;
    duration?: number;
    movingDuration?: number;
    averageHR?: number;
    maxHR?: number;
    averageSpeed?: number;
    maxSpeed?: number;
    elevationGain?: number;
    elevationLoss?: number;
    calories?: number;
    startTimeLocal?: string;
    startTimeGMT?: string;
  };
  splitSummaries?: RawSplit[];
}

/**
 * Normalise the two Garmin response shapes (list endpoint flat vs single-
 * activity endpoint with summaryDTO) into a single flat RawActivity. Top-
 * level fields win when present; otherwise we fall back to summaryDTO.
 *
 * Without this, getActivityDetail() persisted executedSession with null
 * distance/duration/HR even when Garmin had the data — see Sprint v1.5
 * follow-up "Garmin Importer Top-Level-Fields" (2026-05-25 incident).
 */
function unwrapActivity(a: RawActivity): RawActivity {
  if (!a.summaryDTO) return a;
  const s = a.summaryDTO;
  return {
    ...a,
    distance: a.distance ?? s.distance,
    duration: a.duration ?? s.duration,
    movingDuration: a.movingDuration ?? s.movingDuration,
    averageHR: a.averageHR ?? s.averageHR,
    maxHR: a.maxHR ?? s.maxHR,
    averageSpeed: a.averageSpeed ?? s.averageSpeed,
    maxSpeed: a.maxSpeed ?? s.maxSpeed,
    elevationGain: a.elevationGain ?? s.elevationGain,
    elevationLoss: a.elevationLoss ?? s.elevationLoss,
    calories: a.calories ?? s.calories,
    startTimeLocal: a.startTimeLocal ?? s.startTimeLocal,
    startTimeGMT: a.startTimeGMT ?? s.startTimeGMT,
    // activityTypeDTO is the single-endpoint variant; classifyActivity reads
    // activityType, so mirror the typeKey across.
    activityType: a.activityType ?? a.activityTypeDTO,
  };
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

  // Garmin's startTimeLocal is already in the user's local timezone.
  // Compare with Berlin date, not UTC — fixes UTC vs local mismatch.
  const targetKey = toUserDateString(date);
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
  const rawNested = (await client.getActivity({ activityId })) as RawActivity;
  // getActivity nests metrics inside summaryDTO; getActivities returns them
  // flat. Normalise so toSummary always sees the same shape.
  const raw = unwrapActivity(rawNested);

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

// ============================================
// HR Time-in-Zones per Activity (Sprint v0.7)
// ============================================
//
// Garmin reports each activity's HR distribution across its 5 zones, with
// per-zone seconds + the BPM floor that opens the zone. We pull this raw
// from the activity-service endpoint and let the engine map it to our 3-zone
// polarized scheme (see lib/coach-engine/hr-zones.ts mapGarminZonesToPolarizedTID).

export interface ActivityHrZones {
  zone1Sec: number;
  zone2Sec: number;
  zone3Sec: number;
  zone4Sec: number;
  zone5Sec: number;
  zoneFloors: { z1: number; z2: number; z3: number; z4: number; z5: number };
}

const GC_API_BASE = "https://connectapi.garmin.com";

interface RawHttpClient {
  get: <T>(url: string) => Promise<T>;
}

/**
 * Fetch HR-time-in-zones for one activity. Returns null on any error
 * (Garmin offline, no HR data, network) — caller falls back to plan-zone TID.
 */
export async function getActivityHrZones(
  activityId: number,
): Promise<ActivityHrZones | null> {
  try {
    const client = await getGarminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const raw: RawHttpClient = c.client ?? c._client ?? c.http;
    if (!raw || typeof raw.get !== "function") return null;

    const zones = await raw.get<
      Array<{ zoneNumber: number; secsInZone: number; zoneLowBoundary: number }>
    >(`${GC_API_BASE}/activity-service/activity/${activityId}/hrTimeInZones`);

    if (!Array.isArray(zones) || zones.length === 0) return null;

    const get = (n: number) => zones.find((z) => z.zoneNumber === n);
    return {
      zone1Sec: Math.round(get(1)?.secsInZone ?? 0),
      zone2Sec: Math.round(get(2)?.secsInZone ?? 0),
      zone3Sec: Math.round(get(3)?.secsInZone ?? 0),
      zone4Sec: Math.round(get(4)?.secsInZone ?? 0),
      zone5Sec: Math.round(get(5)?.secsInZone ?? 0),
      zoneFloors: {
        z1: get(1)?.zoneLowBoundary ?? 0,
        z2: get(2)?.zoneLowBoundary ?? 0,
        z3: get(3)?.zoneLowBoundary ?? 0,
        z4: get(4)?.zoneLowBoundary ?? 0,
        z5: get(5)?.zoneLowBoundary ?? 0,
      },
    };
  } catch (e) {
    console.error("[garmin-activity-hr-zones] failed:", e);
    return null;
  }
}
