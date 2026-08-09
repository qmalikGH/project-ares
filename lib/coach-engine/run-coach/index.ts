// LaufCoachLogic — VDOT paces + weekly run plan generation
// See science_doc.md Kap 3.3 (Daniels VDOT) & spec 6.2.
// Pure functions.

import type {
  BlockNumber,
  PhaseConfig,
  SessionPlan,
  SessionType,
  VDOTPaces,
  W1CalibrationRunData,
  VDOTCalibrationResult,
  WeekRunPlan,
} from "../types";
import {
  weekInBlockOf,
  type WeekInBlock,
} from "../strength-coach/periodization";
import { rampFor, type ComebackWeek } from "../comeback";
import { PRE_RUN_ACTIVATION, ACTIVATION_DURATION_MIN } from "./activation";

// ============================================
// VDOT → Pace lookup
// ============================================
// Daniels' Running Formula table, abbreviated for the VDOT band 35-55.
// Paces in min:sec / km. From Daniels' tables (2014 ed.) — see science_doc.md Kap 3.3.
//
// E (Easy) pace is given as a band (slow→fast); M, T, I, R are point targets.
const VDOT_TABLE: Record<number, VDOTPaces> = {
  35: { E: { from: "6:30", to: "7:10" }, M: "5:48", T: "5:31", I: "5:00", R: "4:39" },
  36: { E: { from: "6:25", to: "7:00" }, M: "5:41", T: "5:25", I: "4:54", R: "4:33" },
  37: { E: { from: "6:18", to: "6:53" }, M: "5:35", T: "5:18", I: "4:47", R: "4:27" },
  38: { E: { from: "6:11", to: "6:45" }, M: "5:28", T: "5:12", I: "4:41", R: "4:20" },
  39: { E: { from: "6:05", to: "6:38" }, M: "5:22", T: "5:06", I: "4:35", R: "4:14" },
  40: { E: { from: "5:58", to: "6:31" }, M: "5:16", T: "5:00", I: "4:30", R: "4:08" },
  41: { E: { from: "5:52", to: "6:24" }, M: "5:10", T: "4:54", I: "4:25", R: "4:04" },
  42: { E: { from: "5:45", to: "6:15" }, M: "5:05", T: "4:45", I: "4:15", R: "4:00" },
  43: { E: { from: "5:40", to: "6:09" }, M: "4:59", T: "4:38", I: "4:10", R: "3:55" },
  44: { E: { from: "5:34", to: "6:03" }, M: "4:53", T: "4:32", I: "4:05", R: "3:50" },
  45: { E: { from: "5:28", to: "5:56" }, M: "4:48", T: "4:27", I: "4:00", R: "3:45" },
  46: { E: { from: "5:23", to: "5:50" }, M: "4:43", T: "4:21", I: "3:55", R: "3:41" },
  47: { E: { from: "5:18", to: "5:45" }, M: "4:38", T: "4:16", I: "3:51", R: "3:37" },
  48: { E: { from: "5:13", to: "5:39" }, M: "4:33", T: "4:11", I: "3:46", R: "3:32" },
  49: { E: { from: "5:08", to: "5:34" }, M: "4:28", T: "4:06", I: "3:42", R: "3:28" },
  50: { E: { from: "5:03", to: "5:28" }, M: "4:24", T: "4:01", I: "3:38", R: "3:24" },
  55: { E: { from: "4:42", to: "5:05" }, M: "4:03", T: "3:42", I: "3:21", R: "3:08" },
};

/**
 * Look up VDOT pace bundle. Falls back to nearest known VDOT if exact key
 * is missing. Throws for nonsense values (<25 or >65).
 */
export function vdotToPaces(vdot: number): VDOTPaces {
  if (!Number.isFinite(vdot) || vdot < 25 || vdot > 65) {
    throw new Error(`vdotToPaces: vdot out of supported range: ${vdot}`);
  }
  const rounded = Math.round(vdot);
  if (VDOT_TABLE[rounded]) return VDOT_TABLE[rounded];

  // Find nearest available
  const keys = Object.keys(VDOT_TABLE).map(Number).sort((a, b) => a - b);
  let nearest = keys[0];
  let minDiff = Math.abs(rounded - nearest);
  for (const k of keys) {
    const d = Math.abs(rounded - k);
    if (d < minDiff) {
      minDiff = d;
      nearest = k;
    }
  }
  return VDOT_TABLE[nearest];
}

