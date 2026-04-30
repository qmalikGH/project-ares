// Sprint v0.12 Phase 3 — Coach tool functions.
//
// Each function corresponds to one Anthropic tool definition (see
// `lib/ai-coach/tools.ts`). When Claude emits a tool_use block via
// `/api/coach/conversation`, we look up the matching function here, run it,
// and return its German-language result string as the tool_result content.
//
// Mutation target: `WeeklyPlan.plannedSessions` is the source of truth for
// future training. Workout rows only materialize at `sessions/start` time —
// the brief's reference to mutating `Workout.plannedSessions` is wrong for
// this codebase. All edits below modify the WeeklyPlan JSON for the current
// macrocycle's active phase, filtered by `macrocycle.status = "active"`
// (v0.10.4 lesson — without it, abandoned macros leak into reads).

import { db } from "@/lib/db/client";
import { userToday } from "@/lib/date";
import { dayKey } from "@/lib/db/queries/sensors";
import { regeneratePlansFromNow } from "@/lib/db/queries/regenerate-plans";
import type {
  Exercise,
  SessionPlan,
  TherapyPhase,
} from "@/lib/coach-engine/types";

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

type Scope = "this_week" | "this_block" | "permanent";
type RunScope = "this_week" | "next_2_weeks" | "rest_of_block";

function endOfThisWeekUtc(today: Date): Date {
  // Monday-anchored ISO week. dayKey gives UTC midnight; Sunday-end is +6 days.
  const d = dayKey(today);
  const dow = d.getUTCDay() || 7; // 0..6 with 0=Sun → 7
  const daysUntilSunday = 7 - dow; // Sun=0, Mon=6, …
  return new Date(d.getTime() + (daysUntilSunday + 1) * 86400000);
}

async function endOfBlockUtc(userId: string, today: Date): Promise<Date> {
  const phase = await db.phase.findFirst({
    where: {
      macrocycle: { userId, status: "active" },
      startDate: { lte: today },
      plannedEndDate: { gt: today },
    },
    select: { plannedEndDate: true },
  });
  return phase?.plannedEndDate ?? new Date(today.getTime() + 28 * 86400000);
}

/** Resolve scope → exclusive end-of-window UTC midnight. */
async function scopeEnd(
  userId: string,
  today: Date,
  scope: Scope,
): Promise<Date> {
  if (scope === "this_week") return endOfThisWeekUtc(today);
  if (scope === "this_block") return endOfBlockUtc(userId, today);
  return new Date(today.getTime() + 365 * 86400000);
}

async function runScopeEnd(
  userId: string,
  today: Date,
  scope: RunScope,
): Promise<Date> {
  if (scope === "this_week") return endOfThisWeekUtc(today);
  if (scope === "next_2_weeks") return new Date(today.getTime() + 14 * 86400000);
  return endOfBlockUtc(userId, today);
}

/** WeeklyPlans whose [startDate, endDate) overlaps [today, end), in the
 *  user's active macrocycle. */
async function loadWeeklyPlansInWindow(
  userId: string,
  start: Date,
  end: Date,
) {
  return db.weeklyPlan.findMany({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      startDate: { lt: end },
      endDate: { gt: start },
    },
    orderBy: { startDate: "asc" },
  });
}

const RUN_TYPES = new Set([
  "easy_run",
  "threshold_run",
  "tempo_run",
  "vo2max_intervals",
  "long_run",
  "calibration_run",
  "time_trial_5k",
  "active_recovery",
]);

function scopeLabelDe(scope: Scope): string {
  return scope === "this_week"
    ? "diese Woche"
    : scope === "this_block"
      ? "diesen Block"
      : "dauerhaft";
}
function runScopeLabelDe(scope: RunScope): string {
  return scope === "this_week"
    ? "diese Woche"
    : scope === "next_2_weeks"
      ? "die nächsten 2 Wochen"
      : "den Rest des Blocks";
}

// ─────────────────────────────────────────────────────
// Tool 1: substitute_exercise
// ─────────────────────────────────────────────────────

export interface SubstituteExerciseInput {
  exerciseName: string;
  replacement: {
    name: string;
    sets?: number;
    reps?: number | string;
    loadPct?: number;
    rpeCap?: number;
    tempo?: string;
    restSec?: number;
    notes?: string;
  };
  scope: Scope;
}

