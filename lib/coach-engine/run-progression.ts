// Sprint 3.3 (B1/B2/B5) — run progression from completed sessions. Pure.
//
// WHY THIS EXISTS
// The calendar used to decide how much the athlete runs. After the comeback ramp
// expired the plan jumped straight back to calendar level — a 44-minute long run
// followed by an 80-minute one, a 2×10 threshold followed by 3×10 — no matter
// how many of the ramp sessions had actually been run. The calendar keeps the
// deload rhythm and the template rotation; HOW MUCH and HOW HARD now follow
// what was done.
//
// THREE RULES
//   B1 single-session cap: no run is longer than
//        max(30, floor(1.1 × longest counted run of the 30 days before the week)).
//      Frandsen et al. 2025 (BJSM 59:1203, ~5,200 Garmin runners): a single
//      session more than 10 % longer than the longest run of the previous 30
//      days carried significantly more overuse injuries; the week-to-week ratio
//      did not. Runs up to 30 min are always allowed. The floor keeps the rule
//      monotone: more evidence can never lower the cap below "no evidence".
//      Sprint 3.3b (#25 · 2): in a deload week every run stays under
//      0.75 × the cap, and so do the fit checks for quality and test.
//   B2 threshold ladder: one rung above the highest rung completed in the 28
//      days before the week. Nothing completed → the bottom rung.
//   B5 3-km test: in a deload week, never before TIME_TRIAL_EARLIEST, at most
//      every second deload week, and only when the test fits under the cap.
//
// WHAT COUNTS AS DONE
// Only what somebody measured or typed in. Sprint 3.2a: a confirmation without a
// duration carries the plan as an estimate, and a plan is not a measurement —
// callers pass Workout.durationActualMin and nothing else. Every run type counts
// with its full running time, warm-up and recovery jogs included.
//
// PROJECTION
// When the plan is regenerated week by week, planned sessions from today on are
// fed back in as if done (`project*`). That turns the cap into a visible +10 %
// staircase instead of a cliff. Past sessions nobody confirmed are NOT projected:
// without data there is no progression.

const DAY_MS = 86400000;

/** Runs up to this long are always allowed (B1). */
export const RUN_CAP_FLOOR_MIN = 30;
/** Largest single-session step over the 30-day longest run (B1). */
export const RUN_CAP_GROWTH = 1.1;
export const RUN_CAP_WINDOW_DAYS = 30;
/** Share of the cap a deload week may use for any single run (#25 · 2). */
export const DELOAD_CAP_SHARE = 0.75;
/** How far back a completed threshold rung counts (B2). */
export const THRESHOLD_HISTORY_DAYS = 28;
/** Top rung index of the threshold ladder (L0..L3). */
export const THRESHOLD_TOP_INDEX = 3;

/**
 * The first 3-km test sits in the deload week of 24.11.2026 at the earliest.
 * Coach decision (#21): a test straight after a training break measures the
 * break, not the athlete.
 */
export const TIME_TRIAL_EARLIEST = new Date("2026-11-24T00:00:00.000Z");
/** "Every second deload week" — deloads come every 4 weeks. */
export const TIME_TRIAL_SPACING_DAYS = 56;

export interface CountedRun {
  date: Date;
  minutes: number;
}

export interface CompletedThreshold {
  date: Date;
  /** Ladder rung, 0..THRESHOLD_TOP_INDEX. */
  index: number;
}

/** B1 — the single-session cap for every run in the week starting `weekStart`. */
export function runCapForWeek(runs: readonly CountedRun[], weekStart: Date): number {
  const end = weekStart.getTime();
  const start = end - RUN_CAP_WINDOW_DAYS * DAY_MS;
  let longest = 0;
  for (const r of runs) {
    const t = r.date.getTime();
    if (t >= start && t < end && r.minutes > longest) longest = r.minutes;
  }
  return Math.max(RUN_CAP_FLOOR_MIN, Math.floor(longest * RUN_CAP_GROWTH));
}

/**
 * Sprint 3.3b (#25 · 2) — the cap a week actually runs under. In a deload week
 * 75 % of B1, so the deload stays one once the cap has grown past the template.
 * The cap does not climb over the deload week: the week after still sees the
 * longer runs from before it, the shorter deload runs add nothing.
 */
export function weekRunCap(
  runs: readonly CountedRun[],
  weekStart: Date,
  isDeloadWeek: boolean,
): number {
  const cap = runCapForWeek(runs, weekStart);
  return isDeloadWeek ? Math.floor(cap * DELOAD_CAP_SHARE) : cap;
}

/** B2 — the rung the week starting `weekStart` has earned. */
export function nextThresholdIndex(
  completed: readonly CompletedThreshold[],
  weekStart: Date,
): number {
  const end = weekStart.getTime();
  const start = end - THRESHOLD_HISTORY_DAYS * DAY_MS;
  let highest = -1;
  for (const c of completed) {
    const t = c.date.getTime();
    if (t >= start && t < end && c.index > highest) highest = c.index;
  }
  return Math.min(THRESHOLD_TOP_INDEX, highest + 1);
}

/** B5 — does this week carry the 3-km test? */
export function isTimeTrialWeek(input: {
  /** Tuesday of the week — the day the test would run. */
  testDate: Date;
  isDeloadWeek: boolean;
  /** Most recent test, completed or already projected; null if none. */
  lastTestDate: Date | null;
  capMin: number;
  testDurationMin: number;
}): boolean {
  if (!input.isDeloadWeek) return false;
  if (input.testDate.getTime() < TIME_TRIAL_EARLIEST.getTime()) return false;
  if (
    input.lastTestDate &&
    input.testDate.getTime() - input.lastTestDate.getTime() < TIME_TRIAL_SPACING_DAYS * DAY_MS
  ) {
    return false;
  }
  return input.testDurationMin <= input.capMin;
}