/**
 * Daniels approx: pace_at_VO2max (min/km) ≈ ~1000 / (vdot * factor).
 * We re-use the table by extracting Easy upper-bound for "expected easy pace".
 */
export function vdotToEasyPace(vdot: number): number {
  const paces = vdotToPaces(vdot);
  return paceStringToMinPerKm(paces.E.to); // upper bound = slower easy
}

// ============================================
// Pace conversion helpers
// ============================================
export function paceStringToMinPerKm(pace: string): number {
  const [min, sec] = pace.split(":").map(Number);
  return min + sec / 60;
}

export function minPerKmToPaceString(value: number): string {
  const totalSec = Math.round(value * 60);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// ============================================
// W1 Auto-Calibration
// ============================================
/**
 * If the W1 calibration run pace deviates >5% from the expected pace
 * for `initialVdot`, and RPE is not 5/10 (which would indicate "as expected"),
 * adjust VDOT proportionally and emit notification.
 *
 * See spec 6.1 + science_doc.md Kap 3.3 for VDOT calibration rationale.
 */
export function calibrateVDOTFromW1(
  initialVdot: number,
  w1Run: W1CalibrationRunData,
): VDOTCalibrationResult {
  if (w1Run.distanceKm <= 0) {
    return { calibratedVdot: initialVdot, pacesUpdated: false, notification: "" };
  }

  const observedPace = w1Run.durationMin / w1Run.distanceKm; // min/km
  const expectedPace = vdotToEasyPace(initialVdot);
  const deviation = (observedPace - expectedPace) / expectedPace;

  // Only calibrate if deviation > 5% AND RPE ≠ 5 (5 = "felt right")
  if (Math.abs(deviation) <= 0.05 || w1Run.rpe === 5) {
    return { calibratedVdot: initialVdot, pacesUpdated: false, notification: "" };
  }

  // Faster than expected (deviation negative) AND RPE low → bump VDOT up
  // Slower than expected (deviation positive) AND RPE high → drop VDOT down
  // Use rough approximation: 1 VDOT point ≈ 5% pace change.
  let vdotDelta = 0;
  if (deviation < -0.05 && w1Run.rpe <= 5) {
    vdotDelta = Math.round(-deviation / 0.05);
  } else if (deviation > 0.05 && w1Run.rpe >= 5) {
    vdotDelta = -Math.round(deviation / 0.05);
  }

  const calibratedVdot = initialVdot + vdotDelta;
  if (calibratedVdot === initialVdot) {
    return { calibratedVdot: initialVdot, pacesUpdated: false, notification: "" };
  }

  return {
    calibratedVdot,
    pacesUpdated: true,
    notification:
      `VDOT von ${initialVdot} auf ${calibratedVdot} angepasst basierend auf ` +
      `W1-Kalibrierung (Pace ${minPerKmToPaceString(observedPace)}/km, RPE ${w1Run.rpe}). ` +
      `Pace-Targets aktualisiert für alle nachfolgenden Wochen.`,
  };
}

// ============================================
// Long-Run Progression
// ============================================
export interface LongRunSpec {
  durationMin: number;
  intensityZone: 1 | 2;
  notes?: string;
}

/**
 * Long-run duration ramp by block. Spec 6.1 gives Block 1: 50→60→70.
 * Within a block, weeks 1-3 progress, week 4 is a deload (90% of week 3).
 * Block 5 follows the taper schedule from spec.
 */
export function generateLongRunProgression(weekNumber: number, blockNumber: BlockNumber): LongRunSpec {
  const inBlockWeek = ((weekNumber - 1) % 4) + 1; // 1-4
  const baseByBlock: Record<BlockNumber, number> = {
    1: 50,
    2: 65,
    3: 75,
    4: 75,
    5: 60,
  };
  const incrementPerWeek = blockNumber === 5 ? -10 : 10;

  let durationMin: number;
  if (inBlockWeek === 4 && blockNumber !== 5) {
    // Deload week: 90% of week 3's value
    const week3Value = baseByBlock[blockNumber] + incrementPerWeek * 2;
    durationMin = Math.round(week3Value * 0.9);
  } else {
    durationMin = baseByBlock[blockNumber] + incrementPerWeek * (inBlockWeek - 1);
  }

  // Block 5: W18 and W20 are time-trial weeks, no long run
  if (blockNumber === 5 && (inBlockWeek === 2 || inBlockWeek === 4)) {
    return { durationMin: 0, intensityZone: 1, notes: "Time Trial week — no long run" };
  }

  const intensityZone: 1 | 2 = blockNumber >= 3 ? 2 : 1; // progressive Z2 in later blocks
  return {
    durationMin: Math.max(durationMin, 30),
    intensityZone,
    notes: blockNumber === 1 ? "FLACH (knee-friendly)" : undefined,
  };
}

// ============================================
// Week run plan
// ============================================
function emptySession(date: Date, type: "rest" | "active_recovery"): SessionPlan {
  return { date, type };
}

// ============================================
// HR-First helpers (Sprint v0.7)
// ============================================
//
// HR is the verbindlich primary control variable; pace is orientierend.
// Targets are derived from each user's HRmax/HRrest via Karvonen HRR ranges
// per session-type (see science_doc Kap 6.4).

export interface HrTargetParams {
  sessionType: SessionType;
  hrMax: number;
  hrRest: number;
}

const HR_FRACTIONS_BY_TYPE: Partial<
  Record<SessionType, { from: number; to: number }>
> = {
  easy_run: { from: 0.6, to: 0.75 },
  long_run: { from: 0.6, to: 0.75 },
  active_recovery: { from: 0.55, to: 0.7 },
  tempo_run: { from: 0.75, to: 0.83 },
  threshold_run: { from: 0.78, to: 0.87 },
  vo2max_intervals: { from: 0.87, to: 0.95 },
  calibration_run: { from: 0.55, to: 0.7 },
};

export function getHrTargetForSession(
  params: HrTargetParams,
): { from: number; to: number } | null {
  const fr = HR_FRACTIONS_BY_TYPE[params.sessionType];
  if (!fr) return null;
  const hrr = params.hrMax - params.hrRest;
  return {
    from: Math.round(params.hrRest + fr.from * hrr),
    to: Math.round(params.hrRest + fr.to * hrr),
  };
}

interface HrCtx {
  hrMax?: number;
  hrRest?: number;
}

function withHrTarget(
  session: SessionPlan,
  type: SessionType,
  hr: HrCtx,
): SessionPlan {
  if (!hr.hrMax || !hr.hrRest) return session;
  const target = getHrTargetForSession({
    sessionType: type,
    hrMax: hr.hrMax,
    hrRest: hr.hrRest,
  });
  if (!target) return session;
  return { ...session, hrTarget: target, controlMethod: "hr_first" };
}

/**
 * Sprint v0.11: human-readable polarized-zone label for UI display.
 * Replaces the misleading bare "Zone 1/2/3" — the engine still uses
 * `intensityZone` numerically (1|2|3), but the UI now shows what each
 * zone *means* in the 3-zone polarized framework (Casado 2022, Seiler 2010):
 *
 *   Z1 (sub-LT1)        — Easy / Long Run / Recovery / Calibration
 *   Z2 (LT1-LT2)        — Threshold / Tempo (lactate steady-state)
 *   Z3 (supra-LT2)      — VO2max intervals / Time Trial
 *
 * Returns "" for non-run types (the UI then falls back to the strength label).
 */
export function getZoneLabel(type: SessionType): string {
  switch (type) {
    case "easy_run":
    case "long_run":
    case "active_recovery":
    case "calibration_run":
      return "Z1 · Easy (sub-LT1)";
    case "threshold_run":
    case "tempo_run":
      return "Z2 · Threshold (LT1-LT2)";
    case "vo2max_intervals":
    case "time_trial_5k":
      return "Z3 · VO2max (supra-LT2)";
    default:
      return "";
  }
}

// ============================================
// Session builders
// ============================================
function easyRun(
  date: Date,
  durationMin: number,
  paces: VDOTPaces,
  hr: HrCtx = {},
): SessionPlan {
  return withHrTarget(
    {
      date,
      type: "easy_run",
      durationMin,
      paceTarget: paces.E,
      intensityZone: 1,
      zoneLabel: getZoneLabel("easy_run"),
      rpeTarget: 4,
    },
    "easy_run",
    hr,
  );
}

/**
 * Sprint 2.2 — Threshold structure ladder. Threshold progresses via MORE/LONGER
 * work blocks (capped total threshold time ~20–30 min), NOT via growing session
 * duration. Threshold is the quality day for blocks 1–3.
 *
 * Ladder: 2×10 → 3×8 → 3×10 → 2×15 (threshold time 20 → 24 → 30 → 30 min).
 * Deload week (weekInBlock 4) → reduced 2×8, no progression anchor.
 * Gate: when `greenForProgression` is false (shin NRS > 3 or RHR over baseline),
 * clamp to the conservative 2×10 floor regardless of block/week.
 *
 * Pure — warmup/cooldown fixed at 12/8 min (Q's conservative shins-safe frame).
 */
export interface ThresholdLevel {
  warmupMin: number;
  cooldownMin: number;
  reps: number;
  workMin: number;
  restMin: number;
}

export function thresholdStructureFor(
  blockNumber: number,
  weekInBlock: number,
  greenForProgression: boolean,
): ThresholdLevel {
  const WU = 12;
  const CD = 8;
  // Deload week → reduced volume, no anchor.
  if (weekInBlock === 4) return { warmupMin: WU, cooldownMin: CD, reps: 2, workMin: 8, restMin: 2 };
  // Not green → conservative 2×10 floor (shin/RHR protective).
  if (!greenForProgression) return { warmupMin: WU, cooldownMin: CD, reps: 2, workMin: 10, restMin: 2 };

  // Ladder levels (threshold time capped at ~30 min).
  const L0 = { reps: 2, workMin: 10, restMin: 2 }; // 20 min
  const L1 = { reps: 3, workMin: 8, restMin: 2 }; // 24 min
  const L2 = { reps: 3, workMin: 10, restMin: 3 }; // 30 min
  const L3 = { reps: 2, workMin: 15, restMin: 3 }; // 30 min

  let lvl: { reps: number; workMin: number; restMin: number };
  if (blockNumber <= 1) lvl = weekInBlock <= 2 ? L0 : L1; // B1: W1-2 2×10, W3 3×8
  else if (blockNumber === 2) lvl = weekInBlock === 1 ? L1 : L2; // B2: W1 3×8, W2-3 3×10
  else lvl = weekInBlock === 1 ? L2 : L3; // B3: W1 3×10, W2-3 2×15

  return { warmupMin: WU, cooldownMin: CD, ...lvl };
}

/** Total session minutes implied by a threshold level (= Σ structure). */
export function thresholdDurationMin(level: ThresholdLevel): number {
  return level.warmupMin + level.reps * (level.workMin + level.restMin) + level.cooldownMin;
}

function thresholdRun(
  date: Date,
  level: ThresholdLevel,
  paces: VDOTPaces,
  hr: HrCtx = {},
): SessionPlan {
  // Sprint 2.2: durationMin is DERIVED from the structure (no more ballooning
  // session length). Watch + app render the SAME segments from `structure`.
  return withHrTarget(
    {
      date,
      type: "threshold_run",
      durationMin: thresholdDurationMin(level),
      paceTarget: { from: paces.T, to: paces.T },
      intensityZone: 2,
      zoneLabel: getZoneLabel("threshold_run"),
      rpeTarget: 7,
      structure: {
        warmupMin: level.warmupMin,
        workIntervals: [
          {
            repeats: level.reps,
            durationMin: level.workMin,
            paceTarget: { from: paces.T, to: paces.T },
            restMin: level.restMin,
          },
        ],
        cooldownMin: level.cooldownMin,
      },
    },
    "threshold_run",
    hr,
  );
}

function vo2maxIntervals(
  date: Date,
  paces: VDOTPaces,
  hr: HrCtx = {},
): SessionPlan {
  return withHrTarget(
    {
      date,
      type: "vo2max_intervals",
      durationMin: 50,
      paceTarget: { from: paces.I, to: paces.I },
      intensityZone: 3,
      zoneLabel: getZoneLabel("vo2max_intervals"),
      rpeTarget: 9,
      structure: {
        warmupMin: 15,
        workIntervals: [{ repeats: 5, durationMin: 3, paceTarget: { from: paces.I, to: paces.I }, restMin: 2 }],
        cooldownMin: 10,
      },
    },
    "vo2max_intervals",
    hr,
  );
}

function longRun(
  date: Date,
  durationMin: number,
  intensityZone: 1 | 2,
  paces: VDOTPaces,
  hr: HrCtx = {},
): SessionPlan {
  return withHrTarget(
    {
      date,
      type: "long_run",
      durationMin,
      paceTarget: paces.E,
      intensityZone,
      zoneLabel:
        intensityZone === 2
          ? getZoneLabel("threshold_run")
          : getZoneLabel("long_run"),
      rpeTarget: intensityZone === 2 ? 6 : 4,
    },
    "long_run",
    hr,
  );
}

/**
 * Generate week run plan based on phase config.
 * Day mapping (date offset from `weekStartDate`, 0=Monday):
 *   Mon Easy AM, Tue Quality, Wed Easy AM, Thu Rest, Fri Easy AM, Sat Long, Sun Rest
 */
// ============================================
// Run Volume Progression (Sprint v0.10)
// ============================================
//
// 4-week 3:1 pattern parallel to strength-coach periodization.
//   W1 Adaptation:  baseline (1.0x all)
//   W2 Build 1:     long +10%, quality +5%, easy 1.0x
//   W3 Peak:        long +20%, quality +10%, easy 1.0x
//   W4 Deload:      long -25%, quality -30%, easy -15%
//
// Pure: input weekInBlock, output multipliers + rationale.

export interface RunVolumeProgression {
  longRunMultiplier: number;
  qualityRunMultiplier: number;
  easyRunMultiplier: number;
  rationale: string;
}

export function computeRunVolumeProgression(
  weekInBlock: WeekInBlock,
  blockNumber: number = 1,
): RunVolumeProgression {
  // Sprint v0.12: Block 1 uses a more conservative ramp because the runner
  // is still building MTSS-resilience (Pillai 2025: training-volume is the
  // dominant shin-splint risk factor, RR 1.15 per 10% jump). Block 2+ is
  // standard progression.
  if (blockNumber === 1) {
    switch (weekInBlock) {
      case 1:
        return {
          longRunMultiplier: 1.0,
          qualityRunMultiplier: 1.0,
          easyRunMultiplier: 1.0,
          rationale: "W1 Adaptation: baseline volume.",
        };
      case 2:
        return {
          longRunMultiplier: 1.05,
          qualityRunMultiplier: 1.0,
          easyRunMultiplier: 1.0,
          rationale: "W2 Build 1 (Block 1 conservative): long +5%.",
        };
      case 3:
        return {
          longRunMultiplier: 1.1,
          qualityRunMultiplier: 1.05,
          easyRunMultiplier: 1.0,
          rationale: "W3 Peak (Block 1 conservative): long +10%, quality +5%.",
        };
      case 4:
        return {
          longRunMultiplier: 0.8,
          qualityRunMultiplier: 0.75,
          easyRunMultiplier: 0.85,
          rationale: "W4 Deload: long -20%, quality -25%, easy -15%.",
        };
    }
  }

  // Block 2+: standard progression.
  switch (weekInBlock) {
    case 1:
      return {
        longRunMultiplier: 1.0,
        qualityRunMultiplier: 1.0,
        easyRunMultiplier: 1.0,
        rationale: "W1 Adaptation: baseline volume.",
      };
    case 2:
      return {
        longRunMultiplier: 1.1,
        qualityRunMultiplier: 1.05,
        easyRunMultiplier: 1.0,
        rationale: "W2 Build 1: long run +10%, quality +5%.",
      };
    case 3:
      return {
        longRunMultiplier: 1.15,
        qualityRunMultiplier: 1.1,
        easyRunMultiplier: 1.0,
        rationale: "W3 Peak: long run +15%, quality +10%.",
      };
    case 4:
      return {
        longRunMultiplier: 0.75,
        qualityRunMultiplier: 0.7,
        easyRunMultiplier: 0.85,
        rationale: "W4 Deload: long run -25%, quality -30%, easy -15%.",
      };
  }
}

export function generateWeekRunPlan(
  phaseConfig: PhaseConfig,
  weekNumber: number,
  vdot: number,
  weekStartDate: Date,
  hrCtx?: { hrMax?: number; hrRest?: number },
  /** Sprint v1.5 follow-up: when set, this WeeklyPlan was created via
   *  resetBlock (post-illness ramp-up) and the athlete already has a
   *  calibrated VDOT → skip the calibration run, use a normal Threshold-
   *  Run on Tuesday instead. null/undefined = default (calibration as usual). */
  loadOverrideWeek?: 1 | 2 | 3 | 4 | null,
  /** Sprint 2.2: gate for threshold structural progression. When false
   *  (recent shin NRS > 3 or RHR over baseline+5), the threshold day is
   *  clamped to the conservative 2×10 floor. Default true = progress per
   *  the block/week ladder. Computed by the regenerate path from real data. */
  greenForProgression: boolean = true,
  /** Sprint 2.3: graded run-volume pain governor from the worst shin-NRS of
   *  the recent run week:
   *    "progress" (≤2) → normal volume + threshold per ladder,
   *    "hold" (3)      → normal volume + threshold floor (via greenForProgression=false),
   *    "regress" (≥4)  → −20% run volume + quality day replaced by an easy run.
   *  null/undefined → no modulation (treated as "progress"). One signal feeds
   *  both this and `greenForProgression`, so a run is never double-penalized. */
  shinVolumeGate?: "progress" | "hold" | "regress" | null,
  /** Sprint 2.4: graded return-to-training week (1-3) after a layoff ≥ 21 days.
   *  Cuts run volume (0.55/0.70/0.85) and replaces the quality day with an easy
   *  run in weeks 1-2. null/undefined → no ramp. Derived from completed-session
   *  history by the regenerate path, never set by hand. */
  comebackWeek?: ComebackWeek | null,
): WeekRunPlan {
  const paces = vdotToPaces(vdot);
  const blockNumber = phaseConfig.blockNumber;
  const hr: HrCtx = hrCtx ?? {};

  // Sprint v0.10: derive week-in-block + volume progression. Per-block
  // baselines from PhaseConfig (set in periodization/index.ts BLOCK_CONFIGS),
  // with sane fallbacks for any caller passing a partial config.
  const weekInBlock = weekInBlockOf(weekNumber, phaseConfig.durationWeeks);
  const volumeProg = computeRunVolumeProgression(weekInBlock, blockNumber);
  const longBaseline = phaseConfig.longRunBaselineMin ?? 60;
  const qualityBaseline = phaseConfig.qualityRunBaselineMin ?? 40;
  const easyBaseline = phaseConfig.easyRunBaselineMin ?? 35;

  // Sprint 2.3: pain governor — a recent shin flare (≥4) cuts run volume 20%
  // for THIS (imminent) week. Applied to the volume base so every easy/long
  // run inherits it. "hold"/"progress" leave volume untouched (hold only
  // clamps the threshold structure via greenForProgression).
  const gateFactor = shinVolumeGate === "regress" ? 0.8 : 1;
  // Sprint 2.4: the comeback ramp is a SECOND volume brake. Take the stricter
  // of the two rather than multiplying — a shin flare during comeback week 1
  // must not compound into 0.55 × 0.8 = 0.44. Same "one signal, no double
  // penalty" rule the Sprint 2.3 governor follows.
  const ramp = comebackWeek != null ? rampFor(comebackWeek) : null;
  const volumeFactor = Math.min(gateFactor, ramp?.runVolumeFactor ?? 1);
  const longRunMin = Math.max(20, Math.round(longBaseline * volumeProg.longRunMultiplier * volumeFactor));
  // Sprint 2.2: threshold is no longer sized by the volume multiplier — its
  // duration is derived from the interval structure (thresholdStructureFor).
  // qualityBaseline is kept only for non-threshold quality types if any.
  void qualityBaseline;
  const easyRunMin = Math.max(20, Math.round(easyBaseline * volumeProg.easyRunMultiplier * volumeFactor));

  const dateAt = (offsetDays: number): Date =>
    new Date(weekStartDate.getTime() + offsetDays * 86400000);

  const sessions: SessionPlan[] = [];

  // Mon: Easy AM
  sessions.push(easyRun(dateAt(0), easyRunMin, paces, hr));

  // Tue: Quality day depends on block
  let qualityDay: SessionPlan;
  // Sprint v1.5 follow-up: skip calibration when loadOverrideWeek is set
  // (post-reset W1; athlete already has known VDOT).
  if (blockNumber === 1 && weekNumber === 1 && loadOverrideWeek == null) {
    qualityDay = withHrTarget(
      {
        date: dateAt(1),
        type: "calibration_run",
        durationMin: 30,
        paceTarget: paces.E,
        intensityZone: 1,
        zoneLabel: getZoneLabel("calibration_run"),
        rpeTarget: 5,
        notes: "Calibration run — gentle 5km @ E-pace, log accurate RPE",
      },
      "calibration_run",
      hr,
    );
  } else if (shinVolumeGate === "regress" || ramp?.suppressQuality) {
    // Sprint 2.3: shin flare (≥4) → cancel the quality session, run easy
    // instead (no intensity load on an angry shin). Same for threshold + vo2max.
    // Sprint 2.4: comeback weeks 1-2 do the same — no intensity until the
    // tendon/bone side has had two weeks of graded loading.
    qualityDay = easyRun(dateAt(1), easyRunMin, paces, hr);
    qualityDay.notes =
      shinVolumeGate === "regress"
        ? "[Shin-Schutz: Quali gestrichen, locker laufen]"
        : `[Wiedereinstieg W${comebackWeek}: Quali gestrichen, locker laufen]`;
  } else if (blockNumber <= 3) {
    // Sprint 2.2: threshold = structured interval session (capped threshold
    // time), progressing via the ladder, gated by shin/RHR. Blocks 1–3.
    // Sprint 2.4: during the ramp (week 3, the first one that keeps a quality
    // day) the threshold always drops to the conservative 2×10 floor — the
    // ladder position is meaningless when the last threshold was months ago.
    const level = thresholdStructureFor(
      blockNumber,
      weekInBlock,
      greenForProgression && comebackWeek == null,
    );
    qualityDay = thresholdRun(dateAt(1), level, paces, hr);
  } else {
    qualityDay = vo2maxIntervals(dateAt(1), paces, hr);
  }
  // Sprint v0.13: attach pre-run activation to quality day (Leppänen 2024).
  // Tue is a run-only day — activation stays. S+E day stripping happens in
  // schedule-strategy if the schedule ever changes.
  qualityDay.preRunActivation = PRE_RUN_ACTIVATION;
  qualityDay.durationMin = (qualityDay.durationMin ?? 0) + ACTIVATION_DURATION_MIN;
  sessions.push(qualityDay);

  // Wed: Easy AM (slightly shorter than Mon/Fri)
  sessions.push(easyRun(dateAt(2), Math.max(20, easyRunMin - 5), paces, hr));

  // Thu: Rest
  sessions.push(emptySession(dateAt(3), "rest"));

  // Fri: Easy AM
  sessions.push(easyRun(dateAt(4), easyRunMin, paces, hr));

  // Sat: Long Run
  const longSpec = generateLongRunProgression(weekNumber, blockNumber);
  if (longSpec.durationMin > 0) {
    // Use the volume-progressed long run minutes (W2 +10%, etc.). The legacy
    // `longSpec.durationMin` is preserved as a floor when block 5 returns 0
    // (signals time-trial week). intensityZone still comes from longSpec.
    const longRunSession = longRun(dateAt(5), longRunMin, longSpec.intensityZone, paces, hr);
    // Sprint v0.13: attach pre-run activation to long run (Sat = run-only day).
    longRunSession.preRunActivation = PRE_RUN_ACTIVATION;
    longRunSession.durationMin = (longRunSession.durationMin ?? 0) + ACTIVATION_DURATION_MIN;
    sessions.push(longRunSession);
  } else {
    // Block 5 time-trial week → time trial on Wed (mid-week), Sat is easy/rest.
    // Time-trial deliberately stays pace_first — the goal is hitting a pace.
    sessions[2] = {
      date: dateAt(2),
      type: "time_trial_5k",
      durationMin: 60,
      paceTarget: { from: paces.T, to: paces.T },
      intensityZone: 3,
      zoneLabel: getZoneLabel("time_trial_5k"),
      rpeTarget: 10,
      controlMethod: "pace_first",
      notes: "5k Time Trial — race-day simulation",
    };
    sessions.push(easyRun(dateAt(5), Math.max(20, easyRunMin - 5), paces, hr));
  }

  // Sun: Rest
  sessions.push(emptySession(dateAt(6), "rest"));

  const weeklyVolumeMinTarget = sessions
    .filter((s) => s.durationMin)
    .reduce((acc, s) => acc + (s.durationMin ?? 0), 0);

  return {
    weekNumber,
    blockNumber,
    sessions,
    weeklyVolumeMinTarget,
    paces,
  };
}
