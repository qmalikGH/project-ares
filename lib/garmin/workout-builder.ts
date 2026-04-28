// Garmin Workout Builder (Sprint v0.9) — pure mapper SessionPlan → Garmin
// Connect's structured-workout JSON format. No I/O, no lib calls. The shape
// matches Garmin Connect's REST contract (verified against
// node_modules/garmin-connect's RunningTemplate + community docs).
//
// Architectural rules:
//   - Strength sessions, rest days, time trials are NEVER pushed (return null)
//   - HR target is required for any pushable session — the runner steers by HR
//     on the watch and pace stays orientierend
//   - Builder is fully testable; the I/O wrapper lives in workout-sync.ts

import type { SessionPlan } from "@/lib/coach-engine/types";

// ============================================
// Garmin enum constants (Garmin Connect REST API contract)
// ============================================
//
// stepTypeId / Key:  1=warmup, 2=cooldown, 3=interval, 4=recovery, 5=rest, 6=repeat
// conditionTypeId / Key:  1=lap.button, 2=time, 3=distance, 4=heart.rate, 5=open
// workoutTargetTypeId / Key:  1=no.target, 4=heart.rate.zone, 6=pace.zone

const SPORT_RUNNING = { sportTypeId: 1, sportTypeKey: "running" as const };

const STEP_TYPE = {
  warmup: { stepTypeId: 1, stepTypeKey: "warmup" as const },
  cooldown: { stepTypeId: 2, stepTypeKey: "cooldown" as const },
  interval: { stepTypeId: 3, stepTypeKey: "interval" as const },
  recovery: { stepTypeId: 4, stepTypeKey: "recovery" as const },
  rest: { stepTypeId: 5, stepTypeKey: "rest" as const },
  repeat: { stepTypeId: 6, stepTypeKey: "repeat" as const },
} as const;

const COND_TYPE = {
  time: { conditionTypeId: 2, conditionTypeKey: "time" as const },
  distance: { conditionTypeId: 3, conditionTypeKey: "distance" as const },
  open: { conditionTypeId: 5, conditionTypeKey: "open" as const },
  iterations: { conditionTypeId: 7, conditionTypeKey: "iterations" as const },
} as const;

const TARGET_TYPE = {
  noTarget: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" as const },
  heartRate: { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone" as const },
  pace: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone" as const },
} as const;

// ============================================
// Output types — minimal mirror of Garmin's IWorkoutDetail
// ============================================
//
// Loose typing on purpose: the upstream lib's IWorkoutDetail contains many
// server-populated null-only fields (workoutId, createdDate, author, etc.)
// which we don't need to set on POST.

export interface GarminStructuredWorkout {
  workoutName: string;
  description?: string;
  estimatedDurationInSecs: number;
  sportType: typeof SPORT_RUNNING;
  workoutSegments: GarminWorkoutSegment[];
}

export interface GarminWorkoutSegment {
  segmentOrder: number;
  sportType: typeof SPORT_RUNNING;
  workoutSteps: GarminWorkoutStep[];
}

export type GarminWorkoutStep = ExecutableStep | RepeatGroupStep;

export interface ExecutableStep {
  type: "ExecutableStepDTO";
  stepId: number | null;
  stepOrder: number;
  childStepId: number | null;
  description: string | null;
  stepType: { stepTypeId: number; stepTypeKey: string };
  endCondition: { conditionTypeId: number; conditionTypeKey: string };
  endConditionValue: number | null;
  preferredEndConditionUnit?: { unitKey: string } | null;
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string };
  targetValueOne: number | null;
  targetValueTwo: number | null;
  zoneNumber: number | null;
}

export interface RepeatGroupStep {
  type: "RepeatGroupDTO";
  stepId: number | null;
  stepOrder: number;
  childStepId: number | null;
  description: string | null;
  stepType: { stepTypeId: number; stepTypeKey: string };
  numberOfIterations: number;
  endCondition: { conditionTypeId: number; conditionTypeKey: string };
  workoutSteps: ExecutableStep[];
}

// ============================================
// Pushability gate
// ============================================

const NON_PUSHABLE_TYPES = new Set([
  "rest",
  "strength_a",
  "strength_b",
  "strength_c",
  "active_recovery",
  "time_trial_5k",
  "cross_training",
  "mobility",
]);

export function isPushableSessionType(type: string): boolean {
  return !NON_PUSHABLE_TYPES.has(type);
}

// ============================================
// Pace conversion — "5:00" mm:ss/km → m/s
// ============================================

/**
 * Convert pace string (mm:ss per km) to m/s.
 * Returns 0 for invalid input — caller should guard.
 */
