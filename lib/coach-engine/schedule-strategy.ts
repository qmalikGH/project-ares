// Schedule-Constraint Engine (Sprint v0.10) — pure module.
//
// Separates session GENERATION (run-coach + strength-coach produce N
// sessions per week with default day-offsets) from PLACEMENT (this module
// re-dates the sessions to comply with user-specific forced rest days +
// concurrent-training science).
//
// Why separate: the v0.9 strength-coach hard-coded Mon/Wed/Fri offsets,
// which collided with Q's office-Wednesday and locked Strength B into a
// rest day. Schedule-strategy expresses the placement rules deterministically
// from constraints + science.
//
// Evidence base:
//   - Schumann 2021 (43 SR+MA): same-day strength + endurance need ≥3h gap;
//     otherwise explosive-strength attenuates.
//   - Markov 2021 (15 SR+MA): aerobic-before-strength → strength decline,
//     larger when aerobic > 30min. Strength FIRST when same-day.
//   - Gao 2023 (19 RCTs MA): strength → endurance > endurance → strength
//     for lower-limb strength gains (SMD = 0.19).
//   - Casado 2022 (SR elite): hard-day / easy-day basis is standard.
//   - Lundberg 2022 (15 SR+MA): type-I-fiber hypertrophy negative when
//     aerobic = running (relevant for Q).
//
// Default Q pattern derived from these:
//   Mon: Easy Run + Strength A (HSR Hex Bar Deadlift)
//   Tue: Quality Run alone (24h before lower-body strength)
//   Wed: REST (forced — office day)
//   Thu: Easy Run + Strength B (Upper + Hip)
//   Fri: Easy Run + Strength C (Mixed + Plyo)
//   Sat: Long Run alone (fresh legs)
//   Sun: REST (forced)

import type { SessionPlan, SessionType } from "./types";
import { ACTIVATION_DURATION_MIN } from "./run-coach/activation";

export interface WeekScheduleConstraints {
  /** 0 = Mon, 1 = Tue, ..., 6 = Sun. Sessions placed on these days are dropped/replaced with rest. */
  forcedRestDays: Set<number>;
  /** 0 = Mon, ..., 6 = Sun. Long run goes here unless it's a forced rest day. */
  preferredLongRunDay: number;
  /** Reserved for future (e.g. evening-only schedules); unused in v0.10 day placement. */
  morningOnly: boolean;
}

/** Q's default constraints — Wed (office) + Sun (recovery) forced rest, Sat long run. */
export const Q_DEFAULT_CONSTRAINTS: WeekScheduleConstraints = {
  forcedRestDays: new Set([2, 6]),
  preferredLongRunDay: 5,
  morningOnly: false,
};

/**
 * Re-place sessions into the week per constraints + concurrent-training rules.
 *
 * Strength → fixed slots (A=Mon, B=Thu, C=Fri) when those days are training days.
 * If a target day is in `forcedRestDays`, that strength session is DROPPED for
 * the week (we don't quietly shift it into another day — that would silently
 * over-load whatever day picks it up, and Q sees the gap explicitly).
 *
 * Quality run → Tue alone (24h gap to next lower-body strength).
 * Long run → preferredLongRunDay alone.
 * Easy runs → paired with strength days (cardio AM + strength PM, ≥3h gap).
 * Excess easy runs that don't fit a strength-day slot are dropped — the run-
 * coach already generates the right COUNT, so this only happens for unusual
 * constraint configurations.
 *
 * Forced-rest days get an explicit `rest` SessionPlan entry so the day is
 * visible in the week view.
 *
 * Pure — does not mutate inputs; returns a new array sorted Mon→Sun.
 */
