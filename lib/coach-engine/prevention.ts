// Sprint 3.3 (A4) — home prevention routine, three times a week. Pure.
//
// With Kraft C gone and strength moving to the office gym, the shin-splint
// prevention work leaves the gym templates: Tibialis Raises, Short Foot and
// Single-Leg Calf Raises become a ~10-minute session at home on every forced
// rest day (Wed, Fri, Sun). Which exercises comes from
// UserSettings.preventionExercises; how much is fixed here.
//
// Deliberately NOT training evidence: it is not pushed to the watch, it is
// ticked off in /confirm without RPE or shin score, and the volume gate, the
// layoff detector, the daily load and the compliance rate all leave it out.
// A shin score from a ten-minute home routine would read as "calm" — the
// athlete's shin only talks under load.

import type { Exercise, SessionPlan } from "./types";

export const PREVENTION_DURATION_MIN = 10;

const PRESCRIPTIONS: Record<string, Omit<Exercise, "name">> = {
  "Tibialis Anterior Raises": {
    sets: 3, reps: 15, rpeCap: 6, tempo: "2-1-2", restSec: 30,
    notes: "Shin-Splint-Prävention (Marques 2025).",
  },
  "Short Foot Exercise": {
    sets: 3, reps: "30sec hold", rpeCap: 5, restSec: 30,
    notes: "Intrinsic foot muscles (Newsham 2023). Fußgewölbe aktiv anheben, barfuß.",
  },
  "Single-Leg Calf Raises": {
    sets: 3, reps: "12/leg", rpeCap: 7, tempo: "2-2-2", restSec: 30,
    notes: "Soleus-fokussiert für Lauf-Stoßdämpfung.",
  },
};

/** An exercise the routine does not know yet still gets a sane default. */
const DEFAULT_PRESCRIPTION: Omit<Exercise, "name"> = { sets: 3, reps: 10, rpeCap: 6, restSec: 30 };

/** Types that are never evidence about running or training load. */
export const NON_TRAINING_TYPES: ReadonlyArray<string> = ["rest", "active_recovery", "mobility"];

export function buildPreventionSession(
  date: Date,
  exerciseNames: readonly string[],
): SessionPlan | null {
  if (exerciseNames.length === 0) return null;
  return {
    date,
    type: "mobility",
    durationMin: PREVENTION_DURATION_MIN,
    exercises: exerciseNames.map((name) => ({ name, ...(PRESCRIPTIONS[name] ?? DEFAULT_PRESCRIPTION) })),
    notes: "Heim-Prävention, ~10 min. Nicht auf der Uhr — in /confirm abhaken.",
  };
}
