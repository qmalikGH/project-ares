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
  /** Today's DailySensorData row id, so callers can cache the scores back. */
  sensorRowId: string;
  /** Raw inputs + baselines, for callers that surface them (explain-session). */
  inputs: DailySensorInputs;
  baselines: SensorBaselines;
}

/**
 * Returns null when there is no morning input for the day — the caller decides
 * whether that is `AWAITING_MORNING_INPUT` or a reason to skip modulation.
 */
export async function buildModulationContext(
  userId: string,
  today: Date,
): Promise<ModulationContext | null> {
  const todayRow = await getSensorDataOnDate(userId, today);
  if (!todayRow || !todayRow.userMorning) return null;

  const recentRows = await getRecentSensorData(userId, SENSOR_HISTORY_DAYS);
  const baselines = computeBaselines(rowsToSensorInputs(recentRows));

  const todayInputs: DailySensorInputs = {
    date: dayKey(today),
    garmin: (todayRow.garmin as unknown as DailySensorInputs["garmin"]) ?? undefined,
    userMorning: todayRow.userMorning as unknown as UserMorningInputs,
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
    { morning: todayInputs.userMorning, postSession: todayInputs.userPostSession?.trainingScore },
    rowsToKneeLogs(recentRows),
    (todayRow.therapyPhase as TherapyPhase | null) ?? "DISREPAIR",
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
    sensorRowId: todayRow.id,
    inputs: todayInputs,
    baselines,
  };
}
