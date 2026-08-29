// VDOT auto-recalibration driver — Sprint 2.6 (A6).
//
// The impure half of vdot-autocalibration.ts, shaped after recalibrateHrRest:
// gather → decide (pure) → persist → let downstream refresh.
//
// WHY IT LIVES IN THE DAILY CRON AND NOT IN sessions/complete
// The old rolling recalibration was 65 lines inline in the completion route —
// the only calibration in the repo without its own module, without a *Source
// field, and without a *CalibratedAt timestamp. It also could not do the one
// thing that matters: applying a new VDOT means rewriting every future pace,
// which is far too much work to hang off a user-facing request.
//
// The daily Garmin cron is the right home: it already holds a warm Garmin
// session (getRecentRunSummaries hits the Garmin API live, it does not read our
// DB), it already damps recalibrations to once per 7 days, and the heavy
// regenerate happens off the athlete's critical path.
//
// DOWNSTREAM: unlike hrRest — which Karvonen re-derives on every read — paces
// are BAKED into WeeklyPlan.plannedSessions and copied into Workout.plannedSession.
// A new VDOT that is not regenerated + materialized is invisible. We deliberately
// do NOT call resyncFutureWorkoutsToGarmin here: that is an unbounded serial
// fan-out (~100 workouts × up to 4 HTTP calls) in a single invocation. The 19:00
// push cron carries the new paces to the watch evening by evening instead.
import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";
import { getRecentRunSummaries } from "@/lib/garmin/profile";
import { calibrateVdotFromRuns } from "@/lib/coach-engine/vdot-calculator";
import { detectLayoff, comebackWeekFor } from "@/lib/coach-engine/comeback";
import { deriveVolumeGate } from "@/lib/db/queries/regenerate-plans-helpers";
import { getEffectiveVdot } from "@/lib/db/queries/settings";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import { materializeWorkouts } from "@/lib/coach-engine/materialize";
import { createNotificationIfNew } from "@/lib/notifications/create";
import { ExecutedSessionSchema } from "@/lib/coach-engine/types";
import {
  decideVdotUpdate,
  VDOT_SOURCE_AUTO,
  type VdotAutoDecision,
} from "@/lib/coach-engine/vdot-autocalibration";

/** Garmin history pulled, then narrowed to the freshest runs. */
const RUN_HISTORY_DAYS = 60;
const ROLLING_WINDOW_RUNS = 14;
const MIN_RUNS_FOR_AUTO = 5;
/** Matches loadRecentShinSignal's window so the gate sees the same evidence. */
const SHIN_WINDOW_DAYS = 10;
const RHR_WINDOW_DAYS = 14;
/** Notifications are deduped per week — one voice per calibration cycle. */
const NOTIFY_DEDUPE_MINUTES = 10080;

export interface VdotRecalibrationResult {
  status: VdotAutoDecision["status"] | "no_user_settings" | "no_hr_profile" | "too_few_runs";
  decision?: VdotAutoDecision;
  runsConsidered?: number;
  regenerated?: number;
}

/**
 * Recompute VDOT from the rolling Garmin run window and apply it when the pure
 * decider allows. Returns a status rather than throwing; the cron logs it.
 */