export function planWeekSchedule(
  runSessions: SessionPlan[],
  strengthSessions: SessionPlan[],
  weekStartMonday: Date,
  constraints: WeekScheduleConstraints,
): SessionPlan[] {
  const days: SessionPlan[][] = Array.from({ length: 7 }, () => []);

  // 1. Place forced rest days (visible markers).
  for (const restDay of constraints.forcedRestDays) {
    if (restDay < 0 || restDay > 6) continue;
    days[restDay].push({
      date: dateAtOffset(weekStartMonday, restDay),
      type: "rest",
      durationMin: 0,
    });
  }

  // 2. Sort runs by priority (long → quality → easy).
  const sortedRuns = sortRunsByPriority(runSessions);
  const qualityRun = sortedRuns.find((r) =>
    [
      "threshold_run",
      "tempo_run",
      "vo2max_intervals",
      "calibration_run",
      "time_trial_5k",
    ].includes(r.type),
  );
  const longRun = sortedRuns.find((r) => r.type === "long_run");
  const easyRuns = sortedRuns.filter((r) =>
    ["easy_run", "active_recovery"].includes(r.type),
  );

  // 3. Quality run on Tue (day 1) alone, if not forced rest.
  const QUALITY_DAY = 1;
  if (qualityRun && !constraints.forcedRestDays.has(QUALITY_DAY)) {
    days[QUALITY_DAY].push({
      ...qualityRun,
      date: dateAtOffset(weekStartMonday, QUALITY_DAY),
    });
  }

  // 4. Long run on preferred day alone, if not forced rest.
  if (
    longRun &&
    !constraints.forcedRestDays.has(constraints.preferredLongRunDay)
  ) {
    days[constraints.preferredLongRunDay].push({
      ...longRun,
      date: dateAtOffset(weekStartMonday, constraints.preferredLongRunDay),
    });
  }

  // 5. Strength placement: A=Mon(0), B=Thu(3), C=Fri(4). Each strength day
  // also gets a paired easy run (cardio AM, strength PM, ≥3h gap).
  const strengthDayMap: Record<string, number> = {
    strength_a: 0,
    strength_b: 3,
    strength_c: 4,
  };

  const strengthSorted = sortStrengthByOrder(strengthSessions);
  const easyQueue = [...easyRuns];

  for (const str of strengthSorted) {
    const targetDay = strengthDayMap[str.type];
    if (targetDay === undefined) continue;
    if (constraints.forcedRestDays.has(targetDay)) continue;

    // Strength session at the target day.
    days[targetDay].push({
      ...str,
      date: dateAtOffset(weekStartMonday, targetDay),
    });

    // Pair an easy run on the same day, ahead of the strength block.
    const pairedEasy = easyQueue.shift();
    if (pairedEasy) {
      days[targetDay].unshift({
        ...pairedEasy,
        date: dateAtOffset(weekStartMonday, targetDay),
      });
    }
  }

  // 6. Remaining easy runs go onto any leftover training days that aren't
  // already double-booked with strength + easy. Keep order Mon→Sun.
  if (easyQueue.length > 0) {
    for (let d = 0; d < 7 && easyQueue.length > 0; d++) {
      if (constraints.forcedRestDays.has(d)) continue;
      // Skip days that already have a quality/long-run alone — don't pollute.
      const hasNonRest = days[d].some(
        (s) => s.type !== "rest" && !s.type.startsWith("strength"),
      );
      if (hasNonRest) continue;
      const next = easyQueue.shift();
      if (!next) break;
      days[d].push({ ...next, date: dateAtOffset(weekStartMonday, d) });
    }
  }

  // 6b. Sprint v0.13: Strip pre-run activation from S+E days. The strength
  // templates already cover hip/core activation patterns — adding the
  // pre-run block would be redundant. Activation only stays on run-only
  // days (typically Tue=quality, Sat=long run).
  for (let d = 0; d < 7; d++) {
    const hasStrength = days[d].some((s) => s.type.startsWith("strength"));
    if (hasStrength) {
      for (const s of days[d]) {
        if (s.preRunActivation) {
          s.durationMin = (s.durationMin ?? 0) - ACTIVATION_DURATION_MIN;
          delete s.preRunActivation;
        }
      }
    }
  }

  // 7. Flatten Mon → Sun.
  const result: SessionPlan[] = [];
  for (let i = 0; i < 7; i++) {
    for (const sess of days[i]) result.push(sess);
  }
  return result;
}

// ============================================
// Helpers
// ============================================

function sortRunsByPriority(runs: SessionPlan[]): SessionPlan[] {
  const priority: Record<string, number> = {
    long_run: 1,
    threshold_run: 2,
    vo2max_intervals: 2,
    tempo_run: 2,
    calibration_run: 2,
    time_trial_5k: 2,
    easy_run: 3,
    active_recovery: 3,
  };
  return [...runs].sort(
    (a, b) => (priority[a.type] ?? 99) - (priority[b.type] ?? 99),
  );
}

function sortStrengthByOrder(sessions: SessionPlan[]): SessionPlan[] {
  const order = ["strength_a", "strength_b", "strength_c"];
  return [...sessions].sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
  );
}

function dateAtOffset(monday: Date, dayOffset: number): Date {
  return new Date(monday.getTime() + dayOffset * 86400000);
}

// ============================================
// User-settings adapter
// ============================================

/**
 * Convert UserSettings's ISO-day arrays (1=Mon..7=Sun) to the internal
 * 0=Mon..6=Sun representation. Provides a single conversion point so the
 * pure module stays normalized.
 */
export function constraintsFromUserSettings(input: {
  forcedRestDaysIso?: number[] | null;
  preferredLongRunDayIso?: number | null;
}): WeekScheduleConstraints {
  const restDays =
    Array.isArray(input.forcedRestDaysIso) && input.forcedRestDaysIso.length > 0
      ? input.forcedRestDaysIso.map((d) => Math.max(0, Math.min(6, d - 1)))
      : Array.from(Q_DEFAULT_CONSTRAINTS.forcedRestDays);

  const longRunDay =
    typeof input.preferredLongRunDayIso === "number"
      ? Math.max(0, Math.min(6, input.preferredLongRunDayIso - 1))
      : Q_DEFAULT_CONSTRAINTS.preferredLongRunDay;

  return {
    forcedRestDays: new Set(restDays),
    preferredLongRunDay: longRunDay,
    morningOnly: false,
  };
}

// ============================================
// Reschedule validation (coach tool)
// ============================================

