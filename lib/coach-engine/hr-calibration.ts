// HR calibration — Sprint v1.9 #4 (first piece of the Sprint 2.0 auto-calibration
// system; built forward-compatible, NOT throwaway).
//
// Recomputes resting HR (hrRest) from a rolling, smoothed Garmin daily-RHR
// signal. Karvonen zones (lib/coach-engine/hr-zones.ts) derive from hrRest, so
// updating it auto-refreshes z1/z2 ceilings + run HR targets.
//
// Scope guard: HRmax is NOT touched here (needs observed-max / raise-only logic
// → Sprint 2.0). Manual overrides (hrZonesSource = "manual") are respected.

import { db } from "@/lib/db/client";

export const HR_CALIBRATION_WINDOW_DAYS = 28;
export const HR_MIN_SAMPLES = 7;
/** Plausible resting-HR band — excludes Garmin glitches / non-wear artifacts. */
export const RHR_PLAUSIBLE_MIN = 30;
export const RHR_PLAUSIBLE_MAX = 90;

/**
 * Pure: smoothed resting HR = MEDIAN of plausible daily RHR samples (median is
 * robust to the occasional spike, unlike the mean). Returns null when fewer
 * than HR_MIN_SAMPLES valid samples exist (caller keeps the existing hrRest).
 */
export function rollingRestingHr(rhrValues: (number | null | undefined)[]): number | null {
  const clean = rhrValues.filter(
    (v): v is number => typeof v === "number" && v >= RHR_PLAUSIBLE_MIN && v <= RHR_PLAUSIBLE_MAX,
  );
  if (clean.length < HR_MIN_SAMPLES) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type HrRecalibrationStatus =
  | "updated"
  | "unchanged"
  | "insufficient_data"
  | "manual_override"
  | "no_user_settings";

export interface HrRecalibrationResult {
  status: HrRecalibrationStatus;
  hrRest?: number;
  previous?: number | null;
  samples?: number;
}

/**
 * Recompute + persist hrRest from the rolling Garmin RHR median. Skips manual
 * overrides and no-ops when the median is unchanged. Karvonen zones recompute
 * downstream automatically (computeHrZones reads hrRest).
 */
export async function recalibrateHrRest(userId: string): Promise<HrRecalibrationResult> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: { hrRest: true, hrZonesSource: true },
  });
  if (!settings) return { status: "no_user_settings" };
  if (settings.hrZonesSource === "manual") {
    return { status: "manual_override", previous: settings.hrRest };
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - HR_CALIBRATION_WINDOW_DAYS);
  const rows = await db.dailySensorData.findMany({
    where: { userId, date: { gte: cutoff } },
    select: { garmin: true },
  });
  const rhrValues = rows.map((r) => (r.garmin as { rhr?: number } | null)?.rhr);
  const samples = rhrValues.filter((v) => typeof v === "number").length;

  const median = rollingRestingHr(rhrValues);
  if (median === null) return { status: "insufficient_data", samples, previous: settings.hrRest };
  if (median === settings.hrRest) return { status: "unchanged", hrRest: median, samples, previous: settings.hrRest };

  await db.userSettings.update({
    where: { userId },
    data: {
      hrRest: median,
      hrZonesUpdatedAt: new Date(),
      hrZonesSource: "garmin_rolling_28d",
    },
  });
  return { status: "updated", hrRest: median, samples, previous: settings.hrRest };
}