export function paceStringToMeterPerSec(pace: string): number {
  const m = pace.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const min = Number.parseInt(m[1], 10);
  const sec = Number.parseInt(m[2], 10);
  const secPerKm = min * 60 + sec;
  if (secPerKm <= 0) return 0;
  return 1000 / secPerKm;
}

// ============================================
// Builder
// ============================================

export interface VdotPaceLookup {
  E: { from: string; to: string };
  M: string;
  T: string;
  I: string;
  R: string;
}

/**
 * Build a Garmin structured workout from a SessionPlan.
 * Returns null when the session type is not pushable, or when no HR target
 * is set (we always push HR-First for the watch).
 */
export function buildGarminWorkout(
  session: SessionPlan,
  paces: VdotPaceLookup,
): GarminStructuredWorkout | null {
  if (!isPushableSessionType(session.type)) return null;
  if (!session.hrTarget) return null;

  switch (session.type) {
    case "easy_run":
      return buildEasyRun(session);
    case "threshold_run":
      return buildThresholdRun(session, paces.T);
    case "tempo_run":
      return buildTempoRun(session, paces.M);
    case "long_run":
      return buildLongRun(session);
    case "vo2max_intervals":
      return buildVO2maxIntervals(session, paces.I);
    case "calibration_run":
      return buildCalibrationRun(session);
    default:
      return null;
  }
}

// ============================================
// Step constructors (HR-zoned with Garmin's target schema)
// ============================================

function timeStep(args: {
  stepOrder: number;
  type: keyof typeof STEP_TYPE;
  durationSec: number;
  hrLow?: number;
  hrHigh?: number;
  description?: string;
}): ExecutableStep {
  const hasHr = typeof args.hrLow === "number" && typeof args.hrHigh === "number";
  return {
    type: "ExecutableStepDTO",
    stepId: null,
    stepOrder: args.stepOrder,
    childStepId: null,
    description: args.description ?? null,
    stepType: STEP_TYPE[args.type],
    endCondition: COND_TYPE.time,
    endConditionValue: args.durationSec,
    preferredEndConditionUnit: null,
    targetType: hasHr ? TARGET_TYPE.heartRate : TARGET_TYPE.noTarget,
    targetValueOne: hasHr ? args.hrLow! : null,
    targetValueTwo: hasHr ? args.hrHigh! : null,
    zoneNumber: null,
  };
}

function repeatGroup(args: {
  stepOrder: number;
  iterations: number;
  steps: ExecutableStep[];
  description?: string;
}): RepeatGroupStep {
  return {
    type: "RepeatGroupDTO",
    stepId: null,
    stepOrder: args.stepOrder,
    childStepId: null,
    description: args.description ?? null,
    stepType: STEP_TYPE.repeat,
    numberOfIterations: args.iterations,
    endCondition: COND_TYPE.iterations,
    workoutSteps: args.steps,
  };
}

function wrap(
  name: string,
  description: string,
  totalSec: number,
  steps: GarminWorkoutStep[],
): GarminStructuredWorkout {
  return {
    workoutName: name,
    description,
    estimatedDurationInSecs: totalSec,
    sportType: SPORT_RUNNING,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: SPORT_RUNNING,
        workoutSteps: steps,
      },
    ],
  };
}

// ============================================
// Per-session-type builders
// ============================================

function buildEasyRun(session: SessionPlan): GarminStructuredWorkout {
  const totalSec = (session.durationMin ?? 30) * 60;
  const wuSec = 300;
  const cdSec = 300;
  const steadySec = Math.max(60, totalSec - wuSec - cdSec);
  const hr = session.hrTarget!;

  return wrap(
    `Easy Run ${session.durationMin}min`,
    `HR ${hr.from}-${hr.to} bpm · ${session.durationMin}min total`,
    wuSec + steadySec + cdSec,
    [
      timeStep({
        stepOrder: 1,
        type: "warmup",
        durationSec: wuSec,
        description: "Warmup easy",
      }),
      timeStep({
        stepOrder: 2,
        type: "interval",
        durationSec: steadySec,
        hrLow: hr.from,
        hrHigh: hr.to,
        description: "Steady easy aerobic",
      }),
      timeStep({
        stepOrder: 3,
        type: "cooldown",
        durationSec: cdSec,
        description: "Cooldown",
      }),
    ],
  );
}

