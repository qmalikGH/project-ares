// Shared modulation inputs for /api/sessions/today, /api/sessions/start and
// /api/coach/explain-session (Sprint 2.5).
//
// WHY THIS EXISTS: the three routes each assembled the modulator's inputs
// themselves, and they had drifted. `/today` called computeKneeStatus with six
// arguments; `/start` called it with four — and the last two are what make
// `illnessRecoveryDays` computable. The result: `/today` showed "Illness
// Recovery Tag 2 — Volumen 70 %, Kraft-Cap 80 %", the athlete tapped Start, and
// `/start` persisted and began the FULL, unmodulated session. The path that
// displays advice and the path that commits it disagreed.
//
// One builder, one shape. A future input belongs here, not in a route.
import { db } from "@/lib/db/client";
import {
  getRecentSensorData,
  getSensorDataOnDate,
  getRecentDailyLoads,
  rowsToSensorInputs,
  rowsToKneeLogs,
  dayKey,
} from "@/lib/db/queries/sensors";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import { computeBaselines, computeReadiness } from "@/lib/coach-engine/readiness";
import { buildLoadOutput, computeDailyLoad } from "@/lib/coach-engine/load-monitoring";
import { computeKneeStatus } from "@/lib/coach-engine/limitations";
import { vdotToPaces } from "@/lib/coach-engine/run-coach";
import type {
  DailySensorInputs,
  LimitationsOutput,
  LoadOutput,
  ReadinessOutput,
  SensorBaselines,
  TherapyPhase,
  UserMorningInputs,
  VDOTPaces,
} from "@/lib/coach-engine/types";

/** How far back the illness-recovery detector looks for a `skipped_illness` row. */
const ILLNESS_LOOKBACK_DAYS = 21;
const SENSOR_HISTORY_DAYS = 30;
const LOAD_HISTORY_DAYS = 28;

export interface ModulationContext {
  readiness: ReadinessOutput;
  load: LoadOutput;
  limitations: LimitationsOutput;
  paces: VDOTPaces;
  /** Today's DailySensorData row id, so callers can cache the scores back.
   *  Null when no row exists yet (no sync and no input today). */
  sensorRowId: string | null;
  /** Sprint 3.4 (#28, C1): the morning input is missing — optional now. */
  morningInputPending: boolean;
  /** Raw inputs + baselines, for callers that surface them (explain-session). */
  inputs: DailySensorInputs;
  baselines: SensorBaselines;
}

/**
 * Knee inputs when the athlete gave none. Only for the knee-status model: a
 * score of 1 means "no symptoms reported", so no knee rule fires. Never stored
 * (callers skip the kneeScore cache when `morningInputPending`).
 */
const NO_KNEE_REPORT: UserMorningInputs = { subjectiveRecovery: 8, morningStiffness: 1, stairsScore: 1 };

/**
 * Sprint 3.4 (#28, C1): always returns a context. Without a morning input the
 * readiness runs on the Garmin values alone (or neutral without them), and
 * `morningInputPending` tells the caller to offer the input as optional.
 */
export async function buildModulationContext(
  userId: string,
  today: Date,
): Promise<ModulationContext> {
  const todayRow = await getSensorDataOnDate(userId, today);
  const morning = (todayRow?.userMorning ?? null) as UserMorningInputs | null;

  const recentRows = await getRecentSensorData(userId, SENSOR_HISTORY_DAYS);
  const baselines = computeBaselines(rowsToSensorInputs(recentRows));

  const todayInputs: DailySensorInputs = {
    date: dayKey(today),
    garmin: (todayRow?.garmin as unknown as DailySensorInputs["garmin"]) ?? undefined,
    userMorning: morning ?? undefined,
  };

  const readiness = computeReadiness(todayInputs, baselines);

  const recentLoads = await getRecentDailyLoads(userId, LOAD_HISTORY_DAYS);
  const load = buildLoadOutput(recentLoads, computeDailyLoad(0, 0), dayKey(today));

  // The two arguments below are what `/start` used to omit.
  const recentWorkouts = await db.workout.findMany({
    where: {
      userId,
      date: { gte: new Date(dayKey(today).getTime() - ILLNESS_LOOKBACK_DAYS * 86400000) },
    },
    select: { date: true, status: true },
    orderBy: { date: "desc" },
  });

  const limitations = computeKneeStatus(
    { morning: morning ?? NO_KNEE_REPORT, postSession: todayInputs.userPostSession?.trainingScore },
    rowsToKneeLogs(recentRows),
    (todayRow?.therapyPhase as TherapyPhase | null) ?? "DISREPAIR",
    null,
    recentWorkouts.map((w) => ({ date: w.date, status: w.status })),
    dayKey(today),
  );

  // Sprint 2.5: the modulator needs real paces so a "make it easier" rule can
  // reach for marathon pace instead of a hardcoded constant.
  const paces = vdotToPaces(await getEffectiveVdot(userId));

  return {
    readiness,
    load,
    limitations,
    paces,
    sensorRowId: todayRow?.id ?? null,
    morningInputPending: morning == null,
    inputs: todayInputs,
    baselines,
  };
}
