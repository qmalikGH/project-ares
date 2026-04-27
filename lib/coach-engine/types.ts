// Project Ares — Engine Types
// See science_doc.md Kap 9.7 for the data-flow rationale.
// Pure types — no DB models, no AI types. Engine layer only.

import { z } from "zod";

// ============================================
// Periodization
// ============================================
export type PhaseName =
  | "ACCUMULATION_AEROBIC_BASE"
  | "ACCUMULATION_THRESHOLD_INTRO"
  | "TRANSMUTATION_THRESHOLD"
  | "TRANSMUTATION_VO2MAX"
  | "REALIZATION_PEAK_PERFORMANCE";

export type BlockNumber = 1 | 2 | 3 | 4 | 5;

export interface PhaseConfig {
  blockNumber: BlockNumber;
  phaseName: PhaseName;
  durationWeeks: number;
  enduranceTID: { z1: number; z2: number; z3: number };
  strengthMode: "linear_progression" | "maintenance" | "minimal";
  strengthRpeCap: 7 | 8 | 9;
  volumeProgression: "linear_increase" | "maintain" | "deload";
  vdotTarget: number;
}

export interface MacrocyclePlan {
  totalWeeks: number;
  startDate: Date;
  endDate: Date;
  vdotInitial: number;
  phases: PhasePlan[];
  performanceMarkerWeeks: number[]; // week numbers within macrocycle (1-indexed)
}

export interface PhasePlan {
  blockNumber: BlockNumber;
  phaseName: PhaseName;
  startWeek: number; // 1-indexed within macrocycle
  endWeek: number;
  startDate: Date;
  plannedEndDate: Date;
  config: PhaseConfig;
  vdotTarget: number;
}

export type PhaseTransitionDecision =
  | { decision: "PROCEED"; nextPhase: PhaseName | null; recoverInNext?: boolean }
  | { decision: "EXTEND_PHASE"; extendByWeeks: number }
  | { decision: "ADJUST_PHASE"; reduceIntensityFraction: number }
  | { decision: "DEFER"; deferByWeeks: number };

export interface BlockReviewInput {
  performanceMarkerMet: boolean;
  performanceMarkerClose: boolean; // within 5%
  performanceMarkerMissed: boolean;
  healthStable: boolean;
  healthWarning: boolean;
  healthDecline: boolean;
  averageACWR: number;
  averageReadiness: number;
  kneeScoreTrend: "stable" | "improving" | "declining";
  missedSessionsCount: number;
  actualTID: { z1: number; z2: number; z3: number };
}

// ============================================
// Goal (Engine input)
// ============================================
export interface GoalInput {
  primaryType: "5k_time" | "10k_time" | "21k_time";
  currentValue: { time: string; date: Date };
  targetValue: { time: string; date: Date };
  modality: "hybrid" | "run_only" | "strength_only";
  constraints: { type: string; severity: "active" | "monitoring" | "resolved" }[];
  preferences: { strengthPerWeek?: number; maxTrainingDays?: number };
  startDate: Date;
  vdotInitial: number;
}

// ============================================
// Sessions
// ============================================
export type SessionType =
  | "easy_run"
  | "threshold_run"
  | "tempo_run"
  | "vo2max_intervals"
  | "long_run"
  | "calibration_run"
  | "time_trial_5k"
  | "strength_a"
  | "strength_b"
  | "strength_c"
  | "rest"
  | "active_recovery"
  | "cross_training"
  | "mobility";

export type IntensityZone = 1 | 2 | 3;

export interface PaceTarget {
  from: string; // "5:45"
  to: string; // "6:15"
}

export interface Exercise {
  name: string;
  sets: number;
  reps: number | string;
  loadPct?: number; // % of 1RM
  loadAbs?: number; // absolute kg, for hex-bar etc.
  rpeCap?: number;
  /**
   * Tempo notation: eccentric-pause-concentric (in seconds), or "iso" for
   * isometrics, or "X-X-X" for max-effort moves. See science_doc.md Kap 8.4
   * (HSR — slow eccentric is the active ingredient for tendon remodeling).
   */
  tempo?: string;
  /** Rest seconds between sets. See science_doc.md Kap 4.5 (Hybrid pauses). */
  restSec?: number;
  notes?: string;

  // ============================================
  // Superset support (Sprint v0.7)
  // ============================================
  /**
   * Superset group identifier. Two exercises sharing the same group are
   * performed back-to-back with 0-15s rest between (`restSec` 0 on the
   * first, full `restSec` on the second after the pair).
   * null = standalone Straight Set (default).
   *
   * Antagonist-Pairs only (Zhang 2025, Iversen 2024): Push+Pull, Hinge+Pull.
   * HSR-Lifts (Hex Bar Deadlift, RDL) are NEVER in supersets — Tendon-
   * Loading needs full 3min rest (Kongsgaard 2009, science_doc Kap 8.4).
   */
  supersetGroup?: string | null;
  /** Order in the pair: 1 = first, 2 = second. null when standalone. */
  supersetOrder?: number | null;
  /** Why this exercise is paired — surfaced in UI tooltip + coach-context. */
  supersetRationale?: string;
}

