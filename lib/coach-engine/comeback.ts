// Sprint 2.4 — Comeback / Return-to-Training ramp.
//
// WHY THIS EXISTS
// The engine had no concept of detraining. Every protective gate is data-gated
// ("recent shin NRS", "recent RPE", "recent RHR") and every one of them reads
// `null` as "fine, progress". After a long absence there IS no data, so the
// absence of pain reports was being treated as evidence of health: an athlete
// returning from a 9-week layoff got the same prescription as one who had
// trained through — full block volume, full threshold intervals, full TM loads.
//
// science_doc 1.3: detraining is asymmetric. Plasma volume and VO2max come back
// fast; tendon and bone stiffness lag by weeks to months. That mismatch is the
// comeback injury trap — the engine must model it explicitly.
//
// THE ANCHOR
// The ramp must NOT be a flag someone sets and forgets. It is derived from
// facts: the most recent gap ≥ LAYOFF_MIN_GAP_DAYS in COMPLETED sessions. The
// week in which training resumed is the anchor; ramp weeks count forward from
// it and the ramp expires on its own. Once the athlete trains again, the anchor
// stops moving — so completing a session never resets the ramp back to week 1.
//
// Pure module, no imports: it is pulled in by run-coach and periodization, and
// `lib/date.ts` would drag `next/headers` + the Prisma client into them.

/** A gap of this many days or more in completed sessions counts as a layoff. */
export const LAYOFF_MIN_GAP_DAYS = 21;

/** How many weeks the graded return lasts before normal progression resumes. */
export const COMEBACK_RAMP_WEEKS = 3;

export type ComebackWeek = 1 | 2 | 3;

export interface ComebackRamp {
  /** Multiplier on easy + long run minutes. */
  runVolumeFactor: number;
  /** Multiplier on strength loadPct (compounds with the week-in-block value). */
  strengthLoadFactor: number;
  /** Multiplier on strength set count (applyPeriodization floors at 2). */
  strengthSetFactor: number;
  /** Replace the Tuesday quality session with an easy run. */
  suppressQuality: boolean;
}

/**
 * Run volume ramps more cautiously than strength load: muscle memory restores
 * force output within weeks (myonuclei persist, science_doc 1.4), while the
 * bone/tendon remodeling that shin splints depend on is the slow system. The
 * quality day only returns in week 3, and then at the conservative 2×10
 * threshold floor (via greenForProgression=false), not at the block ladder.
 */
const RAMP_BY_WEEK: Record<ComebackWeek, ComebackRamp> = {
  1: {
    runVolumeFactor: 0.55,
    strengthLoadFactor: 0.75,
    strengthSetFactor: 0.75,
    suppressQuality: true,
  },
  2: {
    runVolumeFactor: 0.7,
    strengthLoadFactor: 0.85,
    strengthSetFactor: 1.0,
    suppressQuality: true,
  },
  3: {
    runVolumeFactor: 0.85,
    strengthLoadFactor: 0.95,
    strengthSetFactor: 1.0,
    suppressQuality: false,
  },
};

export function rampFor(week: ComebackWeek): ComebackRamp {
  return RAMP_BY_WEEK[week];
}

export interface LayoffState {
  /** True when a gap ≥ LAYOFF_MIN_GAP_DAYS was detected. */
  active: boolean;
  /** Length of that gap in whole days (0 when inactive). */
  gapDays: number;
  /**
   * Monday of the week in which training resumed. When the layoff is still
   * open (no session completed since the gap started) this is the caller's
   * `fallbackRestartWeekStart` — the first week about to be generated.
   */
  restartWeekStart: Date | null;
}

const INACTIVE: LayoffState = { active: false, gapDays: 0, restartWeekStart: null };

function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * UTC midnight of the Monday that starts `date`'s ISO week; a Monday maps to
 * itself. Every WeeklyPlan.startDate is a Monday, so this aligns an arbitrary
 * date (e.g. the session that ended a layoff) to its plan week.
 */
export function startOfIsoWeek(date: Date): Date {
  const d = toUtcMidnight(date);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Mon→0, …, Sun→6
  return new Date(d.getTime() - daysSinceMonday * 86400000);
}

function diffDays(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

/**
 * Detect the most recent training layoff from completed-session dates.
 *
 * Two shapes:
 *   - layoff still open  → last completed session is ≥ minGap days before
 *     `today`. Training has not resumed yet, so the anchor is the first week
 *     we are about to plan (`fallbackRestartWeekStart`).
 *   - layoff already ended → the gap sits between two completed sessions. The
 *     anchor is the ISO week of the first session after the gap.
 *
 * An athlete with no completed sessions at all is NOT a comeback — that is
 * onboarding's job, and inventing a ramp there would silently halve a new
 * user's first block.
 *
 * Pure.
 */
export function detectLayoff(
  completedDates: readonly Date[],
  today: Date,
  fallbackRestartWeekStart: Date | null,
  minGapDays: number = LAYOFF_MIN_GAP_DAYS,
): LayoffState {
  if (completedDates.length === 0) return INACTIVE;

  const sorted = [...completedDates]
    .map(toUtcMidnight)
    .sort((a, b) => a.getTime() - b.getTime());

  // Layoff still open: nothing completed since the gap began.
  const last = sorted[sorted.length - 1];
  const openGap = diffDays(toUtcMidnight(today), last);
  if (openGap >= minGapDays) {
    return {
      active: true,
      gapDays: openGap,
      restartWeekStart: fallbackRestartWeekStart
        ? startOfIsoWeek(fallbackRestartWeekStart)
        : null,
    };
  }

  // Otherwise: walk backwards for the most recent closed gap.
  for (let i = sorted.length - 1; i > 0; i--) {
    const gap = diffDays(sorted[i], sorted[i - 1]);
    if (gap >= minGapDays) {
      return {
        active: true,
        gapDays: gap,
        restartWeekStart: startOfIsoWeek(sorted[i]),
      };
    }
  }

  return INACTIVE;
}

/**
 * Which comeback week a plan week falls into, or null when the ramp does not
 * apply (week is before the restart, or the ramp has already expired).
 *
 * Both dates are expected to be Mondays (WeeklyPlan.startDate always is);
 * `restartWeekStart` is normalized by `detectLayoff`. Pure.
 */
export function comebackWeekFor(
  weekStartDate: Date,
  restartWeekStart: Date | null,
): ComebackWeek | null {
  if (!restartWeekStart) return null;
  const weeksSince = Math.round(
    (startOfIsoWeek(weekStartDate).getTime() - restartWeekStart.getTime()) /
      (7 * 86400000),
  );
  if (weeksSince < 0 || weeksSince >= COMEBACK_RAMP_WEEKS) return null;
  return (weeksSince + 1) as ComebackWeek;
}
