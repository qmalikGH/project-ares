// GET /api/sessions/today
// Returns today's modulated session with full sensor outputs.
// This endpoint is the central engine integration point — see CLAUDE.md Rule 6 (Modulator never bypassed).
import { NextResponse } from "next/server";

import { getCurrentUserId } from "@/lib/auth/current-user";
import { computeReadiness, computeBaselines } from "@/lib/coach-engine/readiness";
import { buildLoadOutput, computeDailyLoad } from "@/lib/coach-engine/load-monitoring";
import { computeKneeStatus } from "@/lib/coach-engine/limitations";
import { modulateSession } from "@/lib/coach-engine/session-modulator";
import type {
  DailySensorInputs,
  LimitationsOutput,
  LoadOutput,
  ReadinessOutput,
  SessionPlan,
  TherapyPhase,
  UserMorningInputs,
} from "@/lib/coach-engine/types";

import {
  getCurrentPhaseRow,
  findWeekPlanForDate,
  findAllTodaySessionsInPlan,
} from "@/lib/db/queries/plans";
import {
  getRecentSensorData,
  rowsToSensorInputs,
  rowsToKneeLogs,
  getRecentDailyLoads,
  getSensorDataOnDate,
  dayKey,
} from "@/lib/db/queries/sensors";
import { userTodayDynamic } from "@/lib/date";

export async function GET() {
  const userId = await getCurrentUserId();
  // User's calendar date (cookie-based when set, else USER_TIMEZONE env).
  const today = await userTodayDynamic();

  // 1. Locate current phase + this week's plan
  const phaseRow = await getCurrentPhaseRow(userId, today);
  if (!phaseRow) {
    return NextResponse.json({ status: "NO_ACTIVE_PLAN" }, { status: 200 });
  }
  const weekPlan = findWeekPlanForDate(phaseRow.weeklyPlans, today);
  if (!weekPlan) {
    return NextResponse.json({ status: "NO_WEEK_PLAN" }, { status: 200 });
  }

  const plannedSessions = findAllTodaySessionsInPlan(weekPlan.plannedSessions, today);
  if (plannedSessions.length === 0) {
    return NextResponse.json({ status: "NO_SESSION_TODAY" }, { status: 200 });
  }
  // Primary session = first non-rest, falls back to the first entry. The
  // engine's modulator always inspects the primary; secondaries (e.g. PM
  // Strength) get the same sensor context applied via the same modulator pass.
  const primarySession = plannedSessions.find((s) => s.type !== "rest") ?? plannedSessions[0];

  // 2. Today's sensor row
  const todayRow = await getSensorDataOnDate(userId, today);
  if (!todayRow || !todayRow.userMorning) {
    return NextResponse.json({
      status: "AWAITING_MORNING_INPUT",
      plannedSession: primarySession,
      plannedSessions,
    });
  }

  // 3. Build sensor outputs from history
  const recentRows = await getRecentSensorData(userId, 30);
  const baselines = computeBaselines(rowsToSensorInputs(recentRows));

  const todayInputs: DailySensorInputs = {
    date: dayKey(today),
    garmin: (todayRow.garmin as unknown as DailySensorInputs["garmin"]) ?? undefined,
    userMorning: todayRow.userMorning as unknown as UserMorningInputs,
  };

  const readiness: ReadinessOutput = computeReadiness(todayInputs, baselines);

  const recentLoads = await getRecentDailyLoads(userId, 28);
  const todayLoadAu = computeDailyLoad(0, 0); // placeholder; actual load computed post-session
  const load: LoadOutput = buildLoadOutput(recentLoads, todayLoadAu, dayKey(today));

  const kneeLogs = rowsToKneeLogs(recentRows);
  const currentTherapyPhase = (todayRow.therapyPhase as TherapyPhase | null) ?? "DISREPAIR";
  const limitations: LimitationsOutput = computeKneeStatus(
    { morning: todayInputs.userMorning, postSession: todayInputs.userPostSession?.trainingScore },
    kneeLogs,
    currentTherapyPhase,
    null,
  );

  // 4. Modulate every session for today (Run + Strength on two-a-day Mondays etc.)
  const finalSessions = plannedSessions.map((p) => modulateSession(p as SessionPlan, readiness, load, limitations));

  // Sprint v0.15: Fetch currentWeightKg once — used for protein note + ×BW response.
  const userSettingsForWeight = await import("@/lib/db/client").then(({ db: d }) =>
    d.userSettings.findUnique({ where: { userId }, select: { currentWeightKg: true } }),
  );
  const currentWeightKg = userSettingsForWeight?.currentWeightKg ?? null;

  // Sprint v0.15: Recomp protein note on first Strength session (1×/week reminder).
  // Added in API glue layer — NOT in engine (CLAUDE.md Rule 1: engine = pure functions).
  const focusMode = phaseRow.macrocycle.focusMode;
  if (focusMode === "recomp") {
    const strengthA = finalSessions.find((s) => s.type === "strength_a");
    if (strengthA && currentWeightKg && currentWeightKg > 0) {
      const proteinNote = `RECOMP: Protein-Ziel ${Math.round(currentWeightKg * 2.0)}–${Math.round(currentWeightKg * 2.5)} g/Tag (2.0–2.5 g/kg). Kaloriendefizit ≤500 kcal. (Garthe 2011, Chappell 2021)`;
      strengthA.notes = strengthA.notes
        ? `${strengthA.notes}\n${proteinNote}`
        : proteinNote;
    }
  }

  // Primary session for legacy single-session UI: first non-rest after modulation
  const finalSession = finalSessions.find((s) => s.type !== "rest" && s.type !== "active_recovery") ?? finalSessions[0];
  const plannedSession = primarySession;

  // 5. Cache computed scores back to today's row (best-effort, non-blocking from caller's perspective).
  await import("@/lib/db/client").then(async ({ db }) => {
    await db.dailySensorData.update({
      where: { id: todayRow.id },
      data: {
        readinessScore: readiness.score,
        readinessBand: readiness.band,
        readinessComponents: readiness.components,
        loadMetrics: {
          dailyLoadAu: load.dailyLoadAu,
          acute7d: load.acute7d,
          chronic28d: load.chronic28d,
          acwrRolling: load.acwrRolling,
          acwrEwma: load.acwrEwma,
          band: load.band,
        },
        kneeScore: limitations.kneeScoreToday,
        therapyPhase: limitations.therapyPhase,
        computedAt: new Date(),
      },
    });
  });

  return NextResponse.json({
    status: "READY",
    plannedSession,
    plannedSessions,
    finalSession,
    finalSessions,
    sensorOutputs: { readiness, load, limitations },
    week: { weekNumber: weekPlan.weekNumber, blockNumber: phaseRow.blockNumber, phaseName: phaseRow.name },
    // Sprint v0.14: macrocycle evaluation state for W20 banner
    macrocycleEvaluated: phaseRow.macrocycle.evaluatedAt !== null,
    totalWeeks: phaseRow.macrocycle.totalWeeks,
    // Sprint v0.15: body weight for ×BW display
    currentWeightKg,
  });
}