export interface SessionPlan {
  date: Date;
  type: SessionType;
  durationMin?: number;
  paceTarget?: PaceTarget;
  intensityZone?: IntensityZone;
  exercises?: Exercise[];
  rpeTarget?: number;
  notes?: string;
  // Optional structure for interval sessions
  structure?: {
    warmupMin?: number;
    workIntervals?: { repeats: number; durationMin?: number; distanceM?: number; paceTarget?: PaceTarget; restMin?: number }[];
    cooldownMin?: number;
  };

  // ============================================
  // HR-First control (Sprint v0.7)
  // ============================================
  /**
   * Primary HR target range (BPM, verbindlich). Generated from user's HRmax /
   * HRrest via Karvonen at session-creation time. UI shows this prominently;
   * Q steers by HR, pace is orientierend.
   */
  hrTarget?: { from: number; to: number };
  /**
   * Whether HR or pace is the primary control variable for this session.
   * Default in v0.7+: "hr_first". Threshold-tests / time-trials may flip to
   * "pace_first" because the goal IS to hit a pace.
   */
  controlMethod?: "hr_first" | "pace_first";
}

export interface FinalSession extends SessionPlan {
  wasModified: boolean;
  modifications: string[];
  confidence: number; // 0-100
  explanation: string;
}

// ============================================
// Sensors / Daily Inputs
// ============================================
export interface GarminMorningInputs {
  hrvStatus: string; // "BALANCED" | "UNBALANCED" | "LOW" etc.
  hrvRmssd: number; // ms
  sleepScore: number; // 0-100
  sleepDurationMin: number;
  bodyBatteryMorning: number; // 0-100
  rhr: number; // bpm
}

export interface UserMorningInputs {
  subjectiveRecovery: number; // 1-10
  morningStiffness: number; // 1-10 (10 = worst)
  stairsScore: number; // 1-10 (10 = worst pain)
}

export interface UserPostSessionInputs {
  trainingScore: number; // 1-10 knee post-session
  rpe: number; // 0-10 sRPE
  durationActualMin: number;
  notes?: string;
}

export interface DailySensorInputs {
  date: Date;
  garmin?: GarminMorningInputs;
  userMorning: UserMorningInputs;
  userPostSession?: UserPostSessionInputs;
}

export interface SensorBaselines {
  hrv28dAvg: number;
  hrv28dSd: number;
  sleep28dAvg: number;
  sleep28dSd: number;
  rhr28dAvg: number;
  rhr28dSd: number;
}

// ============================================
// Sensor Outputs
// ============================================
export type ReadinessBand = "GREEN" | "YELLOW" | "ORANGE" | "RED";
export type Trend7d = "stable" | "improving" | "declining";

export interface ReadinessOutput {
  score: number; // 0-100
  band: ReadinessBand;
  components: {
    hrv: number;
    sleep: number;
    battery: number;
    rhrDev: number;
    subjective: number;
    knee: number;
  };
  trend7d: Trend7d;
}

export type ACWRBand = "BASELINE_BUILDING" | "LOW" | "OPTIMAL" | "HIGH" | "DANGER";

export interface LoadOutput {
  dailyLoadAu: number;
  acute7d: number;
  chronic28d: number;
  acwrRolling: number;
  acwrEwma: number;
  band: ACWRBand;
  /**
   * Distinct days of load data observed in the chronic window.
   * <14 → ACWR is unreliable per Wang 2020; band falls back to BASELINE_BUILDING.
   */
  daysOfData: number;
}

export type TherapyPhase = "REACTIVE" | "DISREPAIR" | "REMODELING" | "SPORT_SPECIFIC";

export interface KneeLog {
  date: Date;
  morningStiffness: number;
  stairsScore: number;
  postSessionScore?: number;
}

export interface LimitationsOutput {
  kneeScoreToday: number;
  kneeBaseline28d: number;
  kneeTrend7d: Trend7d;
  therapyPhase: TherapyPhase;
  constraints: string[];
}

// ============================================
// Run Plan / Strength Plan / Week Plan
// ============================================
export interface VDOTPaces {
  E: PaceTarget; // Easy
  M: string; // Marathon (single target)
  T: string; // Threshold
  I: string; // Interval / VO2max
  R: string; // Repetition
}