/**
 * Replace every occurrence of `exerciseName` in future strength sessions with
 * the given replacement, within the chosen scope. Only sessions on dates ≥
 * today are touched. HSR-protected lifts (Hex Bar Deadlift, Romanian Deadlift)
 * are refused — Kongsgaard 2009 tendon protocol consistency. Returns a short
 * German status string for the model's tool_result.
 */
export async function substituteExercise(
  userId: string,
  input: SubstituteExerciseInput,
): Promise<string> {
  const HSR_PROTECTED = new Set(["Hex Bar Deadlift", "Romanian Deadlift"]);
  if (HSR_PROTECTED.has(input.exerciseName)) {
    return `${input.exerciseName} ist ein HSR-geschützter Lift (Kongsgaard 2009 Tendon-Protokoll) und wird nicht ersetzt. Wenn Schmerzen das Problem sind, lieber Therapy-Phase auf REACTIVE/DISREPAIR setzen.`;
  }

  const today = userToday();
  const end = await scopeEnd(userId, today, input.scope);
  const plans = await loadWeeklyPlansInWindow(userId, today, end);

  let sessionsTouched = 0;
  let plansTouched = 0;

  for (const plan of plans) {
    if (!Array.isArray(plan.plannedSessions)) continue;
    const sessions = plan.plannedSessions as unknown as SessionPlan[];
    let mutated = false;
    const next = sessions.map((s) => {
      const sessionDate = s.date instanceof Date ? s.date : new Date(s.date);
      if (sessionDate < today || sessionDate >= end) return s;
      if (!s.exercises || s.exercises.length === 0) return s;
      let exMutated = false;
      const newExercises: Exercise[] = s.exercises.map((ex) => {
        if (ex.name !== input.exerciseName) return ex;
        exMutated = true;
        // Carry over fields the user didn't override.
        return {
          name: input.replacement.name,
          sets: input.replacement.sets ?? ex.sets,
          reps: input.replacement.reps ?? ex.reps,
          loadPct: input.replacement.loadPct ?? ex.loadPct,
          rpeCap: input.replacement.rpeCap ?? ex.rpeCap,
          tempo: input.replacement.tempo ?? ex.tempo,
          restSec: input.replacement.restSec ?? ex.restSec,
          notes:
            input.replacement.notes ??
            `Ersetzt ${input.exerciseName} via Coach (${scopeLabelDe(input.scope)}).`,
        };
      });
      if (!exMutated) return s;
      mutated = true;
      sessionsTouched += 1;
      return { ...s, exercises: newExercises };
    });
    if (mutated) {
      await db.weeklyPlan.update({
        where: { id: plan.id },
        data: { plannedSessions: next as unknown as object },
      });
      plansTouched += 1;
    }
  }

  if (sessionsTouched === 0) {
    return `${input.exerciseName} taucht in ${scopeLabelDe(input.scope)} nicht (mehr) im Plan auf — keine Änderung.`;
  }
  return `${input.exerciseName} → ${input.replacement.name} für ${scopeLabelDe(input.scope)} (${sessionsTouched} Session${sessionsTouched === 1 ? "" : "s"} in ${plansTouched} Wochenplan/Plänen angepasst).`;
}

// ─────────────────────────────────────────────────────
// Tool 2: adjust_run_volume
// ─────────────────────────────────────────────────────

export interface AdjustRunVolumeInput {
  multiplier: number; // 0.5..1.5 typical
  scope: RunScope;
}

/**
 * Multiply `durationMin` on every future Run/active_recovery session in the
 * window by `multiplier`, snapped to whole minutes with a 15-min floor.
 * Strength + rest are untouched.
 */
export async function adjustRunVolume(
  userId: string,
  input: AdjustRunVolumeInput,
): Promise<string> {
  if (
    !Number.isFinite(input.multiplier) ||
    input.multiplier <= 0 ||
    input.multiplier > 2
  ) {
    return `Multiplikator ${input.multiplier} ist außerhalb des sinnvollen Bereichs (0–2). Keine Änderung.`;
  }

  const today = userToday();
  const end = await runScopeEnd(userId, today, input.scope);
  const plans = await loadWeeklyPlansInWindow(userId, today, end);

  let touched = 0;
  let plansTouched = 0;

  for (const plan of plans) {
    if (!Array.isArray(plan.plannedSessions)) continue;
    const sessions = plan.plannedSessions as unknown as SessionPlan[];
    let mutated = false;
    const next = sessions.map((s) => {
      const sessionDate = s.date instanceof Date ? s.date : new Date(s.date);
      if (sessionDate < today || sessionDate >= end) return s;
      if (!RUN_TYPES.has(s.type)) return s;
      if (typeof s.durationMin !== "number" || s.durationMin <= 0) return s;
      mutated = true;
      touched += 1;
      const adjusted = Math.max(15, Math.round(s.durationMin * input.multiplier));
      return { ...s, durationMin: adjusted };
    });
    if (mutated) {
      await db.weeklyPlan.update({
        where: { id: plan.id },
        data: { plannedSessions: next as unknown as object },
      });
      plansTouched += 1;
    }
  }

  if (touched === 0) {
    return `In ${runScopeLabelDe(input.scope)} sind keine Run-Sessions zum Anpassen — keine Änderung.`;
  }
  const pct = Math.round((input.multiplier - 1) * 100);
  const sign = pct >= 0 ? "+" : "";
  return `Run-Volumen ${sign}${pct}% für ${runScopeLabelDe(input.scope)} (${touched} Session${touched === 1 ? "" : "s"} in ${plansTouched} Wochenplan/Plänen angepasst).`;
}

