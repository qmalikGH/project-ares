// VDOT inverse-lookup utilities (Sprint v0.6).
//
// Pure — math only, no I/O. Used by Block-Review test recording to derive
// VDOT from a measured 5k time, threshold split, or any race distance via
// Riegel. Forward-lookup (VDOT → paces) lives in run-coach/index.ts.
//
// References:
//   - Daniels J., "Daniels' Running Formula" 2nd ed., Tables 5.1 + 5.2.
//   - Riegel P., "Athletic Records and Human Endurance", American Scientist 1981.
//   - science_doc.md Kap 3.3 (VDOT methodology).
//
// Why a separate module: the run-coach VDOT_TABLE is keyed for forward usage
// (VDOT → easy/T/I/R paces). For reverse mapping we need point estimates of
// 5k time and T-pace per VDOT — same source, separate concern, easier to test.

/**
 * Daniels VDOT → 5000 m race time, in seconds.
 * Values from Daniels' Running Formula 2nd ed., Table 5.1.
 * Covers Q's realistic band (24:30 → 22:00 → 20:00 = VDOT 38 → 42 → 47).
 */
export const VDOT_TO_5K_SEC: Record<number, number> = {
  30: 30 * 60 + 40, // 30:40
  31: 29 * 60 + 51,
  32: 29 * 60 + 5,
  33: 28 * 60 + 21,
  34: 27 * 60 + 39,
  35: 26 * 60 + 22, // 26:22
  36: 25 * 60 + 46,
  37: 25 * 60 + 12,
  38: 24 * 60 + 39,
  39: 24 * 60 + 8,
  40: 23 * 60 + 38, // 23:38
  41: 23 * 60 + 9,
  42: 22 * 60 + 41,
  43: 22 * 60 + 15,
  44: 21 * 60 + 50,
  45: 21 * 60 + 25, // 21:25
  46: 21 * 60 + 2,
  47: 20 * 60 + 39,
  48: 20 * 60 + 18,
  49: 19 * 60 + 57,
  50: 19 * 60 + 36, // 19:36
  51: 19 * 60 + 17,
  52: 18 * 60 + 58,
  53: 18 * 60 + 40,
  54: 18 * 60 + 22,
  55: 18 * 60 + 5, // 18:05
  56: 17 * 60 + 49,
  57: 17 * 60 + 33,
  58: 17 * 60 + 17,
  59: 17 * 60 + 3,
  60: 16 * 60 + 48,
};

/**
 * Daniels VDOT → Threshold (T) pace, sec/km.
 * T-pace ≈ comfortably hard, 88-92% HRmax (LT2 proxy).
 *
 * Values mirror the run-coach VDOT_TABLE T column verbatim so forward
 * (VDOT → pace) and reverse (pace → VDOT) lookups are consistent.
 * Source: Daniels' Running Formula 2nd ed., Table 5.2 — abbreviated.
 */
export const VDOT_TO_T_PACE_SEC: Record<number, number> = {
  35: 5 * 60 + 31, // 5:31/km
  36: 5 * 60 + 25,
  37: 5 * 60 + 18,
  38: 5 * 60 + 12,
  39: 5 * 60 + 6,
  40: 5 * 60 + 0,
  41: 4 * 60 + 54,
  42: 4 * 60 + 45,
  43: 4 * 60 + 38,
  44: 4 * 60 + 32,
  45: 4 * 60 + 27,
  46: 4 * 60 + 21,
  47: 4 * 60 + 16,
  48: 4 * 60 + 11,
  49: 4 * 60 + 6,
  50: 4 * 60 + 1,
  55: 3 * 60 + 42,
};

/**
 * Interpolate VDOT from a measured 5k time (seconds).
 * Returns a fractional VDOT (the table is integer-keyed; we linear-interpolate
 * between adjacent integer entries so a 5k of 22:00 maps to ~42.55, not 42 or 43).
 *
 * Outside the table band: clamped to nearest table key.
 */
export function vdotFrom5k(seconds: number): number {
  return invertTable(VDOT_TO_5K_SEC, seconds);
}

/**
 * Interpolate VDOT from a measured Threshold-pace (sec/km).
 * Q runs a sustained ~5k-equivalent threshold split → infer VDOT directly.
 *
 * The T-pace table mirrors run-coach VDOT_TABLE (range 35-55) so forward and
 * reverse lookups stay consistent. Out-of-band paces clamp to the nearest key.
 */
export function vdotFromTPace(secPerKm: number): number {
  return invertTable(VDOT_TO_T_PACE_SEC, secPerKm);
}

/**
 * Riegel race-equivalence: predict time at distance B from a known time at A.
 * timeB = timeA × (distB / distA) ^ 1.06
 *
 * Distances in meters, times in seconds. The exponent 1.06 is Riegel's
 * empirical fit; valid for distances roughly 1k → marathon for trained runners.
 * For wildly extrapolated cases (5k → 100m sprint) the formula breaks down —
 * caller's responsibility to stay in band.
 */
export function riegelEquivalent(
  distA: number,
  timeA: number,
  distB: number,
): number {
  if (distA <= 0 || timeA <= 0 || distB <= 0) {
    throw new Error("riegelEquivalent: distances and times must be > 0");
  }
  return timeA * Math.pow(distB / distA, 1.06);
}

/**
 * Linear interpolation against an integer-keyed monotonic table.
 * Table values must be DESCENDING with key (faster pace / time = higher VDOT).
 * Out-of-band measurements clamp to the nearest table key.
 */
function invertTable(
  table: Record<number, number>,
  measured: number,
): number {
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);

  if (measured >= table[keys[0]]) return keys[0];
  if (measured <= table[keys[keys.length - 1]]) return keys[keys.length - 1];

  // Find the bracket [k_low, k_high] where the measurement falls.
  for (let i = 0; i < keys.length - 1; i++) {
    const kLow = keys[i];
    const kHigh = keys[i + 1];
    const vLow = table[kLow]; // larger (slower)
    const vHigh = table[kHigh]; // smaller (faster)
    if (measured <= vLow && measured >= vHigh) {
      // Linear interp: as measured drops from vLow → vHigh, VDOT rises kLow → kHigh.
      const frac = (vLow - measured) / (vLow - vHigh);
      return Math.round((kLow + frac * (kHigh - kLow)) * 10) / 10;
    }
  }
  // Should be unreachable given the bound checks above.
  return keys[0];
}