export interface WeekRunPlan {
  weekNumber: number;
  blockNumber: BlockNumber;
  sessions: SessionPlan[];
  weeklyVolumeMinTarget: number;
  paces: VDOTPaces;
}

export interface WeekStrengthData {
  weekNumber: number;
  sessions: { type: "strength_a" | "strength_b" | "strength_c"; rpeReported?: number }[];
  loadsByExercise?: Record<string, number>;
}

export interface WeekStrengthPlan {
  weekNumber: number;
  blockNumber: BlockNumber;
  sessions: SessionPlan[];
}

// ============================================
// Calibration (W1)
// ============================================
export interface W1CalibrationRunData {
  durationMin: number;
  distanceKm: number;
  avgHr: number;
  maxHr: number;
  rpe: number;
}

export interface VDOTCalibrationResult {
  calibratedVdot: number;
  pacesUpdated: boolean;
  notification: string;
}

// ============================================
// ExecutedSession (post-workout, persisted in Workout.executedSession JSON)
// ============================================

/** A single set within a strength exercise. */
export const StrengthSetSchema = z.object({
  reps: z.number().min(0).max(100),
  loadKg: z.number().min(0).nullable(),
  rpe: z.number().min(1).max(10).nullable(),
  /** For isometrics like Wall Sit. Null for normal lifts. */
  durationSec: z.number().min(0).nullable(),
  notes: z.string().optional(),
});

/** A single exercise's actual execution. */
export const StrengthExecutedExerciseSchema = z.object({
  name: z.string(),
  plannedSets: z.number(),
  plannedReps: z.union([z.number(), z.string()]),
  plannedLoadPct: z.number().nullable(),

  actualSets: z.array(StrengthSetSchema),
  skipped: z.boolean().default(false),
  exerciseNotes: z.string().optional(),
});

/** Run executed session — typically auto-imported from Garmin. */
export const RunExecutedSessionSchema = z.object({
  type: z.literal("run"),
  source: z.enum(["garmin_import", "manual"]),
  garminActivityId: z.number().nullable(),

  startTimeLocal: z.string(),
  durationSec: z.number(),
  distanceM: z.number().nullable(),
  averagePaceSecPerKm: z.number().nullable(),
  averageHr: z.number().nullable(),
  maxHr: z.number().nullable(),
  elevationGainM: z.number().nullable(),
  calories: z.number().nullable(),

  splits: z
    .array(
      z.object({
        splitNumber: z.number(),
        distanceM: z.number(),
        durationSec: z.number(),
        paceSecPerKm: z.number().nullable(),
        averageHr: z.number().nullable(),
        maxHr: z.number().nullable(),
      }),
    )
    .default([]),

  // Sprint v0.7: Garmin's per-activity HR-time-in-5-zones, plus the polarized
  // 3-zone projection. Both optional — only present when Garmin import +
  // hrTimeInZones endpoint succeeded.
  garminHrZones: z
    .object({
      zone1Sec: z.number(),
      zone2Sec: z.number(),
      zone3Sec: z.number(),
      zone4Sec: z.number(),
      zone5Sec: z.number(),
      zoneFloors: z.object({
        z1: z.number(),
        z2: z.number(),
        z3: z.number(),
        z4: z.number(),
        z5: z.number(),
      }),
    })
    .nullable()
    .optional(),
  polarizedTID: z
    .object({
      z1Sec: z.number(),
      z2Sec: z.number(),
      z3Sec: z.number(),
      z1Pct: z.number(),
      z2Pct: z.number(),
      z3Pct: z.number(),
      totalSec: z.number(),
    })
    .nullable()
    .optional(),
});

/** Strength executed session — manual set-by-set logger. */
export const StrengthExecutedSessionSchema = z.object({
  type: z.literal("strength"),
  source: z.literal("manual"),
  garminActivityId: z.number().nullable(),

  startTimeLocal: z.string(),
  durationActualMin: z.number(),

  exercises: z.array(StrengthExecutedExerciseSchema),

  averageHr: z.number().nullable(),
  maxHr: z.number().nullable(),
  calories: z.number().nullable(),
});

export const ExecutedSessionSchema = z.discriminatedUnion("type", [
  RunExecutedSessionSchema,
  StrengthExecutedSessionSchema,
]);

export type StrengthSet = z.infer<typeof StrengthSetSchema>;
export type StrengthExecutedExercise = z.infer<typeof StrengthExecutedExerciseSchema>;
export type RunExecutedSession = z.infer<typeof RunExecutedSessionSchema>;
export type StrengthExecutedSession = z.infer<typeof StrengthExecutedSessionSchema>;
export type ExecutedSession = z.infer<typeof ExecutedSessionSchema>;