const QUALITY_RUN_TYPES: ReadonlySet<SessionType> = new Set([
  "threshold_run",
  "tempo_run",
  "vo2max_intervals",
  "calibration_run",
  "time_trial_5k",
]);

const STRENGTH_TYPES: ReadonlySet<SessionType> = new Set([
  "strength_a",
  "strength_b",
  "strength_c",
]);

export interface MoveValidationResult {
  ok: boolean;
  /** German user-facing reason when ok=false. Surfaced via the coach. */
  reason?: string;
}

export interface CanMoveSessionInput {
  fromDate: Date;
  toDate: Date;
  sessionType: SessionType;
  weekStartMonday: Date;
  /** All sessions currently planned for the week (Mon→Sun). */
  weekSessions: SessionPlan[];
  constraints: WeekScheduleConstraints;
}

/**
 * Returns 0..6 (Mon..Sun) for a UTC-midnight date relative to a Monday-anchor
 * week-start. Inputs outside [weekStartMonday, weekStartMonday+7d) return -1.
 */
function dayOffsetWithinWeek(date: Date, weekStartMonday: Date): number {
  const diffMs = date.getTime() - weekStartMonday.getTime();
  if (diffMs < 0) return -1;
  const offset = Math.floor(diffMs / 86400000);
  if (offset > 6) return -1;
  return offset;
}

/**
 * Validate a same-week session reschedule against the periodisation rules
 * the coach tool's `reschedule_session` enforces. Pure — no DB / mutation.
 *
 * Rules (in order of evaluation):
 *   1. Trivial: from === to → no-op.
 *   2. Both dates must lie within [weekStartMonday, +7d).
 *   3. toDate cannot be in `constraints.forcedRestDays`.
 *   4. Quality runs cannot land on Mon (Strength A slot) — violates the
 *      24h-gap-to-lower-body-strength rule (Casado 2022, Schumann 2021).
 *   5. Strength sessions cannot land on a day that already has a different
 *      strength session (slot collision).
 *   6. Long-run slot is reserved on `preferredLongRunDay` if a long_run is
 *      already scheduled there.
 *   7. Density: target day cannot already host two non-rest sessions.
 */
export function canMoveSession(input: CanMoveSessionInput): MoveValidationResult {
  const {
    fromDate,
    toDate,
    sessionType,
    weekStartMonday,
    weekSessions,
    constraints,
  } = input;

  const fromOffset = dayOffsetWithinWeek(fromDate, weekStartMonday);
  const toOffset = dayOffsetWithinWeek(toDate, weekStartMonday);

  if (fromOffset === -1 || toOffset === -1) {
    return {
      ok: false,
      reason: "Verschieben über Wochengrenzen wird nicht unterstützt — bitte skippen und nächste Woche neu einplanen.",
    };
  }

  if (fromOffset === toOffset) {
    return { ok: false, reason: "Quell- und Zieltag sind identisch." };
  }

  if (constraints.forcedRestDays.has(toOffset)) {
    return {
      ok: false,
      reason: "Zieltag ist ein Pflicht-Ruhetag — kein Training möglich.",
    };
  }

  // Sessions already on the target day (excluding rest markers).
  const targetSessions = weekSessions.filter((s) => {
    if (s.type === "rest") return false;
    const offset = dayOffsetWithinWeek(
      s.date instanceof Date ? s.date : new Date(s.date),
      weekStartMonday,
    );
    return offset === toOffset;
  });

  // Quality-run gap rule: Mon is locked to Strength A → quality there
  // breaks the 24h-gap-to-lower-body rule.
  if (QUALITY_RUN_TYPES.has(sessionType) && toOffset === 0) {
    return {
      ok: false,
      reason: "Quality-Run am Strength-A-Tag verletzt die 24h-Regel zu Lower-Body-Strength (Casado 2022, Schumann 2021).",
    };
  }

  // Strength-slot collision.
  if (STRENGTH_TYPES.has(sessionType)) {
    const collidingStrength = targetSessions.find((s) =>
      STRENGTH_TYPES.has(s.type) && s.type !== sessionType,
    );
    if (collidingStrength) {
      return {
        ok: false,
        reason: `Zieltag hat schon ${collidingStrength.type} — zwei Strength-Sessions am gleichen Tag sind nicht vorgesehen.`,
      };
    }
  }

  // Long-run slot guard.
  if (
    sessionType === "long_run" &&
    toOffset !== constraints.preferredLongRunDay
  ) {
    return {
      ok: false,
      reason: "Long-Run gehört auf den Long-Run-Tag — über Settings ändern, nicht via Reschedule.",
    };
  }
  const collidingLongRun = targetSessions.find(
    (s) => s.type === "long_run" && sessionType !== "long_run",
  );
  if (collidingLongRun) {
    return {
      ok: false,
      reason: "Long-Run-Tag ist reserviert — andere Sessions würden den Erholungseffekt stören.",
    };
  }

  // Density cap: max 2 non-rest sessions per day (e.g. Easy Run + Strength).
  if (targetSessions.length >= 2) {
    return {
      ok: false,
      reason: "Zieltag ist bereits mit zwei Sessions belegt.",
    };
  }

  return { ok: true };
}
