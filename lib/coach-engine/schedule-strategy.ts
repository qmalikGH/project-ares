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
// Default Q pattern derived from these (Sprint 3.3: four training days):
//   Mon: Strength A (HSR Deadlift) + Easy Run — strength first, ≥3h gap
//   Tue: Quality Run alone (24h after lower-body strength)
//   Wed: REST (forced) + home prevention
//   Thu: Strength B + Easy Run — strength first, ≥3h gap
//   Fri: REST (forced) + home prevention
//   Sat: Long Run alone (fresh legs)
//   Sun: REST (forced) + home prevention
// Strength runs in the office gym at midday on the office days (Mon/Thu), the
// run is the way home in the evening — Gao 2023 / Markov 2021 order.

import type { SessionPlan, SessionType } from "./types";
import { buildPreventionSession } from "./prevention";

export interface WeekScheduleConstraints {
  /** 0 = Mon, 1 = Tue, ..., 6 = Sun. Sessions placed on these days are dropped/replaced with rest. */
  forcedRestDays: Set<number>;
  /** 0 = Mon, ..., 6 = Sun. Long run goes here unless it's a forced rest day. */
  preferredLongRunDay: number;
  /** Reserved for future (e.g. evening-only schedules); unused in v0.10 day placement. */
  morningOnly: boolean;
}

/** Q's default constraints — Wed, Fri, Sun forced rest (Sprint 3.3), Sat long run. */
export const Q_DEFAULT_CONSTRAINTS: WeekScheduleConstraints = {
  forcedRestDays: new Set([2, 4, 6]),
  preferredLongRunDay: 5,
  morningOnly: false,
};

/** Sprint 3.3: per-week inputs the placement needs besides the constraints. */
export interface WeekScheduleOptions {
  /**
   * B1 single-session cap for this week. Easy minutes that are merged into
   * the remaining easy runs never push one past it — the cap wins.
   */
  maxRunMin?: number;
  /** A4: UserSettings.preventionExercises; a home routine on every forced rest day. */
  preventionExercises?: readonly string[];
}

/**
 * Re-place sessions into the week per constraints + concurrent-training rules.
 *
 * Strength → fixed slots (A=Mon, B=Thu) when those days are training days.
 * If a target day is in `forcedRestDays`, that strength session is DROPPED for
 * the week (we don't quietly shift it into another day — that would silently
 * over-load whatever day picks it up, and Q sees the gap explicitly).
 *
 * Quality run → Tue alone (24h after lower-body strength).
 * Long run → preferredLongRunDay alone.
 * Easy runs → paired with strength days, strength FIRST (≥3h gap).
 * Sprint 3.3: easy runs that find no day used to be dropped in silence. With
 * four training days that is the normal case (three easy runs, two strength
 * days), so their minutes are now spread over the placed easy runs — the week
 * keeps its easy minutes, up to the B1 cap (`opts.maxRunMin`), which wins.
 *
 * Forced-rest days get an explicit `rest` SessionPlan entry so the day is
 * visible in the week view, and — Sprint 3.3 (A4) — the home prevention
 * routine next to it. The marker never displaces it.
 *
 * Pure — does not mutate inputs; returns a new array sorted Mon→Sun.
 */
export function planWeekSchedule(
  runSessions: SessionPlan[],
  strengthSessions: SessionPlan[],
  weekStartMonday: Date,
  constraints: WeekScheduleConstraints,
  opts: WeekScheduleOptions = {},
): SessionPlan[] {
  const days: SessionPlan[][] = Array.from({ length: 7 }, () => []);

  // 1. Place forced rest days (visible markers) + the home prevention routine.
  for (const restDay of constraints.forcedRestDays) {
    if (restDay < 0 || restDay > 6) continue;
    const date = dateAtOffset(weekStartMonday, restDay);
    days[restDay].push({ date, type: "rest", durationMin: 0 });
    const prevention = buildPreventionSession(date, opts.preventionExercises ?? []);
    if (prevention) days[restDay].push(prevention);
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

  // 5. Strength placement: A=Mon(0), B=Thu(3). Each strength day also gets a
  // paired easy run — strength first, the run ≥3h later (Gao 2023, Markov
  // 2021). strength_c is no longer generated; it keeps no slot.
  const strengthDayMap: Record<string, number> = {
    strength_a: 0,
    strength_b: 3,
  };

  const strengthSorted = sortStrengthByOrder(strengthSessions);
  const easyQueue = [...easyRuns];
  const placedEasy: SessionPlan[] = [];

  for (const str of strengthSorted) {
    const targetDay = strengthDayMap[str.type];
    if (targetDay === undefined) continue;
    if (constraints.forcedRestDays.has(targetDay)) continue;

    // Strength session at the target day.
    days[targetDay].push({
      ...str,
      date: dateAtOffset(weekStartMonday, targetDay),
    });

    // Pair an easy run on the same day, after the strength block.
    const pairedEasy = easyQueue.shift();
    if (pairedEasy) {
      const placed = { ...pairedEasy, date: dateAtOffset(weekStartMonday, targetDay) };
      days[targetDay].push(placed);
      placedEasy.push(placed);
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
      const placed = { ...next, date: dateAtOffset(weekStartMonday, d) };
      days[d].push(placed);
      placedEasy.push(placed);
    }
  }

  // 6a. Sprint 3.3: whatever still has no day is merged, not dropped. The
  // week's easy minutes are spread evenly over the placed easy runs, each one
  // capped at opts.maxRunMin.
  if (easyQueue.length > 0 && placedEasy.length > 0) {
    const total = [...placedEasy, ...easyQueue].reduce((n, s) => n + (s.durationMin ?? 0), 0);
    const cap = opts.maxRunMin ?? Infinity;
    placedEasy.forEach((s, i) => {
      const share = Math.floor(total / placedEasy.length) + (i < total % placedEasy.length ? 1 : 0);
      s.durationMin = Math.min(cap, share);
    });
    easyQueue.length = 0;
  }

  // 6b. Sprint v0.13: Strip pre-run activation from S+E days. The strength
  // templates already cover hip/core activation patterns — adding the
  // pre-run block would be redundant. Activation only stays on run-only
  // days (typically Tue=quality, Sat=long run).
  // Sprint 3.3 (B3): activation is no longer inside durationMin, so stripping
  // it leaves the running time alone.
  for (let d = 0; d < 7; d++) {
    const hasStrength = days[d].some((s) => s.type.startsWith("strength"));
    if (hasStrength) {
      for (const s of days[d]) {
        if (s.preRunActivation) {
          delete s.preRunActivation;
          delete s.activationMin;
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

/** Sprint 3.3: Mon = Strength A, Thu = Strength B. */
const STRENGTH_DAYS: ReadonlySet<number> = new Set([0, 3]);

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
 *   4. Quality runs cannot land on a strength day (Mon A, Thu B) — violates
 *      the 24h-gap-to-lower-body-strength rule (Casado 2022, Schumann 2021).
 *      Sprint 3.3: B carries RDL, split squats and Nordics since Kraft C was
 *      merged into it, so Thu joined Mon.
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

  // Quality-run gap rule: Mon (A) and Thu (B) carry lower-body strength →
  // quality there breaks the 24h-gap-to-lower-body rule.
  if (QUALITY_RUN_TYPES.has(sessionType) && STRENGTH_DAYS.has(toOffset)) {
    return {
      ok: false,
      reason: "Quality-Run am Krafttag verletzt die 24h-Regel zu Lower-Body-Strength (Casado 2022, Schumann 2021).",
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
