// Garmin activity candidates for /confirm — Sprint 3.2a. Pure.
//
// The nightly import only writes a session on an identity match (our pushed
// workout id on the activity). Q's runs to the gym are recorded ad hoc —
// "Berlin Running", no workout id — so they never match, and /confirm used to
// store the PLANNED duration for them: 31.08. "Easy 30 min" for a 13-minute run.
//
// Unattended, "one activity of the right kind that day" is too weak to write
// on (2.9: Q regularly records a second ad-hoc run the same day). With the
// athlete looking at the card it is exactly right: we suggest, he decides.
//
// ±1 day, because sessions slip: on 31.08. Q confirmed the plan for that
// Monday; the training itself happened on Tuesday 01.09.

import type { ActivityCategory, ActivitySummary } from "./activities";

export interface OpenSessionForMatch {
  id: string;
  /** Workout date as local YYYY-MM-DD. */
  date: string;
  discipline: "run" | "strength" | "other";
  plannedDurationMin: number | null;
}

export interface ConfirmCandidate {
  activityId: number;
  activityName: string;
  /** Local YYYY-MM-DD the activity started on. */
  date: string;
  startTimeLocal: string;
  /** −1 / 0 / +1 relative to the session's date. */
  dayOffset: number;
  durationMin: number;
  distanceKm: number | null;
  averageHr: number | null;
}

/** At most this many suggestions per card — more is a list, not a hint. */
export const MAX_CANDIDATES = 2;

const RUN_TYPES = [
  "easy_run", "threshold_run", "tempo_run", "long_run",
  "vo2max_intervals", "calibration_run", "time_trial_5k",
];

/** Session type → discipline. Shared by /api/sessions/open and its candidates. */
export function disciplineOf(type: string): OpenSessionForMatch["discipline"] {
  if (RUN_TYPES.includes(type)) return "run";
  if (type.startsWith("strength")) return "strength";
  return "other";
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

function categoryFor(discipline: OpenSessionForMatch["discipline"]): ActivityCategory | null {
  return discipline === "run" || discipline === "strength" ? discipline : null;
}

/**
 * Suggest Garmin activities for each open session.
 *
 *   - same category (run ↔ run, strength ↔ strength)
 *   - started within ±1 day of the session
 *   - not already linked to any workout (`linkedActivityIds`)
 *   - same day first, then the duration closest to the plan
 *   - at most MAX_CANDIDATES per session
 *
 * One activity may be suggested for two sessions (Mon plan, Tue training);
 * the confirm route refuses to link it twice.
 */
export function matchConfirmCandidates(
  sessions: readonly OpenSessionForMatch[],
  activities: readonly ActivitySummary[],
  linkedActivityIds: ReadonlySet<string>,
): Record<string, ConfirmCandidate[]> {
  const out: Record<string, ConfirmCandidate[]> = {};
  for (const s of sessions) {
    const category = categoryFor(s.discipline);
    if (!category) continue;

    const matches = activities
      .filter((a) => a.category === category)
      .filter((a) => !linkedActivityIds.has(String(a.activityId)))
      .map((a) => {
        const date = a.startTimeLocal.slice(0, 10);
        return { a, date, offset: dayDiff(date, s.date) };
      })
      .filter((m) => Math.abs(m.offset) <= 1)
      .sort((x, y) => {
        const byDay = Math.abs(x.offset) - Math.abs(y.offset);
        if (byDay !== 0) return byDay;
        const planSec = (s.plannedDurationMin ?? 0) * 60;
        return Math.abs(x.a.durationSec - planSec) - Math.abs(y.a.durationSec - planSec);
      })
      .slice(0, MAX_CANDIDATES);

    if (matches.length === 0) continue;
    out[s.id] = matches.map(({ a, date, offset }) => ({
      activityId: a.activityId,
      activityName: a.activityName,
      date,
      startTimeLocal: a.startTimeLocal,
      dayOffset: offset,
      durationMin: Math.max(1, Math.round(a.durationSec / 60)),
      distanceKm: a.distanceM != null ? Math.round(a.distanceM / 10) / 100 : null,
      averageHr: a.averageHr,
    }));
  }
  return out;
}