// ─────────────────────────────────────────────────────
// Tool 3: set_therapy_phase
// ─────────────────────────────────────────────────────

export interface SetTherapyPhaseInput {
  phase: TherapyPhase;
}

/**
 * Persist a manual therapy-phase override on UserSettings, then regenerate
 * current + future WeeklyPlans so Wall Sit insertion reflects the new state.
 * Same pipeline as `/api/settings/therapy-phase` — shared helper so the
 * Settings UI and the coach can't drift.
 */
export async function setTherapyPhase(
  userId: string,
  input: SetTherapyPhaseInput,
): Promise<string> {
  const valid = ["REACTIVE", "DISREPAIR", "REMODELING", "SPORT_SPECIFIC"];
  if (!valid.includes(input.phase)) {
    return `Phase '${input.phase}' ist ungültig (REACTIVE | DISREPAIR | REMODELING | SPORT_SPECIFIC).`;
  }

  await db.userSettings.upsert({
    where: { userId },
    update: { therapyPhaseOverride: input.phase },
    create: { userId, therapyPhaseOverride: input.phase },
  });

  const result = await regeneratePlansFromNow(userId, { runGarminResync: true });

  const wallSit =
    input.phase === "REACTIVE" || input.phase === "DISREPAIR"
      ? "Wall Sit wird in jede Strength-Session eingefügt."
      : "Kein Wall Sit (REMODELING/SPORT_SPECIFIC).";

  const garmin = result.garminResync
    ? ` Garmin: ${result.garminResync.repushed} re-pushed, ${result.garminResync.removed} removed.`
    : "";

  return `Therapy-Phase = ${input.phase}. ${result.regenerated} Wochenpläne regeneriert. ${wallSit}${garmin}`;
}

// ─────────────────────────────────────────────────────
// Tool 4: skip_session
// ─────────────────────────────────────────────────────

export interface SkipSessionInput {
  /** YYYY-MM-DD date string. */
  date: string;
  reason: string;
  /** Optional — if omitted, ALL non-rest sessions on that date are skipped. */
  type?: string;
}

/**
 * Skip a planned session on a future date.
 *
 * Strategy:
 *   1. If a Workout row already exists (rare — usually only after sessions/start),
 *      flip its status to "skipped" and append the reason to notes.
 *   2. Modify WeeklyPlan.plannedSessions for that date: replace the matching
 *      session(s) with a rest entry (Wall Sit / sensors-stay-visible Q-design).
 *   3. If the session was pushed to Garmin, remove it (best-effort).
 */
