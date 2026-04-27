// HR-Zone-based TID (Karvonen Heart Rate Reserve method).
// Pure — math only, no DB, no I/O. Easy to test.
//
// See science_doc.md Kap 3 + 6.4:
//   - Polarized training (Casado 2022): Z1 sub-LT1, Z2 LT1-LT2, Z3 supra-LT2
//   - Karvonen 1957: target HR = HRrest + (% × HRR), where HRR = HRmax - HRrest
//
// Why not Garmin's 5-zone defaults: those use 220-age heuristic and miss the
// individual LT1/LT2 break points. User-specific HRR-based 3 zones map cleanly
// to TID polarization without external recalibration.
import { z } from "zod";

export const HrThresholdsSchema = z.object({
  hrMax: z.number().int().min(120).max(220),
  hrRest: z.number().int().min(30).max(90),
});

export type HrThresholds = z.infer<typeof HrThresholdsSchema>;

export interface HrZones {
  /** Upper bound of Z1 (Z1/Z2 transition). HR at this value belongs to Z2. */
  z1Max: number;
  /** Upper bound of Z2 (Z2/Z3 transition). HR at this value belongs to Z3. */
  z2Max: number;
  hrMax: number;
  hrRest: number;
}

const Z1_FRACTION_OF_HRR = 0.75; // LT1 proxy
const Z2_FRACTION_OF_HRR = 0.87; // LT2 proxy
const MIN_HR_SPREAD = 30; // sane minimum HRmax - HRrest

/**
 * Compute Z1/Z2/Z3 thresholds via Karvonen HRR.
 * Throws if thresholds are out of range or spread too small.
 */
export function computeHrZones(thresholds: HrThresholds): HrZones {
  const { hrMax, hrRest } = HrThresholdsSchema.parse(thresholds);
  if (hrMax - hrRest < MIN_HR_SPREAD) {
    throw new Error(
      `HRmax - HRrest spread ${hrMax - hrRest} is too small (min ${MIN_HR_SPREAD})`,
    );
  }
  const hrr = hrMax - hrRest;
  return {
    z1Max: Math.round(hrRest + Z1_FRACTION_OF_HRR * hrr),
    z2Max: Math.round(hrRest + Z2_FRACTION_OF_HRR * hrr),
    hrMax,
    hrRest,
  };
}

/**
 * Classify a heart-rate value into Z1/Z2/Z3.
 * Returns null when HR is missing (split with no data).
 *
 * Boundary convention: z1Max is inclusive of Z1, value AT z1Max → Z1.
 * Wait — design says z1Max is "upper bound of Z1, exclusive" so HR = z1Max → Z2.
 * We use `<=` for z1 to keep the integer boundary crisp (avoids gaps on rounded
 * thresholds). Test verifies boundary behavior.
 */
export function classifyHrZone(hr: number | null, zones: HrZones): 1 | 2 | 3 | null {
  if (hr === null) return null;
  if (hr <= zones.z1Max) return 1;
  if (hr <= zones.z2Max) return 2;
  return 3;
}

export interface SplitForTID {
  durationSec: number;
  averageHr: number | null;
}

export interface HrTID {
  z1Sec: number;
  z2Sec: number;
  z3Sec: number;
  /** Time from splits with no HR data — surfaced transparently, not silently dropped. */
  unclassifiedSec: number;
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
  totalSec: number;
}

/**
 * Aggregate HR-classified time across multiple splits.
 * Percentages are computed against the CLASSIFIED total (z1+z2+z3), so a session
 * that's 50% Z1 and 50% no-data shows as 100% Z1 with unclassifiedSec preserved
 * in the meta — caller decides how to surface that.
 */
export function computeHrTID(splits: SplitForTID[], zones: HrZones): HrTID {
  let z1Sec = 0;
  let z2Sec = 0;
  let z3Sec = 0;
  let unclassifiedSec = 0;
  for (const split of splits) {
    const zone = classifyHrZone(split.averageHr, zones);
    if (zone === 1) z1Sec += split.durationSec;
    else if (zone === 2) z2Sec += split.durationSec;
    else if (zone === 3) z3Sec += split.durationSec;
    else unclassifiedSec += split.durationSec;
  }
  const classified = z1Sec + z2Sec + z3Sec;
  const totalSec = classified + unclassifiedSec;
  return {
    z1Sec,
    z2Sec,
    z3Sec,
    unclassifiedSec,
    z1Pct: classified > 0 ? (z1Sec / classified) * 100 : 0,
    z2Pct: classified > 0 ? (z2Sec / classified) * 100 : 0,
    z3Pct: classified > 0 ? (z3Sec / classified) * 100 : 0,
    totalSec,
  };
}

// ============================================
// Garmin 5-zones → Polarized 3-zones (Sprint v0.7)
// ============================================
//
// Garmin reports activity time-in-zone across 5 buckets (Z1=warm-up, Z2=easy,
// Z3=aerobic, Z4=threshold, Z5=max). Our polarized model (Casado 2022) only
// distinguishes three buckets:
//
//   Polarized Z1 (Easy, sub-LT1)   ←  Garmin Z1 + Z2
//   Polarized Z2 (Threshold)        ←  Garmin Z3 + Z4
//   Polarized Z3 (VO2max+)          ←  Garmin Z5
//
// Mapping rationale: Garmin Z1+Z2 are both below LT1 in their default 5-zone
// scheme (50–70% HRmax), so both belong in Easy. Z3+Z4 span aerobic-threshold
// to anaerobic-threshold — both count as Threshold for polarized accounting.
// Z5 is supra-VO2max (≥90% HRmax) → Z3 in polarized.

export interface PolarizedTID {
  z1Sec: number;
  z2Sec: number;
  z3Sec: number;
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
  totalSec: number;
}

export interface GarminFiveZoneActivity {
  zone1Sec: number;
  zone2Sec: number;
  zone3Sec: number;
  zone4Sec: number;
  zone5Sec: number;
}

export function mapGarminZonesToPolarizedTID(
  z: GarminFiveZoneActivity,
): PolarizedTID {
  const z1Sec = z.zone1Sec + z.zone2Sec;
  const z2Sec = z.zone3Sec + z.zone4Sec;
  const z3Sec = z.zone5Sec;
  const total = z1Sec + z2Sec + z3Sec;
  return {
    z1Sec,
    z2Sec,
    z3Sec,
    totalSec: total,
    z1Pct: total > 0 ? (z1Sec / total) * 100 : 0,
    z2Pct: total > 0 ? (z2Sec / total) * 100 : 0,
    z3Pct: total > 0 ? (z3Sec / total) * 100 : 0,
  };
}