function buildThresholdRun(
  session: SessionPlan,
  tPace: string,
): GarminStructuredWorkout {
  const totalSec = (session.durationMin ?? 50) * 60;
  const wuSec = 600;
  const cdSec = 600;
  const thresholdSec = Math.max(60, totalSec - wuSec - cdSec);
  const hr = session.hrTarget!;

  return wrap(
    `Threshold ${session.durationMin}min`,
    `Threshold sustained · HR ${hr.from}-${hr.to} bpm · T-pace ~${tPace}/km`,
    wuSec + thresholdSec + cdSec,
    [
      timeStep({
        stepOrder: 1,
        type: "warmup",
        durationSec: wuSec,
        description: "10min easy warmup",
      }),
      timeStep({
        stepOrder: 2,
        type: "interval",
        durationSec: thresholdSec,
        hrLow: hr.from,
        hrHigh: hr.to,
        description: `Threshold @ HR ${hr.from}-${hr.to} (~${tPace}/km)`,
      }),
      timeStep({
        stepOrder: 3,
        type: "cooldown",
        durationSec: cdSec,
        description: "10min cooldown easy",
      }),
    ],
  );
}

function buildTempoRun(
  session: SessionPlan,
  mPace: string,
): GarminStructuredWorkout {
  const totalSec = (session.durationMin ?? 40) * 60;
  const wuSec = 600;
  const cdSec = 300;
  const tempoSec = Math.max(60, totalSec - wuSec - cdSec);
  const hr = session.hrTarget!;

  return wrap(
    `Tempo ${session.durationMin}min`,
    `Marathon pace ~${mPace}/km · HR ${hr.from}-${hr.to} bpm`,
    wuSec + tempoSec + cdSec,
    [
      timeStep({
        stepOrder: 1,
        type: "warmup",
        durationSec: wuSec,
        description: "10min warmup easy",
      }),
      timeStep({
        stepOrder: 2,
        type: "interval",
        durationSec: tempoSec,
        hrLow: hr.from,
        hrHigh: hr.to,
        description: `Tempo ~${mPace}/km`,
      }),
      timeStep({
        stepOrder: 3,
        type: "cooldown",
        durationSec: cdSec,
        description: "5min cooldown",
      }),
    ],
  );
}

function buildLongRun(session: SessionPlan): GarminStructuredWorkout {
  const totalSec = (session.durationMin ?? 90) * 60;
  const hr = session.hrTarget!;

  return wrap(
    `Long Run ${session.durationMin}min`,
    `Steady aerobic · HR ${hr.from}-${hr.to} bpm`,
    totalSec,
    [
      timeStep({
        stepOrder: 1,
        type: "interval",
        durationSec: totalSec,
        hrLow: hr.from,
        hrHigh: hr.to,
        description: "Long run aerobic",
      }),
    ],
  );
}

function buildVO2maxIntervals(
  session: SessionPlan,
  iPace: string,
): GarminStructuredWorkout {
  const reps = 5;
  const workSec = 180; // 3min
  const restSec = 120; // 2min
  const wuSec = 600;
  const cdSec = 600;
  const totalSec = wuSec + reps * (workSec + restSec) + cdSec;
  const hr = session.hrTarget!;

  return wrap(
    `VO2max ${reps}×${workSec / 60}min`,
    `${reps}× ${workSec / 60}min @ HR ${hr.from}-${hr.to} (~${iPace}/km) · ${restSec / 60}min recovery`,
    totalSec,
    [
      timeStep({
        stepOrder: 1,
        type: "warmup",
        durationSec: wuSec,
        description: "10min warmup",
      }),
      repeatGroup({
        stepOrder: 2,
        iterations: reps,
        description: `${reps}× hard + recovery`,
        steps: [
          timeStep({
            stepOrder: 1,
            type: "interval",
            durationSec: workSec,
            hrLow: hr.from,
            hrHigh: hr.to,
            description: `Hard @ ~${iPace}/km`,
          }),
          timeStep({
            stepOrder: 2,
            type: "recovery",
            durationSec: restSec,
            description: "Easy recovery",
          }),
        ],
      }),
      timeStep({
        stepOrder: 3,
        type: "cooldown",
        durationSec: cdSec,
        description: "10min cooldown",
      }),
    ],
  );
}

function buildCalibrationRun(session: SessionPlan): GarminStructuredWorkout {
  const totalSec = (session.durationMin ?? 30) * 60;
  const hr = session.hrTarget!;

  return wrap(
    `Calibration Run ${session.durationMin}min`,
    `App-controlled VDOT calibration · HR ${hr.from}-${hr.to} bpm`,
    totalSec,
    [
      timeStep({
        stepOrder: 1,
        type: "interval",
        durationSec: totalSec,
        hrLow: hr.from,
        hrHigh: hr.to,
        description: "Calibration easy",
      }),
    ],
  );
}