export async function skipSession(
  userId: string,
  input: SkipSessionInput,
): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return `Datum '${input.date}' ist nicht im Format YYYY-MM-DD. Keine Änderung.`;
  }
  const targetDate = new Date(`${input.date}T00:00:00.000Z`);
  if (Number.isNaN(targetDate.getTime())) {
    return `Datum '${input.date}' konnte nicht geparst werden.`;
  }

  // 1. Existing Workout rows (date + optional type).
  const workouts = await db.workout.findMany({
    where: {
      userId,
      date: targetDate,
      status: "planned",
      ...(input.type ? { type: input.type } : {}),
    },
  });
  let workoutsMarked = 0;
  for (const w of workouts) {
    await db.workout.update({
      where: { id: w.id },
      data: {
        status: "skipped",
        notes: `Skipped via Coach: ${input.reason}`,
      },
    });
    workoutsMarked += 1;
    // Best-effort Garmin removal.
    if (w.garminWorkoutId) {
      try {
        const { removeWorkoutFromGarmin } = await import(
          "@/lib/garmin/workout-sync"
        );
        await removeWorkoutFromGarmin(w.id);
      } catch {
        /* swallow */
      }
    }
  }

  // 2. Mutate WeeklyPlan.plannedSessions: replace matching session(s) with rest.
  const plan = await db.weeklyPlan.findFirst({
    where: {
      phase: { macrocycle: { userId, status: "active" } },
      startDate: { lte: targetDate },
      endDate: { gt: targetDate },
    },
  });
  let plannedRemoved = 0;
  if (plan && Array.isArray(plan.plannedSessions)) {
    const sessions = plan.plannedSessions as unknown as SessionPlan[];
    const next: SessionPlan[] = [];
    let inserted = false;
    for (const s of sessions) {
      const sd = s.date instanceof Date ? s.date : new Date(s.date);
      const sameDay = sd.getTime() === targetDate.getTime();
      const matchesType = input.type ? s.type === input.type : s.type !== "rest";
      if (sameDay && matchesType) {
        plannedRemoved += 1;
        if (!inserted) {
          next.push({
            date: targetDate,
            type: "rest",
            durationMin: 0,
            notes: `Skipped via Coach: ${input.reason}`,
          });
          inserted = true;
        }
        continue;
      }
      next.push(s);
    }
    if (plannedRemoved > 0) {
      await db.weeklyPlan.update({
        where: { id: plan.id },
        data: { plannedSessions: next as unknown as object },
      });
    }
  }

  if (workoutsMarked === 0 && plannedRemoved === 0) {
    return `Am ${input.date} ${input.type ? `vom Typ '${input.type}'` : ""} keine planbare Session gefunden — keine Änderung.`;
  }
  const garmin = workouts.some((w) => w.garminWorkoutId)
    ? " (Garmin-Push entfernt)"
    : "";
  return `Session(s) am ${input.date} übersprungen — Grund: ${input.reason}. ${workoutsMarked} Workout-Row(s), ${plannedRemoved} Plan-Eintrag/Einträge angepasst.${garmin}`;
}

// ─────────────────────────────────────────────────────
// Public dispatch helper
// ─────────────────────────────────────────────────────

export type CoachToolName =
  | "substitute_exercise"
  | "adjust_run_volume"
  | "set_therapy_phase"
  | "skip_session";

export async function executeCoachTool(
  userId: string,
  name: string,
  rawInput: unknown,
): Promise<string> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "substitute_exercise": {
        const exerciseName = String(input.exerciseName ?? "");
        const scope = (input.scope ?? "this_week") as Scope;
        if (!exerciseName) return "Fehler: exerciseName fehlt.";
        const replacement = {
          name: String(input.replacementName ?? ""),
          sets:
            typeof input.replacementSets === "number"
              ? input.replacementSets
              : undefined,
          reps:
            typeof input.replacementReps === "string" ||
            typeof input.replacementReps === "number"
              ? (input.replacementReps as string | number)
              : undefined,
          loadPct:
            typeof input.replacementLoadPct === "number"
              ? input.replacementLoadPct
              : undefined,
          rpeCap:
            typeof input.replacementRpeCap === "number"
              ? input.replacementRpeCap
              : undefined,
          tempo:
            typeof input.replacementTempo === "string"
              ? input.replacementTempo
              : undefined,
          restSec:
            typeof input.replacementRestSec === "number"
              ? input.replacementRestSec
              : undefined,
          notes:
            typeof input.replacementNotes === "string"
              ? input.replacementNotes
              : undefined,
        };
        if (!replacement.name) return "Fehler: replacementName fehlt.";
        return await substituteExercise(userId, {
          exerciseName,
          replacement,
          scope,
        });
      }
      case "adjust_run_volume": {
        const multiplier = Number(input.multiplier);
        const scope = (input.scope ?? "this_week") as RunScope;
        return await adjustRunVolume(userId, { multiplier, scope });
      }
      case "set_therapy_phase": {
        const phase = String(input.phase ?? "") as TherapyPhase;
        return await setTherapyPhase(userId, { phase });
      }
      case "skip_session": {
        const date = String(input.date ?? "");
        const reason = String(input.reason ?? "kein Grund angegeben");
        const type =
          typeof input.type === "string" && input.type ? input.type : undefined;
        return await skipSession(userId, { date, reason, type });
      }
      default:
        return `Unbekanntes Tool: ${name}`;
    }
  } catch (err) {
    return `Fehler bei ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