export async function recalibrateVdot(userId: string): Promise<VdotRecalibrationResult> {
  const settings = await db.userSettings.findUnique({
    where: { userId },
    select: {
      hrMax: true,
      hrRest: true,
      vdotSource: true,
      vdotOverrideAt: true,
      notificationPrefs: true,
    },
  });
  if (!settings) return { status: "no_user_settings" };
  // The calibrator needs both to normalise effort; without them every method
  // is unusable. Not an error — an un-onboarded profile.
  if (!settings.hrMax || !settings.hrRest) return { status: "no_hr_profile" };

  const recentRuns = await getRecentRunSummaries(RUN_HISTORY_DAYS);
  const window = recentRuns.slice(-ROLLING_WINDOW_RUNS);
  if (window.length < MIN_RUNS_FOR_AUTO) {
    return { status: "too_few_runs", runsConsidered: window.length };
  }

  const calibration = calibrateVdotFromRuns(window, settings.hrMax, settings.hrRest);
  const currentVdot = await getEffectiveVdot(userId);
  const today0 = userToday();

  // Re-derive the same two brakes the plan generator uses, so an upward move is
  // judged against the athlete's current state and not just the measurement.
  const { layoffActive, volumeGate } = await loadBrakes(userId, today0);

  const decision = decideVdotUpdate({
    currentVdot,
    calibration: {
      finalVdot: calibration.finalVdot,
      confidence: calibration.confidence,
      insufficientData: calibration.insufficient_data,
    },
    vdotSource: settings.vdotSource,
    vdotSetAt: settings.vdotOverrideAt,
    layoffActive,
    volumeGate,
    now: new Date(),
  });

  if (decision.status !== "applied" || decision.newVdot === null) {
    return { status: decision.status, decision, runsConsidered: window.length };
  }

  const methodSummary = calibration.estimates.map((e) => `${e.method}=${e.vdot}`).join(", ");
  await db.userSettings.update({
    where: { userId },
    data: {
      vdotOverride: decision.newVdot,
      vdotOverrideAt: new Date(),
      vdotSource: VDOT_SOURCE_AUTO,
      vdotOverrideRationale:
        `Auto-Kalibrierung aus den letzten ${window.length} Läufen: ${methodSummary}. ` +
        `Konfidenz ${calibration.confidence}, Range ${calibration.range.min}–${calibration.range.max}. ` +
        decision.reason,
    },
  });

  // Paces are materialized, not derived on read — see the header note.
  // regeneratePlansFromNow re-reads getEffectiveVdot itself and applies the
  // shin gate + comeback ramp, so the new paces arrive already braked.
  const regen = await regeneratePlansFromNow(userId);
  await materializeWorkouts(userId, today0);

  const prefs = settings.notificationPrefs as { vdotCalibrated?: boolean } | null;
  if (prefs?.vdotCalibrated !== false) {
    await createNotificationIfNew(
      {
        userId,
        type: "VDOT_CALIBRATED",
        title: `VDOT angepasst: ${decision.currentVdot} → ${decision.newVdot}`,
        message: `${decision.reason} Aus ${window.length} Läufen: ${methodSummary}. Die Tempi der kommenden Wochen wurden aktualisiert.`,
        severity: "INFO",
        actionUrl: "/settings",
      },
      NOTIFY_DEDUPE_MINUTES,
    );
  }

  return {
    status: "applied",
    decision,
    runsConsidered: window.length,
    regenerated: regen.regenerated,
  };
}

/**
 * The two state brakes an upward move must clear. Mirrors what
 * regeneratePlansFromNow derives, so the calibration and the plan generator
 * cannot disagree about whether the athlete is ready to go faster.
 */
async function loadBrakes(
  userId: string,
  today0: Date,
): Promise<{ layoffActive: boolean; volumeGate: "progress" | "hold" | "regress" }> {
  const completed = await db.workout.findMany({
    where: {
      userId,
      status: "completed",
      date: { gte: new Date(today0.getTime() - 180 * 86400000), lte: today0 },
      NOT: { type: { in: ["rest", "active_recovery"] } },
    },
    orderBy: { date: "asc" },
    select: { date: true },
  });

  const nextWeek = await db.weeklyPlan.findFirst({
    where: { phase: { macrocycle: { userId, status: "active" } }, endDate: { gt: today0 } },
    orderBy: { startDate: "asc" },
    select: { startDate: true },
  });

  const layoff = detectLayoff(
    completed.map((w) => w.date),
    today0,
    nextWeek?.startDate ?? null,
  );
  const layoffActive =
    layoff.active && comebackWeekFor(nextWeek?.startDate ?? today0, layoff.restartWeekStart) !== null;

  const shinCutoff = new Date(today0.getTime() - SHIN_WINDOW_DAYS * 86400000);
  const recent = await db.workout.findMany({
    where: { userId, status: "completed", date: { gte: shinCutoff, lte: today0 } },
    select: { executedSession: true },
  });
  let recentShin: number | null = null;
  // Sprint 2.9: count only sessions somebody actually rated. An auto-imported
  // session is proof the athlete ran, not proof the shin was quiet — and this
  // gate is one of the two brakes on raising the VDOT.
  let attestedInWindow = 0;
  for (const w of recent) {
    const parsed = ExecutedSessionSchema.safeParse(w.executedSession);
    if (!parsed.success) continue;
    const s = (parsed.data as { shinPainNrs?: number }).shinPainNrs;
    if (typeof s === "number") {
      recentShin = recentShin === null ? s : Math.max(recentShin, s);
      attestedInWindow++;
    }
  }

  const rhrRows = await db.dailySensorData.findMany({
    where: { userId, date: { gte: new Date(today0.getTime() - RHR_WINDOW_DAYS * 86400000) } },
    orderBy: { date: "desc" },
    take: 5,
    select: { garmin: true },
  });
  let latestRhr: number | null = null;
  for (const r of rhrRows) {
    const v = (r.garmin as { rhr?: number } | null)?.rhr;
    if (typeof v === "number") {
      latestRhr = v;
      break;
    }
  }
  const baseline = await db.userSettings.findUnique({
    where: { userId },
    select: { hrRest: true },
  });

  const { gate } = deriveVolumeGate({
    recentShin,
    completedInWindow: recent.length,
    attestedInWindow,
    latestRhr,
    baselineRhr: baseline?.hrRest ?? null,
  });

  return { layoffActive, volumeGate: gate };
}
